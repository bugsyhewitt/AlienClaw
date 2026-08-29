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
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
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

/** A .msb string where PARAMETER_SCHEMA description contains a literal pipe (9 fields). */
const BAD_PIPE_DESC_MSB = `\
TOOL: bad_pipe
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
name|0|1|5|1|lower|foo|bar|baz
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

  it('R-304: prefixed CAPABILITIES (MY_CAPABILITIES:) → valid=false, error names the missing section', () => {
    const raw = VALID_MSB.replace('CAPABILITIES:', 'MY_CAPABILITIES:');
    const result = validateMsb(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required section: CAPABILITIES');
  });

  it('R-305: prefixed FAILURE MODES (OUR_FAILURE MODES:) → valid=false, error names the missing section', () => {
    const raw = VALID_MSB.replace('FAILURE MODES:', 'OUR_FAILURE MODES:');
    const result = validateMsb(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required section: FAILURE MODES');
  });

  it('R-306: prefixed GENOME SECTIONS (FOO GENOME SECTIONS:) → valid=false, error names the missing section', () => {
    const raw = VALID_MSB.replace('GENOME SECTIONS:', 'FOO GENOME SECTIONS:');
    const result = validateMsb(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required section: GENOME SECTIONS');
  });

  it('R-307: prefixed VARIABLES (MY_VARIABLES:) → valid=false, error names the missing section', () => {
    const raw = VALID_MSB.replace('VARIABLES:', 'MY_VARIABLES:');
    const result = validateMsb(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required section: VARIABLES');
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

  it('R-408: ?? 0 dead-code pin — headerMatch.index is always numeric when match is non-null', () => {
    // Per ECMAScript spec, String.prototype.match() with a non-global regex returns an array
    // whose .index property is always a number (the start offset of the match). When
    // headerMatch is non-null, headerMatch.index is never undefined, so the ?? 0 fallback on
    // L80 of msb-loader.ts is structurally dead. This test pins the expected behavior:
    // extraction succeeds and identity is a non-empty string.
    const brain = parseMsbContent(VALID_MSB);
    expect(typeof brain.genomeSections.identity).toBe('string');
    expect(brain.genomeSections.identity.length).toBeGreaterThan(0);
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

  it('R-502: PARAMETER_SCHEMA row with non-numeric field → throws "numeric field must be an integer"', () => {
    let captured: Error | null = null;
    try { parseMsbContent(NON_NUMERIC_PARAM_MSB); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/PARAMETER_SCHEMA entry 'name' in <string>: numeric field must be an integer/);
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

  it('R-505: PARAMETER_SCHEMA row with >7 fields (pipe in description) → throws "has N fields (expected 7…)"', () => {
    let captured: Error | null = null;
    try { parseMsbContent(BAD_PIPE_DESC_MSB); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/PARAMETER_SCHEMA entry.*has \d+ fields \(expected 7/);
  });

  // --- PKT-578: numeric bounds validation ---

  it('R-506: xcode_index=31 (> 30) → throws "xcode_index must be in [0,30]"', () => {
    const msb = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|31|1|5|1|lower|desc');
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/xcode_index must be in \[0,30\]/);
  });

  it('R-507: xcode_index=-1 (< 0) → throws "xcode_index must be in [0,30]"', () => {
    const msb = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|-1|1|5|1|lower|desc');
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/xcode_index must be in \[0,30\]/);
  });

  it('R-508: range_min > range_max → throws "range_min (N) must be <= range_max (N)"', () => {
    const msb = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|0|10|5|5|lower|desc');
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/range_min \(\d+\) must be <= range_max \(\d+\)/);
  });

  it('R-509: default outside [range_min, range_max] → throws "default (N) must be in [N, N]"', () => {
    const msb = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|0|1|5|10|lower|desc');
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/default \(\d+\) must be in \[\d+, \d+\]/);
  });

  it('R-510: xcode_index at boundaries (0 and 30) → valid, parses ok', () => {
    const msb0  = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|0|1|5|1|lower|desc');
    const msb30 = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|30|1|5|1|lower|desc');
    expect(() => parseMsbContent(msb0)).not.toThrow();
    expect(() => parseMsbContent(msb30)).not.toThrow();
    expect(parseMsbContent(msb0).parameterSchema[0]?.xcodeIndex).toBe(0);
    expect(parseMsbContent(msb30).parameterSchema[0]?.xcodeIndex).toBe(30);
  });

  // --- PKT-592: name integrity (corrective re-author of PKT-583) ---

  it('R-511: PARAMETER_SCHEMA row with empty name → throws "empty name"', () => {
    const msb = VALID_MSB.replace(
      'max_attempts|0|1|5|1|lower|Maximum retry attempts',
      '|0|1|5|1|lower|desc'
    );
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/PARAMETER_SCHEMA entry in <string> has empty name/);
  });

  it("R-512: PARAMETER_SCHEMA with duplicate names → throws \"duplicate name 'foo'\"", () => {
    const msb = VALID_MSB.replace(
      'max_attempts|0|1|5|1|lower|Maximum retry attempts',
      'foo|0|1|5|1|lower|d1\nfoo|1|1|5|1|lower|d2'
    );
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("PARAMETER_SCHEMA entry 'foo' in <string>: duplicate name");
  });

  it('R-513: duplicate name at position 3 (covered by seen-set in loop) → throws', () => {
    const msb = VALID_MSB.replace(
      'max_attempts|0|1|5|1|lower|Maximum retry attempts',
      'foo|0|1|5|1|lower|d1\nbar|1|1|5|1|lower|d2\nfoo|2|1|5|1|lower|d3'
    );
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("duplicate name 'foo'");
  });

  it('R-514: unique non-empty names → 2 fields parsed successfully', () => {
    const msb = VALID_MSB.replace(
      'max_attempts|0|1|5|1|lower|Maximum retry attempts',
      'foo|0|1|5|1|lower|d1\nbar|1|1|5|1|lower|d2'
    );
    const brain = parseMsbContent(msb);
    expect(brain.parameterSchema).toHaveLength(2);
    expect(brain.parameterSchema[0]!.name).toBe('foo');
    expect(brain.parameterSchema[1]!.name).toBe('bar');
  });

  // --- PKT-674: strict integer regex pre-check (partial-coercion bypass) ---

  it('R-515 (PKT-674): decimal xcode_index "3.5" → throws "not a valid integer" (was silent downcast to 3, passed [0,30] bounds)', () => {
    const msb = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|3.5|1|5|2|lower|desc');
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("xcode_index '3.5' is not a valid integer");
  });

  it('R-516 (PKT-674): trailing-junk range_max "10abc" → throws "not a valid integer" (was silent truncation to 10)', () => {
    const msb = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|0|1|10abc|5|lower|desc');
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("range_max '10abc' is not a valid integer");
  });

  it('R-517 (PKT-674): leading-alpha "abc1" as xcode_index → throws (parseInt returns NaN; regex also rejects; sanity that fix does not break pure-non-numeric rejection)', () => {
    const msb = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|abc1|1|5|1|lower|desc');
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("xcode_index 'abc1' is not a valid integer");
  });

  it('R-518 (PKT-674): scientific-notation xcode_index "1e2" → throws "not a valid integer" (parseInt("1e2",10)=1, was silent downcast)', () => {
    const msb = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|1e2|1|5|1|lower|desc');
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("xcode_index '1e2' is not a valid integer");
  });

  it('R-519 (PKT-674): negative-with-trailing-junk xcode_index "-3xyz" → throws "not a valid integer" (parseInt("-3xyz",10)=-3, was silent; R-507 would have caught -3 anyway but fix rejects earlier)', () => {
    const msb = VALID_MSB.replace('max_attempts|0|1|5|1|lower|Maximum retry attempts', 'foo|-3xyz|1|5|1|lower|desc');
    let captured: Error | null = null;
    try { parseMsbContent(msb); }
    catch (e) { captured = e as Error; }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("xcode_index '-3xyz' is not a valid integer");
  });
});

// ---------------------------------------------------------------------------
// PKT-673: extractSection embedded-heading premature-termination (R-673-1..14)
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid .msb string for PKT-673 tests.
 * Default bodies are single lines; pass overrides to inject embedded headers.
 * PARAMETER_SCHEMA is omitted unless parameterSchema is provided.
 */
function make673Msb(opts: {
  capabilities?:   string;
  limitations?:    string;
  failureModes?:   string;
  bestPractices?:  string;
  variables?:      string;
  parameterSchema?: string;
} = {}): string {
  const cap  = opts.capabilities  ?? 'cap line';
  const lim  = opts.limitations   ?? 'lim line';
  const fm   = opts.failureModes  ?? 'fm line';
  const bp   = opts.bestPractices ?? 'bp line';
  const vars = opts.variables     ?? 'task: the task';
  let out = `TOOL: pkt673_test
