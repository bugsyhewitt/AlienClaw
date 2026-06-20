/**
 * ms-loader.test.ts — Direct unit tests for the 3 public exports of
 * src/alienclaw/registry/ms-loader.ts (packet 071).
 *
 * Background:
 *   ms-loader.ts (240 lines, on origin/main c0f56a87) exposes 3 public symbols:
 *     - MsParseError                          (custom Error subclass)
 *     - loadMsFile(filePath)                  (parse one .ms file → MartianSpec)
 *     - loadMsDirectory(dir, options?)        (parse all .ms files in a directory)
 *
 *   The module has 4 internal helpers not directly unit-tested today:
 *     - parseMetadata(lines)                  (extract description/generation/status/fitness from comments)
 *     - parseFirstCommentId(lines)            (extract MS_XXXXXXXX from comments)
 *     - extractSection(lines, sectionName)    (extract [SECTION] content, skipping blank/comment lines)
 *     - parseTools(toolsSection, filePath?)   (parse numbered/unnumbered tool lines, enforce MAX_MS_TOOLS)
 *     - parseGraveyard(graveyardSection?)     (parse [GRAVEYARD] entries)
 *
 *   `loadMsFile` and `loadMsDirectory` are called by:
 *     - src/alienclaw/registry/registry.ts:25             (sync wrapper — called at CLI startup)
 *     - src/alienclaw/registry/martian-registry.ts:64     (async loader — called at CLI startup)
 *   Every Martian execution depends on a successfully-parsed spec from this module.
 *   A regression in the MAX_MS_TOOLS guard (line 113), the missing-tool throw sites (lines 158, 175, 177-180,
 *   184, 186), or the directory missing-vs-strict branch (line 221) would silently corrupt Martian selection
 *   at CLI startup with no test catching it.
 *
 * These tests use the mkdtempSync + writeFileSync idiom: write synthesized .ms content to a temp dir,
 * call the parser, clean up with rmSync. No coupling to PATHS.home, no real seed files, no LLM.
 *
 * Genome fixture assembly uses `assembleGenome(identity, execution, behavior)` from genome-codec —
 * the same primitive seed-installer.ts uses for the canonical 3 SEED_SPECS .ms files (verified §G-9).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MsParseError, loadMsFile, loadMsDirectory } from '../../src/alienclaw/registry/ms-loader.js';
import { assembleGenome, BASE62_ALPHABET } from '../../src/alienclaw/registry/genome-codec.js';
import { MAX_MS_TOOLS } from '../../src/alienclaw/constants.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a valid 256-char Base62 genome from arbitrary identity/execution/behavior
 * sections. The 4th section (checksum) is computed by `assembleGenome` (FNV-1a of sections 0-2).
 * This is the SAME primitive `seed-installer.ts:117` uses for its canonical SEED_SPECS.
 *
 * NOTE: Base62 alphabet is `0-9A-Za-z` (62 chars); no underscore, no hyphen. Section input
 * MUST contain only Base62 chars or it will be sanitized by the `pad` helper below.
 */
function buildValidGenome(identity: string, execution: string, behavior: string): string {
  // Sanitize: replace any non-Base62 char with '0', then pad with '0' to section length.
  const sanitize = (s: string, n: number) => {
    const set = new Set(BASE62_ALPHABET);
    const chars = [...s].map(c => set.has(c) ? c : '0');
    return chars.join('').padEnd(n, '0').slice(0, n);
  };
  return assembleGenome(sanitize(identity, 64), sanitize(execution, 64), sanitize(behavior, 64));
}

// Note: the Martian ID comment ("# MS_TEST0001") is NOT inside the genome; it's a metadata
// comment. The IDENTITY section of the genome is just 64 chars of Base62 (no semantic meaning).
const VALID_GENOME_A = buildValidGenome('MSATEST0001', 'AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB');
const VALID_GENOME_B = buildValidGenome('MSATEST0002', 'CCCCCCCCCCCCCCCC', 'DDDDDDDDDDDDDDDD');
const VALID_GENOME_C = buildValidGenome('MSATEST0003', 'EEEEEEEEEEEEEEEE', 'FFFFFFFFFFFFFFFF');

/**
 * Build a syntactically-valid .ms file body for the given genome + Martian ID.
 * The `description`, `generation`, `status`, `fitness` lines are real metadata
 * (loadMsFile requires all 4). Default `tools` is 1 tool; `toolsCount` overrides.
 */
