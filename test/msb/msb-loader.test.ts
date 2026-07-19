/**
 * Direct unit tests for `src/alienclaw/msb/msb-loader.ts` (packet 069).
 *
 * Background:
 *   `msb-loader.ts` (235 lines) exposes 5 public symbols:
 *     - validateMsb(raw)               (covered indirectly by test/brains/ts-fixture-runner.test.ts)
 *     - parseMsbContent(raw, path)      (covered indirectly by ts-fixture-runner)
 *     - loadMsbFile(filePath)           (NOT covered — file-system coupled)
 *     - loadMsbCached(toolName, dir)    (NOT covered — cache eviction untested)
 *     - clearMsbCache()                 (NOT covered)
 *
 *   The `loadMsbCached` function is called by `src/alienclaw/msb/martian-executor.ts:182`
 *   (every Martian execution), making its cache-eviction logic production-critical.
 *
 * These tests use the same mkdtempSync + writeFileSync + rmSync idiom as packets
 * 067 (martians/registry.test.ts) and 068 (registry/martian-registry.test.ts).
 *
 * The shared module-level cache (line 215) is reset via `clearMsbCache()` in
 * beforeEach to prevent cross-test pollution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadMsbFile,
  loadMsbCached,
  clearMsbCache,
  validateMsb,
  parseMsbContent,
} from '../../src/alienclaw/msb/msb-loader.js';

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

/** A minimal-but-valid .msb string with all 10 required sections + a 1-row PARAMETER_SCHEMA. */
const VALID_MSB = `\
TOOL: test_tool
VERSION: 1.0

CAPABILITIES:
Line one of capabilities.
Line two of capabilities.

LIMITATIONS:
Line one of limitations.

FAILURE MODES:
Line one of failure modes.

BEST PRACTICES:
Line one of best practices.

EXECUTION ORDER:
1. Step one
2. Step two

OUTPUT CONTRACT:
{"result":"any"}

GENOME SECTIONS:
IDENTITY: identity description
EXECUTION: execution description
BEHAVIOR: behavior description
CHECKSUM: FNV-1a checksum of sections 0-2

VARIABLES:
task: The natural language task
input: The input value

PARAMETER_SCHEMA:
max_attempts|0|1|5|1|lower|Maximum retry attempts
`;

/** A .msb string that fails validation (missing CAPABILITIES). */
const INVALID_MSB = `\
TOOL: broken_tool
VERSION: 0.1

LIMITATIONS:
No capabilities here.
`;

/** A .msb string with a malformed PARAMETER_SCHEMA row (only 5 fields instead of 7). */
const BAD_PARAM_SCHEMA_MSB = `\
TOOL: bad_params
VERSION: 0.1

CAPABILITIES:
Has capabilities.

LIMITATIONS:
Has limitations.

FAILURE MODES:
Has failure modes.

BEST PRACTICES:
Has best practices.

EXECUTION ORDER:
1. Do thing

OUTPUT CONTRACT:
{"ok":true}

GENOME SECTIONS:
IDENTITY: x
EXECUTION: y
BEHAVIOR: z
CHECKSUM: w

VARIABLES:
task: the task

PARAMETER_SCHEMA:
name|0|1|5|1
`;

/** A .msb string where PARAMETER_SCHEMA has a non-numeric field. */
const NON_NUMERIC_PARAM_MSB = `\
TOOL: bad_nums
VERSION: 0.1

CAPABILITIES:
x

LIMITATIONS:
x

FAILURE MODES:
x

BEST PRACTICES:
x

EXECUTION ORDER:
1. x

OUTPUT CONTRACT:
x

GENOME SECTIONS:
IDENTITY: x
EXECUTION: y
BEHAVIOR: z
CHECKSUM: w

VARIABLES:
task: x

PARAMETER_SCHEMA:
name|not_a_number|1|5|1|lower|description
`;

/** A .msb string where PARAMETER_SCHEMA has an invalid direction. */
const BAD_DIRECTION_MSB = `\
TOOL: bad_dir
VERSION: 0.1

CAPABILITIES:
x

LIMITATIONS:
x

FAILURE MODES:
x

BEST PRACTICES:
x

EXECUTION ORDER:
1. x

OUTPUT CONTRACT:
x

GENOME SECTIONS:
IDENTITY: x
EXECUTION: y
BEHAVIOR: z
CHECKSUM: w

VARIABLES:
task: x

PARAMETER_SCHEMA:
name|0|1|5|1|sideways|description
`;