VERSION: 1.0

CAPABILITIES:
${cap}

LIMITATIONS:
${lim}

FAILURE MODES:
${fm}

BEST PRACTICES:
${bp}

EXECUTION ORDER:
1. step

OUTPUT CONTRACT:
{}

GENOME SECTIONS:
IDENTITY: x
EXECUTION: y
BEHAVIOR: z
CHECKSUM: w

VARIABLES:
${vars}
`;
  if (opts.parameterSchema !== undefined) {
    out += `\nPARAMETER_SCHEMA:\n${opts.parameterSchema}\n`;
  }
  return out;
}

describe('msb/msb-loader — extractSection embedded-heading premature-termination (PKT-673)', () => {
  // R-673-1..6: embedded developer-comment patterns must NOT truncate section body

  it('R-673-1: CAPABILITIES body with NOTE: does not truncate', () => {
    const raw = make673Msb({ capabilities: 'cap line\nNOTE: this should not terminate\nLine two of capabilities.' });
    const brain = parseMsbContent(raw);
    expect(brain.capabilities).toContain('NOTE: this should not terminate');
    expect(brain.capabilities).toContain('Line two of capabilities.');
  });

  it('R-673-2: CAPABILITIES body with TODO: does not truncate', () => {
    const raw = make673Msb({ capabilities: 'cap line\nTODO: fix this later\nLine two of capabilities.' });
    const brain = parseMsbContent(raw);
    expect(brain.capabilities).toContain('TODO: fix this later');
    expect(brain.capabilities).toContain('Line two of capabilities.');
  });

  it('R-673-3: CAPABILITIES body with FIXME: does not truncate', () => {
    const raw = make673Msb({ capabilities: 'cap line\nFIXME: broken edge case\nLine two of capabilities.' });
    const brain = parseMsbContent(raw);
    expect(brain.capabilities).toContain('FIXME: broken edge case');
    expect(brain.capabilities).toContain('Line two of capabilities.');
  });

  it('R-673-4: VARIABLES body with NOTE: between two vars captures both vars', () => {
    const raw = make673Msb({ variables: 'foo: the foo value\nNOTE: a developer note\nbar: the bar value' });
    const brain = parseMsbContent(raw);
    expect(brain.variables).toHaveProperty('foo', 'the foo value');
    expect(brain.variables).toHaveProperty('bar', 'the bar value');
  });

  it('R-673-5: VARIABLES body with TODO: captures both vars', () => {
    const raw = make673Msb({ variables: 'foo: the foo value\nTODO: fix this\nbar: the bar value' });
    const brain = parseMsbContent(raw);
    expect(brain.variables).toHaveProperty('foo', 'the foo value');
    expect(brain.variables).toHaveProperty('bar', 'the bar value');
  });

  it('R-673-6: LIMITATIONS body with WARN: captures all content', () => {
    const raw = make673Msb({ limitations: 'limit line one\nWARN: important warning\nlimit line two' });
    const brain = parseMsbContent(raw);
    expect(brain.limitations).toContain('WARN: important warning');
    expect(brain.limitations).toContain('limit line two');
  });

  // R-673-7..10: adjacent-header no-merge regression guards
  // Whitelist must still split at REAL section boundaries even with no blank line.

  it('R-673-7: adjacent CAPABILITIES→LIMITATIONS (no blank line) splits correctly', () => {
    const raw = [
      'TOOL: pkt673_test', 'VERSION: 1.0', '',
      'CAPABILITIES:', 'cap content',
      'LIMITATIONS:', 'lim content', '',
      'FAILURE MODES:', 'fm', '',
      'BEST PRACTICES:', 'bp', '',
      'EXECUTION ORDER:', '1. step', '',
      'OUTPUT CONTRACT:', '{}', '',
      'GENOME SECTIONS:', 'IDENTITY: x', 'EXECUTION: y', 'BEHAVIOR: z', 'CHECKSUM: w', '',
      'VARIABLES:', 'task: the task',
    ].join('\n') + '\n';
    const brain = parseMsbContent(raw);
    expect(brain.capabilities).toBe('cap content');
    expect(brain.limitations).toContain('lim content');
  });

  it('R-673-8: adjacent LIMITATIONS→FAILURE MODES (no blank line) splits correctly', () => {
    const raw = [
      'TOOL: pkt673_test', 'VERSION: 1.0', '',
      'CAPABILITIES:', 'cap', '',
      'LIMITATIONS:', 'lim content',
      'FAILURE MODES:', 'fm content', '',
      'BEST PRACTICES:', 'bp', '',
      'EXECUTION ORDER:', '1. step', '',
      'OUTPUT CONTRACT:', '{}', '',
      'GENOME SECTIONS:', 'IDENTITY: x', 'EXECUTION: y', 'BEHAVIOR: z', 'CHECKSUM: w', '',
      'VARIABLES:', 'task: the task',
    ].join('\n') + '\n';
    const brain = parseMsbContent(raw);
    expect(brain.limitations).toBe('lim content');
    expect(brain.failureModes).toContain('fm content');
  });

  it('R-673-9: adjacent FAILURE MODES→BEST PRACTICES (no blank line) splits correctly', () => {
    const raw = [
      'TOOL: pkt673_test', 'VERSION: 1.0', '',
      'CAPABILITIES:', 'cap', '',
      'LIMITATIONS:', 'lim', '',
      'FAILURE MODES:', 'fm content',
      'BEST PRACTICES:', 'bp content', '',
      'EXECUTION ORDER:', '1. step', '',
      'OUTPUT CONTRACT:', '{}', '',
      'GENOME SECTIONS:', 'IDENTITY: x', 'EXECUTION: y', 'BEHAVIOR: z', 'CHECKSUM: w', '',
      'VARIABLES:', 'task: the task',
    ].join('\n') + '\n';
    const brain = parseMsbContent(raw);
    expect(brain.failureModes).toBe('fm content');
    expect(brain.bestPractices).toContain('bp content');
  });

  it('R-673-10: adjacent VARIABLES→PARAMETER_SCHEMA splits correctly (underscore in whitelist)', () => {
    const raw = make673Msb({
      variables:       'foo: the foo value',
      parameterSchema: 'max_attempts|0|1|5|1|lower|Maximum retry attempts',
    });
    const brain = parseMsbContent(raw);
    expect(brain.variables).toHaveProperty('foo', 'the foo value');
    // PARAMETER_SCHEMA key must NOT bleed into the variables dict
    expect(brain.variables).not.toHaveProperty('PARAMETER_SCHEMA');
    expect(brain.parameterSchema).toHaveLength(1);
    expect(brain.parameterSchema[0]?.name).toBe('max_attempts');
  });

  // R-673-11..12: edge-case regression guards

  it('R-673-11: CAPABILITIES body with IMPORTANT: does not truncate', () => {
    const raw = make673Msb({ capabilities: 'cap line\nIMPORTANT: read this\nLine two of capabilities.' });
    const brain = parseMsbContent(raw);
    expect(brain.capabilities).toContain('IMPORTANT: read this');
    expect(brain.capabilities).toContain('Line two of capabilities.');
  });

  it('R-673-12: section at end-of-string returns body up to EOF', () => {
    // VARIABLES is the last section (no trailing newline) — exercises the \\Z / (?![\\s\\S]) path.
    const raw = [
      'TOOL: pkt673_test', 'VERSION: 1.0', '',
      'CAPABILITIES:', 'cap', '',
      'LIMITATIONS:', 'lim', '',
      'FAILURE MODES:', 'fm', '',
      'BEST PRACTICES:', 'bp', '',
      'EXECUTION ORDER:', '1. step', '',
      'OUTPUT CONTRACT:', '{}', '',
      'GENOME SECTIONS:', 'IDENTITY: x', 'EXECUTION: y', 'BEHAVIOR: z', 'CHECKSUM: w', '',
      'VARIABLES:', 'task: the task',
    ].join('\n'); // intentionally no trailing newline
    const brain = parseMsbContent(raw);
    expect(brain.variables).toHaveProperty('task', 'the task');
  });

  it('R-673-13: all canonical seed/msb/ files parse without error', () => {
    const msbDir = 'seed/msb';
    const files = readdirSync(msbDir).filter(f => f.endsWith('.msb'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = readFileSync(`${msbDir}/${file}`, 'utf-8');
      expect(() => parseMsbContent(raw, `${msbDir}/${file}`)).not.toThrow();
    }
  });

  it('R-673-14: API_KEY: inside CAPABILITIES body is allowed (underscore not in whitelist)', () => {
    const raw = make673Msb({
      capabilities: 'Requires API_KEY: env var to be set.\nSecond line of capabilities.',
    });
    const brain = parseMsbContent(raw);
    expect(brain.capabilities).toContain('API_KEY:');
    expect(brain.capabilities).toContain('Second line of capabilities.');
  });
});

// PKT-705 — extractSection ALL-CAPS phrase boundary defect
//
// The old boundary regex `\n[A-Z ]+:` matched any inline ALL-CAPS phrase,
// silently truncating section content. The fix restricts the lookahead to
// known required-section boundaries only.
// ---------------------------------------------------------------------------

const ALLCAPS_PHRASE_IN_LIMITATIONS_MSB = `\
TOOL: web_search
VERSION: 1.0