function buildMsContent(
  genome: string,
  opts: { id?: string; description?: string; generation?: number; status?: string; fitness?: number; toolsCount?: number; msb?: string; toolName?: string } = {},
): string {
  const id          = opts.id          ?? 'MS_TEST0001';
  const description = opts.description ?? 'a test martian';
  const generation  = opts.generation  ?? 1;
  const status      = opts.status      ?? 'active';
  const fitness     = opts.fitness     ?? 0.5;
  const toolsCount  = opts.toolsCount  ?? 1;
  const toolName    = opts.toolName    ?? 'web_search';
  const msb         = opts.msb         ?? 'web_search.msb';
  const toolLines: string[] = [];
  for (let i = 0; i < toolsCount; i++) {
    const name = toolsCount === 1 ? toolName : `${toolName}_${i + 1}`;
    const ref  = toolsCount === 1 ? msb      : `${name}.msb`;
    toolLines.push(`${name} → ${ref}`);
  }
  return [
    `# ${id}`,
    `# description: ${description}`,
    `# generation: ${generation}`,
    `# status: ${status}`,
    `# fitness: ${fitness}`,
    '',
    '[GENOME]',
    genome,
    '',
    '[TOOLS]',
    ...toolLines,
    '',
    '[GRAVEYARD]',
    `0.50 G1 ${VALID_GENOME_A}`,
    '',
  ].join('\n');
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'p071-ms-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── 1. MsParseError — class shape ───────────────────────────────────────────

describe('MsParseError — class shape', () => {
  it('extends Error', () => {
    const e = new MsParseError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(MsParseError);
  });

  it('sets .name = "MsParseError"', () => {
    const e = new MsParseError('boom');
    expect(e.name).toBe('MsParseError');
  });

  it('without filePath, .message is just the raw message', () => {
    const e = new MsParseError('boom');
    expect(e.message).toBe('boom');
  });

  it('with filePath, .message is prefixed "<path>: <message>"', () => {
    const e = new MsParseError('boom', '/tmp/foo.ms');
    expect(e.message).toBe('/tmp/foo.ms: boom');
  });

  it('exposes filePath as a public readonly property', () => {
    const e = new MsParseError('boom', '/tmp/foo.ms');
    expect(e.filePath).toBe('/tmp/foo.ms');
  });

  it('filePath is undefined when not provided', () => {
    const e = new MsParseError('boom');
    expect(e.filePath).toBeUndefined();
  });
});

// ─── 2. loadMsFile — happy path ──────────────────────────────────────────────

describe('loadMsFile() — happy path', () => {
  it('parses a minimal valid .ms file end-to-end', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    writeFileSync(path, buildMsContent(VALID_GENOME_A));

    const spec = loadMsFile(path);

    expect(spec.id).toBe('MS_TEST0001');
    expect(spec.description).toBe('a test martian');
    expect(spec.generation).toBe(1);
    expect(spec.status).toBe('active');
    expect(spec.fitness).toBe(0.5);
    expect(spec.genome).toBe(VALID_GENOME_A);
    expect(spec.tools).toEqual(['web_search']);
    expect(spec.msbRefs).toEqual(['web_search.msb']);
    expect(spec.toolTags).toEqual(['web_search']);
    expect(spec.graveyard).toEqual([
      { fitnessScore: 0.50, generation: 1, genome: VALID_GENOME_A },
    ]);
  });

  it('accepts numbered tool lines ("1. web_search → web_search.msb")', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# description: numbered',
      '# generation: 1',
      '# status: active',
      '# fitness: 0.5',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      '1. web_search → web_search.msb',
      '',
    ].join('\n');
    writeFileSync(path, content);

    const spec = loadMsFile(path);
    expect(spec.tools).toEqual(['web_search']);
    expect(spec.msbRefs).toEqual(['web_search.msb']);
  });

  it('parses multiple graveyard entries', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# description: multi graveyard',
      '# generation: 5',
      '# status: active',
      '# fitness: 0.8',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
      '[GRAVEYARD]',
      `0.50 G1 ${VALID_GENOME_A}`,
      `0.65 G2 ${VALID_GENOME_B}`,
      `0.80 G3 ${VALID_GENOME_C}`,
      '',
    ].join('\n');
    writeFileSync(path, content);

    const spec = loadMsFile(path);
    expect(spec.graveyard).toHaveLength(3);
    expect(spec.graveyard[0]).toEqual({ fitnessScore: 0.50, generation: 1, genome: VALID_GENOME_A });
    expect(spec.graveyard[1]).toEqual({ fitnessScore: 0.65, generation: 2, genome: VALID_GENOME_B });
    expect(spec.graveyard[2]).toEqual({ fitnessScore: 0.80, generation: 3, genome: VALID_GENOME_C });
  });

  it('skips graveyard lines that do not match the expected regex', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# description: junk graveyard',
      '# generation: 1',
      '# status: active',
      '# fitness: 0.5',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
      '[GRAVEYARD]',
      '# this is just a comment, not an entry',
      'not a valid entry either',
      `0.50 G1 ${VALID_GENOME_A}`,
      '',
    ].join('\n');
    writeFileSync(path, content);

    const spec = loadMsFile(path);
    expect(spec.graveyard).toHaveLength(1);
    expect(spec.graveyard[0]!.fitnessScore).toBe(0.50);
  });

  it('omits [GRAVEYARD] section entirely when not present', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# description: no graveyard',
      '# generation: 1',
      '# status: active',
      '# fitness: 0.5',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
    ].join('\n');
    writeFileSync(path, content);

    const spec = loadMsFile(path);
    expect(spec.graveyard).toEqual([]);
  });

  it('uses the FIRST MS_XXXXXXXX comment as the id (later ones are ignored)', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_FIRSTID',
      '# description: dual ids',
      '# generation: 1',
      '# status: active',
      '# fitness: 0.5',
      '# MS_SECONDID',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
    ].join('\n');
    writeFileSync(path, content);

    const spec = loadMsFile(path);
    expect(spec.id).toBe('MS_FIRSTID');
  });
});