let tmpDir: string;
const writtenFiles: string[] = [];

function freshTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'p069-msb-'));
}

function writeMsb(name: string, content: string): string {
  const filePath = join(tmpDir, `${name}.msb`);
  writeFileSync(filePath, content, 'utf-8');
  writtenFiles.push(filePath);
  return filePath;
}

beforeEach(() => {
  // Reset the module-level cache before every test to prevent cross-test pollution.
  clearMsbCache();
  tmpDir = freshTmpDir();
  writtenFiles.length = 0;
});

afterEach(() => {
  // Clean up the temp directory created in beforeEach.
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  // Also clear the module-level cache so the next beforeEach starts clean.
  clearMsbCache();
});

// ---------------------------------------------------------------------------
// loadMsbFile
// ---------------------------------------------------------------------------

describe('msb/msb-loader — loadMsbFile(filePath)', () => {
  it('R-001: valid .msb file → returns fully populated MartianBrain', () => {
    const fp = writeMsb('compute', VALID_MSB);
    const brain = loadMsbFile(fp);
    expect(brain.tool).toBe('test_tool');
    expect(brain.version).toBe('1.0');
    expect(brain.capabilities.startsWith('Line one of capabilities.')).toBe(true);
    expect(brain.executionOrder).toEqual(['Step one', 'Step two']);
    expect(brain.genomeSections.identity).toBe('identity description');
    expect(brain.variables).toEqual({ task: 'The natural language task', input: 'The input value' });
    expect(brain.parameterSchema).toHaveLength(1);
    expect(brain.parameterSchema[0]?.name).toBe('max_attempts');
    expect(brain.parameterSchema[0]?.direction).toBe('lower');
  });

  it('R-002: missing file (ENOENT) → throws with "MSB file not found: <path>"', () => {
    const missingPath = join(tmpDir, 'does_not_exist.msb');
    expect(() => loadMsbFile(missingPath)).toThrowError(
      new RegExp(`MSB file not found: ${missingPath.replace(/[\\/]/g, '[\\\\/]')}`)
    );
  });

  it('R-003: ENOENT message includes the filePath that was requested', () => {
    const missingPath = join(tmpDir, 'nope.msb');
    let captured: Error | null = null;
    try { loadMsbFile(missingPath); } catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain(missingPath);
  });

  it('R-004: non-ENOENT read error → rethrows the raw OS error (L204)', () => {
    // readFileSync on a directory throws EISDIR (code !== 'ENOENT'), so
    // L204 `throw err` executes — rethrows the raw error as-is.
    let caught: NodeJS.ErrnoException | undefined;
    try {
      loadMsbFile(tmpDir);
    } catch (e) {
      caught = e as NodeJS.ErrnoException;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe('EISDIR');
    // Must NOT be wrapped in the friendly "MSB file not found: ..." prefix —
    // that would signal the wrong branch (ENOENT path) was taken.
    expect(caught!.message).not.toMatch(/MSB file not found/);
  });
});

// ---------------------------------------------------------------------------
// loadMsbCached
// ---------------------------------------------------------------------------

describe('msb/msb-loader — loadMsbCached(toolName, msbDir)', () => {
  it('R-101: first call loads from disk and caches the result', () => {
    const fp = writeMsb('web_search', VALID_MSB);
    const brain = loadMsbCached('web_search', tmpDir);
    expect(brain.tool).toBe('test_tool');
    // Sanity: the file is still on disk (cached, not moved).
    expect(existsSync(fp)).toBe(true);
  });

  it('R-102: second call with the same args returns the SAME object (cache hit)', () => {
    writeMsb('compute', VALID_MSB);
    const a = loadMsbCached('compute', tmpDir);
    const b = loadMsbCached('compute', tmpDir);
    expect(b).toBe(a); // identity check — same reference, no re-parse
  });

  it('R-103: cache is keyed by (msbDir, toolName) — different dirs are independent', () => {
    const dirA = mkdtempSync(join(tmpdir(), 'p069-msb-A-'));
    const dirB = mkdtempSync(join(tmpdir(), 'p069-msb-B-'));
    try {
      writeFileSync(join(dirA, 'tool.msb'), VALID_MSB, 'utf-8');
      writeFileSync(join(dirB, 'tool.msb'), VALID_MSB, 'utf-8');
      const a = loadMsbCached('tool', dirA);
      const b = loadMsbCached('tool', dirB);
      expect(a).not.toBe(b); // different keys → different cache entries
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('R-104: missing file (ENOENT) → throws (not cached, not swallowed)', () => {
    expect(() => loadMsbCached('ghost', tmpDir)).toThrowError(/MSB file not found:/);
  });

  it('R-105: cache eviction fires when size exceeds 64 (oldest entry removed)', () => {
    // Write 65 distinct .msb files; load them in insertion order so we know which is "oldest".
    const fileNames: string[] = [];
    for (let i = 0; i < 65; i++) {
      const name = `tool_${String(i).padStart(3, '0')}`;
      fileNames.push(name);
      writeMsb(name, VALID_MSB);
    }

    // Load all 65 in order — this triggers one eviction (oldest = tool_000).
    for (const name of fileNames) {
      loadMsbCached(name, tmpDir);
    }

    // The 65th insertion should have been cached. tool_001..tool_064 also cached.
    // tool_000 should have been evicted.
    // Verify via side-effect: re-loading tool_000 must re-read from disk
    // (same identity check is impossible since it was re-parsed; instead we
    // verify by deleting the file from disk and re-loading, which would
    // throw if cached, or — cleaner — track via the cache map by toggling
    // a different file and checking reference equality for a non-evicted entry).
    const refA = loadMsbCached('tool_064', tmpDir);
    const refB = loadMsbCached('tool_064', tmpDir);
    expect(refB).toBe(refA); // tool_064 was NOT evicted → still cached

    const refC = loadMsbCached('tool_001', tmpDir);
    const refD = loadMsbCached('tool_001', tmpDir);
    expect(refD).toBe(refC); // tool_001 was NOT evicted → still cached

    // tool_000 was the oldest insertion and should be EVICTED.
    // After eviction, a re-load must re-parse from disk → new reference.
    // We verify eviction by deleting tool_000 from disk and confirming the
    // re-load throws ENOENT (proving it was NOT in the cache).
    rmSync(join(tmpDir, 'tool_000.msb'), { force: true });
    expect(() => loadMsbCached('tool_000', tmpDir)).toThrowError(/MSB file not found:/);
  });
});

// ---------------------------------------------------------------------------
// clearMsbCache
// ---------------------------------------------------------------------------

describe('msb/msb-loader — clearMsbCache()', () => {
  it('R-201: clearMsbCache empties the cache — next call re-reads from disk', () => {
    writeMsb('compute', VALID_MSB);
    const first = loadMsbCached('compute', tmpDir);
    clearMsbCache();
    // After clear, the next call must re-parse from disk.
    // We verify by modifying the file on disk between the two calls and
    // confirming the second parse sees the new content.
    const modified = VALID_MSB.replace('VERSION: 1.0', 'VERSION: 2.0');
    writeFileSync(join(tmpDir, 'compute.msb'), modified, 'utf-8');
    const second = loadMsbCached('compute', tmpDir);
    expect(second.version).toBe('2.0');
    expect(second).not.toBe(first); // different parse → different reference
  });

  it('R-202: clearMsbCache is a no-op when the cache is already empty', () => {
    expect(() => clearMsbCache()).not.toThrow();
    expect(() => clearMsbCache()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateMsb (supplemental — primary coverage is via ts-fixture-runner)
// ---------------------------------------------------------------------------

describe('msb/msb-loader — validateMsb(raw) — supplemental', () => {
  it('R-301: missing required section → returns valid=false, errors includes "Missing required section: <name>" for each missing section', () => {
    // INVALID_MSB has LIMITATIONS but is missing 7 of the 10 required sections.
    const result = validateMsb(INVALID_MSB);
    expect(result.valid).toBe(false);
    // Sections that ARE present in INVALID_MSB (must NOT appear in errors):
    expect(result.errors.some(e => e.includes('Missing required section: LIMITATIONS'))).toBe(false);
    // Sections that ARE missing from INVALID_MSB (must appear in errors):
    for (const missing of ['CAPABILITIES', 'FAILURE MODES', 'BEST PRACTICES', 'EXECUTION ORDER', 'OUTPUT CONTRACT', 'GENOME SECTIONS', 'VARIABLES']) {
      expect(result.errors.some(e => e.includes(`Missing required section: ${missing}`))).toBe(true);
    }
  });

  it('R-302: empty TOOL field → errors includes "TOOL field is empty"', () => {
    const noTool = `VERSION: 1.0\n\nCAPABILITIES:\nx\n\nLIMITATIONS:\nx\n\nFAILURE MODES:\nx\n\nBEST PRACTICES:\nx\n\nEXECUTION ORDER:\n1. x\n\nOUTPUT CONTRACT:\n{}\n\nGENOME SECTIONS:\nIDENTITY: x\nEXECUTION: y\nBEHAVIOR: z\nCHECKSUM: w\n\nVARIABLES:\ntask: x\n`;
    const result = validateMsb(noTool);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('TOOL field is empty');
  });

  it('R-303: valid MSB → valid=true, errors is empty', () => {
    const result = validateMsb(VALID_MSB);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseMsbContent (supplemental — primary coverage is via ts-fixture-runner)
// ---------------------------------------------------------------------------

describe('msb/msb-loader — parseMsbContent(raw, sourcePath) — supplemental', () => {
  it('R-401: invalid MSB (validation failed) → throws Error containing all error messages', () => {
    let captured: Error | null = null;
    try { parseMsbContent(INVALID_MSB, '/tmp/test.msb'); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain('MSB validation failed (/tmp/test.msb)');
    expect(captured!.message).toContain('Missing required section: CAPABILITIES');
  });

  it('R-402: full valid MSB round-trip → all 10 sections parsed into the right fields', () => {
    const brain = parseMsbContent(VALID_MSB, '<inline>');
    expect(brain.tool).toBe('test_tool');
    expect(brain.version).toBe('1.0');
    expect(brain.capabilities.split('\n')[0]).toBe('Line one of capabilities.');
    expect(brain.limitations).toContain('Line one of limitations');
    expect(brain.failureModes).toContain('Line one of failure modes');
    expect(brain.bestPractices).toContain('Line one of best practices');
    expect(brain.executionOrder).toEqual(['Step one', 'Step two']);
    expect(brain.outputContract).toBe('{"result":"any"}');
    expect(brain.genomeSections).toEqual({
      identity:  'identity description',
      execution: 'execution description',
      behavior:  'behavior description',
      checksum:  'FNV-1a checksum of sections 0-2',
    });
    expect(brain.variables).toEqual({ task: 'The natural language task', input: 'The input value' });
    expect(brain.parameterSchema).toHaveLength(1);
  });

  it('R-403: sourcePath is included in the validation-failure error message', () => {
    const path = '/custom/path/to/brain.msb';
    let captured: Error | null = null;
    try { parseMsbContent(INVALID_MSB, path); }
    catch (e) { captured = e as Error; }
    expect(captured!.message).toContain(path);
  });

  it('R-404: MSB with EXECUTION ORDER header but empty body → executionOrder is []', () => {
    // Place EXECUTION ORDER last with no trailing newline — the section-extraction
    // regex requires '\s*\n' after the header; absent here, extractSection returns ''
    // (regex non-match → null → ''), and arm 0 of L55 fires → executionOrder is [].
    // validateMsb passes because it only checks raw.includes('EXECUTION ORDER:').
    const emptyOrderMsb = [
      'TOOL: test_tool',
      'VERSION: 1.0',
      '',
      'CAPABILITIES:',
      'Has capabilities.',
      '',
      'LIMITATIONS:',
      'Has limitations.',
      '',
      'FAILURE MODES:',
      'Has failure modes.',
      '',
      'BEST PRACTICES:',
      'Has best practices.',
      '',
      'OUTPUT CONTRACT:',
      '{}',
      '',
      'GENOME SECTIONS:',
      'IDENTITY: x',
      'EXECUTION: y',
      'BEHAVIOR: z',
      'CHECKSUM: w',
      '',
      'VARIABLES:',
      'task: the task',
      '',
      'EXECUTION ORDER:',
    ].join('\n');
    const brain = parseMsbContent(emptyOrderMsb);
    expect(brain.executionOrder).toEqual([]);
  });

  it('R-405: omitting sourcePath → validation-failure error has no location string', () => {
    let captured: Error | null = null;
    try { parseMsbContent(INVALID_MSB); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/^MSB validation failed:\n/);
    expect(captured!.message).not.toContain('(');
  });

  it('R-406: GENOME SECTIONS block with only IDENTITY sub-key → missing sub-keys return empty string', () => {
    const partialGenomeSectionsMsb = [
      'TOOL: partial_tool',
      'VERSION: 1.0',
      '',
      'CAPABILITIES:',
      'Has capabilities.',
      '',
      'LIMITATIONS:',
      'Has limitations.',
      '',
      'FAILURE MODES:',
      'Has failure modes.',
      '',
      'BEST PRACTICES:',
      'Has best practices.',
      '',
      'EXECUTION ORDER:',
      '1. Do thing',
      '',
      'OUTPUT CONTRACT:',
      '{}',
      '',
      'GENOME SECTIONS:',
      'IDENTITY: only identity present',
      '',
      'VARIABLES:',
      'task: the task',
      '',
    ].join('\n');
    const brain = parseMsbContent(partialGenomeSectionsMsb);
    expect(brain.genomeSections.identity).toBe('only identity present');
    expect(brain.genomeSections.execution).toBe('');
    expect(brain.genomeSections.behavior).toBe('');
    expect(brain.genomeSections.checksum).toBe('');
  });

  it('R-407: GENOME SECTIONS with inline content (no trailing newline) → all genomeSections sub-keys are empty strings', () => {
    // GENOME SECTIONS: inline_text passes validateMsb (raw.includes('GENOME SECTIONS:') is true)
    // but fails extractGenomeSections's /^GENOME SECTIONS:\s*\n/m regex because 'inline_text' is
    // not \s*. headerMatch === null → tail = '' → all four sub-keys return ''.
    const inlineGenomeMsb = [
      'TOOL: inline_tool',
      'VERSION: 1.0',
      '',
      'CAPABILITIES:',
      'Has capabilities.',
      '',
      'LIMITATIONS:',
      'Has limitations.',
      '',
      'FAILURE MODES:',
      'Has failure modes.',
      '',
      'BEST PRACTICES:',
      'Has best practices.',
      '',
      'EXECUTION ORDER:',
      '1. Do thing',
      '',
      'OUTPUT CONTRACT:',
      '{}',
      '',
      'GENOME SECTIONS: identity_val execution_val behavior_val checksum_val',
      '',
      'VARIABLES:',
      'task: the task',
      '',
    ].join('\n');
    const brain = parseMsbContent(inlineGenomeMsb);
    expect(brain.genomeSections.identity).toBe('');
    expect(brain.genomeSections.execution).toBe('');
    expect(brain.genomeSections.behavior).toBe('');
    expect(brain.genomeSections.checksum).toBe('');
  });
});

// ---------------------------------------------------------------------------
// PARAMETER_SCHEMA error paths (via parseMsbContent — exercises extractParameterSchema)
// ---------------------------------------------------------------------------

describe('msb/msb-loader — extractParameterSchema (via parseMsbContent) — error paths', () => {
  it('R-501: PARAMETER_SCHEMA row with <7 fields → throws "has N fields (expected 7…)"', () => {
    let captured: Error | null = null;
    try { parseMsbContent(BAD_PARAM_SCHEMA_MSB); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/PARAMETER_SCHEMA entry.*has \d+ fields \(expected 7/);
  });

  it('R-502: PARAMETER_SCHEMA row with non-numeric field → throws "numeric field error"', () => {
    let captured: Error | null = null;
    try { parseMsbContent(NON_NUMERIC_PARAM_MSB); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("PARAMETER_SCHEMA entry 'name' in <string>: numeric field error");
  });

  it('R-503: PARAMETER_SCHEMA row with invalid direction → throws "invalid direction \'sideways\'"', () => {
    let captured: Error | null = null;
    try { parseMsbContent(BAD_DIRECTION_MSB); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("PARAMETER_SCHEMA entry 'name' in <string> has invalid direction 'sideways'. Must be: lower | higher | none.");
  });

  it('R-504: well-formed PARAMETER_SCHEMA → fields parsed with correct types and direction enum', () => {
    const brain = parseMsbContent(VALID_MSB);
    const ps = brain.parameterSchema;
    expect(ps).toHaveLength(1);
    const field = ps[0];
    expect(field).toBeDefined();
    expect(field!.name).toBe('max_attempts');
    expect(field!.xcodeIndex).toBe(0);
    expect(field!.rangeMin).toBe(1);
    expect(field!.rangeMax).toBe(5);
    expect(field!.default).toBe(1);
    expect(field!.direction).toBe('lower');
    expect(field!.description).toBe('Maximum retry attempts');
  });
});