CAPABILITIES:
Searches the web for information.

LIMITATIONS:
Cannot access pages behind authentication.
API KEYS: requires an API key in the environment.
Cannot send request bodies.

FAILURE MODES:
Network timeout: retry with backoff.

BEST PRACTICES:
Keep queries specific and short.

EXECUTION ORDER:
1. Validate query
2. Submit to backend
3. Parse results

OUTPUT CONTRACT:
{"result":"string","url":"string"}

GENOME SECTIONS:
IDENTITY: search identity
EXECUTION: search execution
BEHAVIOR: search behavior
CHECKSUM: 0xdeadbeef

VARIABLES:
task: the natural language task
query: the search query string
`;

const ALLCAPS_PHRASE_IN_CAPABILITIES_MSB = `\
TOOL: http_tool
VERSION: 1.0

CAPABILITIES:
Sends HTTP requests.
HTTP ERRORS: maps 4xx/5xx codes to structured error objects.
Returns parsed JSON bodies.

LIMITATIONS:
Cannot follow more than 5 redirects.

FAILURE MODES:
TLS HANDSHAKE: fails on self-signed certs.

BEST PRACTICES:
AUTH HEADER: always include Authorization header.

EXECUTION ORDER:
1. Build request
2. Send
3. Parse response

OUTPUT CONTRACT:
{"status":"number","body":"any"}