// ─── 3. loadMsFile — error paths ─────────────────────────────────────────────

describe('loadMsFile() — error paths', () => {
  it('throws MsParseError "Missing [GENOME] section" when [GENOME] is absent', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# description: no genome',
      '# generation: 1',
      '# status: active',
      '# fitness: 0.5',
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
    ].join('\n');
    writeFileSync(path, content);

    expect(() => loadMsFile(path)).toThrow(MsParseError);
    expect(() => loadMsFile(path)).toThrow(/Missing \[GENOME\] section/);
  });

  it('throws MsParseError with "Genome validation failed" when genome is not 256 chars', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    writeFileSync(path, buildMsContent('A'.repeat(255)));  // 1 char short

    expect(() => loadMsFile(path)).toThrow(MsParseError);
    expect(() => loadMsFile(path)).toThrow(/Genome validation failed/);
  });

  it('throws MsParseError "Missing Martian ID comment" when no MS_ comment line', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# description: no id',
      '# generation: 1',
      '# status: active',
      '# fitness: 0.5',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
    ].join('\n');
    writeFileSync(path, content);

    expect(() => loadMsFile(path)).toThrow(MsParseError);
    expect(() => loadMsFile(path)).toThrow(/Missing Martian ID comment/);
  });

  it('throws MsParseError "Missing # description" when no description line', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# generation: 1',
      '# status: active',
      '# fitness: 0.5',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
    ].join('\n');
    writeFileSync(path, content);

    expect(() => loadMsFile(path)).toThrow(MsParseError);
    expect(() => loadMsFile(path)).toThrow(/Missing # description/);
  });

  it('throws MsParseError "Missing # generation" when no generation line', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# description: no generation',
      '# status: active',
      '# fitness: 0.5',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
    ].join('\n');
    writeFileSync(path, content);

    expect(() => loadMsFile(path)).toThrow(MsParseError);
    expect(() => loadMsFile(path)).toThrow(/Missing # generation/);
  });

  it('throws MsParseError "Missing # status" when no status line', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# description: no status',
      '# generation: 1',
      '# fitness: 0.5',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
    ].join('\n');
    writeFileSync(path, content);

    expect(() => loadMsFile(path)).toThrow(MsParseError);
    expect(() => loadMsFile(path)).toThrow(/Missing # status/);
  });

  it('throws MsParseError "Missing # fitness" when no fitness line', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# description: no fitness',
      '# generation: 1',
      '# status: active',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
    ].join('\n');
    writeFileSync(path, content);

    expect(() => loadMsFile(path)).toThrow(MsParseError);
    expect(() => loadMsFile(path)).toThrow(/Missing # fitness/);
  });

  it('throws MsParseError "Missing [TOOLS] section" when [TOOLS] is absent', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# description: no tools',
      '# generation: 1',
      '# status: active',
      '# fitness: 0.5',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
    ].join('\n');
    writeFileSync(path, content);

    expect(() => loadMsFile(path)).toThrow(MsParseError);
    expect(() => loadMsFile(path)).toThrow(/Missing \[TOOLS\] section/);
  });

  it('throws MsParseError "[TOOLS] section is empty" when [TOOLS] has no parseable tool lines', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# MS_TEST0001',
      '# description: empty tools',
      '# generation: 1',
      '# status: active',
      '# fitness: 0.5',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'this is not a tool line, just prose',
      '',
    ].join('\n');
    writeFileSync(path, content);

    expect(() => loadMsFile(path)).toThrow(MsParseError);
    expect(() => loadMsFile(path)).toThrow(/\[TOOLS\] section is empty/);
  });

  it('throws MsParseError when [TOOLS] exceeds MAX_MS_TOOLS', () => {
    expect(MAX_MS_TOOLS).toBe(4);
    const path = join(tmpDir, 'MS_TEST0001.ms');
    writeFileSync(path, buildMsContent(VALID_GENOME_A, { toolsCount: MAX_MS_TOOLS + 1 }));

    expect(() => loadMsFile(path)).toThrow(MsParseError);
    expect(() => loadMsFile(path)).toThrow(/maximum is 4/);
  });

  it('accepts exactly MAX_MS_TOOLS tool lines (boundary)', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    writeFileSync(path, buildMsContent(VALID_GENOME_A, { toolsCount: MAX_MS_TOOLS }));

    const spec = loadMsFile(path);
    expect(spec.tools).toHaveLength(MAX_MS_TOOLS);
  });

  it('every MsParseError thrown from loadMsFile carries the filePath', () => {
    const path = join(tmpDir, 'MS_TEST0001.ms');
    const content = [
      '# description: no id',
      '# generation: 1',
      '# status: active',
      '# fitness: 0.5',
      '',
      '[GENOME]',
      VALID_GENOME_A,
      '',
      '[TOOLS]',
      'web_search → web_search.msb',
      '',
    ].join('\n');
    writeFileSync(path, content);

    try {
      loadMsFile(path);
      throw new Error('expected loadMsFile to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MsParseError);
      expect((err as MsParseError).filePath).toBe(path);
      expect((err as MsParseError).message.startsWith(path)).toBe(true);
    }
  });
});

// ─── 4. loadMsDirectory — happy path ─────────────────────────────────────────

describe('loadMsDirectory() — happy path', () => {
  it('returns specs for all .ms files in the directory', () => {
    writeFileSync(join(tmpDir, 'MS_TEST0001.ms'), buildMsContent(VALID_GENOME_A, { id: 'MS_TEST0001' }));
    writeFileSync(join(tmpDir, 'MS_TEST0002.ms'), buildMsContent(VALID_GENOME_B, { id: 'MS_TEST0002' }));
    writeFileSync(join(tmpDir, 'MS_TEST0003.ms'), buildMsContent(VALID_GENOME_C, { id: 'MS_TEST0003' }));

    const { specs, errors } = loadMsDirectory(tmpDir);

    expect(errors).toEqual([]);
    expect(specs).toHaveLength(3);
    expect(specs.map(s => s.id).sort()).toEqual(['MS_TEST0001', 'MS_TEST0002', 'MS_TEST0003']);
  });

  it('ignores non-.ms files (e.g. .md, .txt, .json)', () => {
    writeFileSync(join(tmpDir, 'MS_TEST0001.ms'), buildMsContent(VALID_GENOME_A));
    writeFileSync(join(tmpDir, 'README.md'), '# alienclaw');
    writeFileSync(join(tmpDir, 'config.json'), '{}');
    writeFileSync(join(tmpDir, 'notes.txt'), 'hello');

    const { specs, errors } = loadMsDirectory(tmpDir);
    expect(errors).toEqual([]);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.id).toBe('MS_TEST0001');
  });

  it('returns empty specs and empty errors for an empty directory', () => {
    mkdirSync(join(tmpDir, 'empty'), { recursive: true });
    const { specs, errors } = loadMsDirectory(join(tmpDir, 'empty'));
    expect(specs).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('returns empty specs and empty errors for a missing directory (non-strict default)', () => {
    const missingDir = join(tmpDir, 'does-not-exist');
    expect(existsSync(missingDir)).toBe(false);
    const { specs, errors } = loadMsDirectory(missingDir);
    expect(specs).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// ─── 5. loadMsDirectory — error paths ────────────────────────────────────────

describe('loadMsDirectory() — error paths', () => {
  it('skips malformed files in non-strict mode and reports them in errors[]', () => {
    writeFileSync(join(tmpDir, 'MS_GOOD.ms'), buildMsContent(VALID_GENOME_A, { id: 'MS_GOOD' }));
    writeFileSync(join(tmpDir, 'MS_BAD.ms'), 'not a valid .ms file');

    const { specs, errors } = loadMsDirectory(tmpDir);

    expect(specs).toHaveLength(1);
    expect(specs[0]!.id).toBe('MS_GOOD');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe(join(tmpDir, 'MS_BAD.ms'));
    expect(typeof errors[0]!.error).toBe('string');
    expect(errors[0]!.error.length).toBeGreaterThan(0);
  });

  it('throws MsParseError on the first malformed file in strict mode', () => {
    writeFileSync(join(tmpDir, 'MS_BAD.ms'), 'not a valid .ms file');

    expect(() => loadMsDirectory(tmpDir, { strict: true })).toThrow(MsParseError);
  });

  it('throws MsParseError "Registry directory not found" for a missing dir in strict mode', () => {
    const missingDir = join(tmpDir, 'does-not-exist');
    expect(existsSync(missingDir)).toBe(false);

    expect(() => loadMsDirectory(missingDir, { strict: true })).toThrow(MsParseError);
    expect(() => loadMsDirectory(missingDir, { strict: true })).toThrow(/Registry directory not found/);
  });
});