GENOME SECTIONS:
IDENTITY: http identity
EXECUTION: http execution
BEHAVIOR: http behavior
CHECKSUM: 0xcafe

VARIABLES:
url: the target URL
`;

const MULTI_ALLCAPS_MSB = `\
TOOL: multi_tool
VERSION: 2.0

CAPABILITIES:
Generic tool.
RATE LIMIT: 100 requests per minute.
MAX RETRIES: up to 3 retries.

LIMITATIONS:
URL REDIRECT: max 3 hops.
GZIP ENCODING: automatic decompression.

FAILURE MODES:
JSON PARSE: fails on malformed UTF-8.

BEST PRACTICES:
Set a request timeout.

EXECUTION ORDER:
1. Validate
2. Execute

OUTPUT CONTRACT:
{}

GENOME SECTIONS:
IDENTITY: multi identity
EXECUTION: multi execution
BEHAVIOR: multi behavior
CHECKSUM: 0x1234

VARIABLES:
task: the task
`;

describe('msb/msb-loader — PKT-705: ALL-CAPS phrase in section body does not truncate content', () => {
  it('R-601: LIMITATIONS with inline "API KEYS:" phrase → full content preserved, not truncated at the phrase', () => {
    const brain = parseMsbContent(ALLCAPS_PHRASE_IN_LIMITATIONS_MSB);
    expect(brain.limitations).toContain('Cannot access pages behind authentication.');
    expect(brain.limitations).toContain('API KEYS: requires an API key in the environment.');
    expect(brain.limitations).toContain('Cannot send request bodies.');
  });

  it('R-602: CAPABILITIES with inline "HTTP ERRORS:" phrase → full content preserved', () => {
    const brain = parseMsbContent(ALLCAPS_PHRASE_IN_CAPABILITIES_MSB);
    expect(brain.capabilities).toContain('Sends HTTP requests.');
    expect(brain.capabilities).toContain('HTTP ERRORS: maps 4xx/5xx codes to structured error objects.');
    expect(brain.capabilities).toContain('Returns parsed JSON bodies.');
  });

  it('R-603: FAILURE MODES with inline "TLS HANDSHAKE:" phrase → full content preserved', () => {
    const brain = parseMsbContent(ALLCAPS_PHRASE_IN_CAPABILITIES_MSB);
    expect(brain.failureModes).toContain('TLS HANDSHAKE: fails on self-signed certs.');
  });

  it('R-604: BEST PRACTICES with inline "AUTH HEADER:" phrase → full content preserved', () => {
    const brain = parseMsbContent(ALLCAPS_PHRASE_IN_CAPABILITIES_MSB);
    expect(brain.bestPractices).toContain('AUTH HEADER: always include Authorization header.');
  });

  it('R-605: CAPABILITIES with "RATE LIMIT:" and "MAX RETRIES:" multi-word ALL-CAPS phrases → both lines preserved', () => {
    const brain = parseMsbContent(MULTI_ALLCAPS_MSB);
    expect(brain.capabilities).toContain('RATE LIMIT: 100 requests per minute.');
    expect(brain.capabilities).toContain('MAX RETRIES: up to 3 retries.');
  });

  it('R-606: LIMITATIONS with "URL REDIRECT:" and "GZIP ENCODING:" → both lines preserved', () => {
    const brain = parseMsbContent(MULTI_ALLCAPS_MSB);
    expect(brain.limitations).toContain('URL REDIRECT: max 3 hops.');
    expect(brain.limitations).toContain('GZIP ENCODING: automatic decompression.');
  });

  it('R-607: FAILURE MODES with "JSON PARSE:" → line preserved', () => {
    const brain = parseMsbContent(MULTI_ALLCAPS_MSB);
    expect(brain.failureModes).toContain('JSON PARSE: fails on malformed UTF-8.');
  });

  it('R-608 (regression): legitimate section boundary still correctly terminates the prior section', () => {
    // CAPABILITIES must stop at LIMITATIONS; must NOT bleed into LIMITATIONS content.
    const brain = parseMsbContent(ALLCAPS_PHRASE_IN_LIMITATIONS_MSB);
    expect(brain.capabilities).toBe('Searches the web for information.');
    expect(brain.limitations).not.toContain('Searches the web for information.');
  });

  it('R-609 (regression): lowercase colon phrase does not truncate (control — already passing)', () => {
    const msb = ALLCAPS_PHRASE_IN_LIMITATIONS_MSB.replace(
      'API KEYS: requires an API key in the environment.',
      'api keys: requires an API key in the environment.',
    );
    const brain = parseMsbContent(msb);
    expect(brain.limitations).toContain('api keys: requires an API key in the environment.');
    expect(brain.limitations).toContain('Cannot send request bodies.');
  });

  it('R-610 (regression): mixed-case colon phrase does not truncate (control — already passing)', () => {
    const msb = ALLCAPS_PHRASE_IN_LIMITATIONS_MSB.replace(
      'API KEYS: requires an API key in the environment.',
      'Api Keys: requires an API key in the environment.',
    );
    const brain = parseMsbContent(msb);
    expect(brain.limitations).toContain('Api Keys: requires an API key in the environment.');
    expect(brain.limitations).toContain('Cannot send request bodies.');
  });
});

// ---------------------------------------------------------------------------
// PKT-662: strict integer parsing — silent truncation / overflow guard
// ---------------------------------------------------------------------------

describe('msb/msb-loader — extractParameterSchema — PKT-662 strict-int parsing', () => {
  it('R-662-1: float-shaped xcode_index "3.7" → throws "numeric field must be an integer"', () => {
    const msb = VALID_MSB.replace(
      'max_attempts|0|1|5|1|lower|Maximum retry attempts',
      'foo|3.7|1|5|1|lower|desc'
    );
    expect(() => parseMsbContent(msb)).toThrow(/numeric field must be an integer.*3\.7/);
  });

  it('R-662-2: partial-digit default "5abc999" → throws "numeric field must be an integer"', () => {
    const msb = VALID_MSB.replace(
      'max_attempts|0|1|5|1|lower|Maximum retry attempts',
      'foo|0|1|10|5abc999|lower|desc'
    );
    expect(() => parseMsbContent(msb)).toThrow(/numeric field must be an integer.*5abc999/);
  });

  it('R-662-3: scientific-notation range_max "5e10" → throws "numeric field must be an integer"', () => {
    const msb = VALID_MSB.replace(
      'max_attempts|0|1|5|1|lower|Maximum retry attempts',
      'foo|0|1|5e10|5|lower|desc'
    );
    expect(() => parseMsbContent(msb)).toThrow(/numeric field must be an integer.*5e10/);
  });

  it('R-662-4: integer-overflow range_max "99999999999999999999999999" → throws "out of range"', () => {
    const msb = VALID_MSB.replace(
      'max_attempts|0|1|5|1|lower|Maximum retry attempts',
      'foo|0|1|99999999999999999999999999|5|lower|desc'
    );
    expect(() => parseMsbContent(msb)).toThrow(/out of range/);
  });

  it('R-662-5: float default "7.7" → throws "numeric field must be an integer"', () => {
    const msb = VALID_MSB.replace(
      'max_attempts|0|1|5|1|lower|Maximum retry attempts',
      'foo|0|1|10|7.7|lower|desc'
    );
    expect(() => parseMsbContent(msb)).toThrow(/numeric field must be an integer.*7\.7/);
  });

  it('R-662-6: leading-plus "+5" still accepted (parity with Python int())', () => {
    const msb = VALID_MSB.replace(
      'max_attempts|0|1|5|1|lower|Maximum retry attempts',
      'foo|0|+1|+5|+1|lower|desc'
    );
    expect(() => parseMsbContent(msb)).not.toThrow();
    const brain = parseMsbContent(msb);
    expect(brain.parameterSchema[0]!.rangeMin).toBe(1);
    expect(brain.parameterSchema[0]!.rangeMax).toBe(5);
    expect(brain.parameterSchema[0]!.default).toBe(1);
  });
});
