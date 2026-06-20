/**
 * telemetry-writer.test.ts
 *
 * Security + behavior tests for TelemetryWriter and its filename sanitizer.
 *
 * Focus: a caller-supplied `reportCode` / `taskId` is interpolated into the
 * telemetry filename. Without validation, a value like "../../../foo" or one
 * containing a path separator is a path-traversal WRITE primitive. These tests
 * assert that:
 *   1. Traversal / malformed segments are REJECTED (throw) and write NO file.
 *   2. Well-formed segments still write the correct file with correct content,
 *      inside the dated telemetry directory and nowhere else.
 *
 * Sandboxing: PATHS.telemetry is derived from ALIENCLAW_HOME at module-load
 * time, so we point ALIENCLAW_HOME at a fresh temp dir BEFORE importing the
 * writer (dynamic import), mirroring the codebase's other fs-touching specs.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

// These are bound in beforeAll after ALIENCLAW_HOME is set.
let TelemetryWriter: typeof import('../../src/alienclaw/telemetry/telemetry-writer.js')['TelemetryWriter'];
let sanitizeFilenameSegment: typeof import('../../src/alienclaw/telemetry/telemetry-writer.js')['sanitizeFilenameSegment'];
let TelemetryFilenameError: typeof import('../../src/alienclaw/telemetry/telemetry-writer.js')['TelemetryFilenameError'];

let homeDir: string;
let telemetryRoot: string;

/** The dated dir the writer targets for "now". */
function datedDir(): string {
  return join(telemetryRoot, new Date().toISOString().slice(0, 10));
}

/** All files written anywhere under the temp home (for leak detection). */
function allFilesUnder(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFilesUnder(full));
    else out.push(full);
  }
  return out;
}

beforeAll(async () => {
  // Fresh, isolated ALIENCLAW_HOME for this file, set BEFORE the writer imports.
  homeDir = mkdtempSync(join(tmpdir(), 'alienclaw-telemetry-writer-'));
  process.env['ALIENCLAW_HOME'] = homeDir;

  const mod = await import('../../src/alienclaw/telemetry/telemetry-writer.js');
  TelemetryWriter = mod.TelemetryWriter;
  sanitizeFilenameSegment = mod.sanitizeFilenameSegment;
  TelemetryFilenameError = mod.TelemetryFilenameError;

  // Confirm the writer actually resolved its root under our temp home — if not,
  // every assertion below would be meaningless.
  const { PATHS } = await import('../../src/alienclaw/constants.js');
  telemetryRoot = PATHS.telemetry;
  expect(telemetryRoot.startsWith(homeDir)).toBe(true);
});

afterAll(() => {
  if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  delete process.env['ALIENCLAW_HOME'];
});

beforeEach(() => {
  // Clean telemetry tree between tests so leak detection is exact.
  if (existsSync(telemetryRoot)) rmSync(telemetryRoot, { recursive: true, force: true });
});

// ───────────────────────────────────────────────────────────────────────────
// sanitizeFilenameSegment — the unit
// ───────────────────────────────────────────────────────────────────────────

describe('sanitizeFilenameSegment', () => {
  it('returns well-formed Base62 / id segments unchanged', () => {
    for (const ok of ['AB12cd34', 'report_99', 'task-001', 'a', 'A1b2C3', '___', '---', 'x_y-Z9']) {
      expect(sanitizeFilenameSegment(ok)).toBe(ok);
    }
  });

  it('rejects a POSIX relative-traversal sequence', () => {
    expect(() => sanitizeFilenameSegment('../../../foo')).toThrow(TelemetryFilenameError);
    expect(() => sanitizeFilenameSegment('../../../foo')).toThrow(/path separator|\.\./);
  });

  it('rejects any forward-slash path separator', () => {
    expect(() => sanitizeFilenameSegment('a/b')).toThrow(TelemetryFilenameError);
    expect(() => sanitizeFilenameSegment('/etc/passwd')).toThrow(/path separator/);
    expect(() => sanitizeFilenameSegment('nested/dir/file')).toThrow(TelemetryFilenameError);
  });

  it('rejects backslash separators (Windows-style)', () => {
    expect(() => sanitizeFilenameSegment('a\\b')).toThrow(TelemetryFilenameError);
    expect(() => sanitizeFilenameSegment('..\\..\\win')).toThrow(TelemetryFilenameError);
  });

  it('rejects the platform path separator explicitly', () => {
    expect(() => sanitizeFilenameSegment(`a${sep}b`)).toThrow(TelemetryFilenameError);
  });

  it('rejects a bare ".." and any "." (dot is not in the allowlist)', () => {
    expect(() => sanitizeFilenameSegment('..')).toThrow(/\.\./);
    expect(() => sanitizeFilenameSegment('.')).toThrow(TelemetryFilenameError);
    expect(() => sanitizeFilenameSegment('foo.json')).toThrow(/outside \[A-Za-z0-9_-\]/);
    expect(() => sanitizeFilenameSegment('a.b')).toThrow(TelemetryFilenameError);
  });

  it('rejects NUL bytes (poison-null-byte vector)', () => {
    expect(() => sanitizeFilenameSegment('foo\0bar')).toThrow(/NUL/);
    expect(() => sanitizeFilenameSegment('foo\0')).toThrow(TelemetryFilenameError);
  });

  it('rejects empty string and over-long input', () => {
    expect(() => sanitizeFilenameSegment('')).toThrow(/empty/);
    expect(() => sanitizeFilenameSegment('a'.repeat(129))).toThrow(/exceeds/);
    // boundary: exactly 128 is allowed
    expect(sanitizeFilenameSegment('a'.repeat(128))).toBe('a'.repeat(128));
  });

  it('rejects whitespace, control chars, and shell/glob metacharacters', () => {
    for (const bad of ['a b', 'a\tb', 'a\nb', 'foo;rm', 'a$b', 'a|b', 'a*b', 'a?b', 'a~b', 'a&b', '$(x)', '`x`']) {
      expect(() => sanitizeFilenameSegment(bad)).toThrow(TelemetryFilenameError);
    }
  });

  it('rejects non-ASCII / unicode lookalikes', () => {
    expect(() => sanitizeFilenameSegment('café')).toThrow(TelemetryFilenameError);
    // Fullwidth solidus U+FF0F is not the allowlisted set.
    expect(() => sanitizeFilenameSegment('a／b')).toThrow(TelemetryFilenameError);
  });

  it('uses the provided label in the error message', () => {
    expect(() => sanitizeFilenameSegment('../x', 'reportCode')).toThrow(/reportCode/);
    expect(() => sanitizeFilenameSegment('', 'taskId')).toThrow(/taskId/);
  });

  it('rejects non-string input defensively', () => {
    // Callers are typed to string, but a runtime non-string must not slip through.
    expect(() => sanitizeFilenameSegment(undefined as unknown as string)).toThrow(TelemetryFilenameError);
    expect(() => sanitizeFilenameSegment(123 as unknown as string)).toThrow(/expected a string/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// writeMartianReport — the ship-gate
// ───────────────────────────────────────────────────────────────────────────

describe('TelemetryWriter.writeMartianReport', () => {
  it('writes a well-formed reportCode to the correct dated file with correct content', async () => {
    const w = new TelemetryWriter();
    const code = 'AB12cd34';
    await w.writeMartianReport(code, { martianId: 'compute', outcome: 'SUCCESS', summary: 'ok' });

    const expected = join(datedDir(), `${code}.json`);
    expect(existsSync(expected)).toBe(true);

    const parsed = JSON.parse(readFileSync(expected, 'utf-8'));
    expect(parsed.reportCode).toBe(code);
    expect(parsed.martianId).toBe('compute');
    expect(parsed.outcome).toBe('SUCCESS');
    expect(typeof parsed.ts).toBe('number');

    // Exactly one file written, and it lives in the dated dir.
    const files = allFilesUnder(telemetryRoot);
    expect(files).toEqual([expected]);
  });

  it('THROWS on a traversal reportCode and writes NO file anywhere', async () => {
    const w = new TelemetryWriter();
    await expect(
      w.writeMartianReport('../../../foo', { martianId: 'm', outcome: 'SUCCESS', summary: 's' }),
    ).rejects.toThrow(TelemetryFilenameError);

    // The smoking gun: nothing escaped the boundary, and nothing was written.
    expect(allFilesUnder(telemetryRoot)).toEqual([]);
    // And specifically the attacker target does not exist.
    expect(existsSync(join(telemetryRoot, '..', 'foo.json'))).toBe(false);
    expect(existsSync(join(homeDir, 'foo.json'))).toBe(false);
  });

  it('THROWS on a reportCode containing a path separator', async () => {
    const w = new TelemetryWriter();
    await expect(
      w.writeMartianReport('sub/dir/code', { outcome: 'SUCCESS', summary: 's' }),
    ).rejects.toThrow(/path separator/);
    expect(allFilesUnder(telemetryRoot)).toEqual([]);
  });

  it('THROWS on an absolute-path reportCode (no write outside home)', async () => {
    const w = new TelemetryWriter();
    const abs = join(tmpdir(), 'pwned-telemetry');
    await expect(
      w.writeMartianReport(abs, { outcome: 'SUCCESS', summary: 's' }),
    ).rejects.toThrow(TelemetryFilenameError);
    expect(existsSync(`${abs}.json`)).toBe(false);
  });

  it('THROWS on an empty reportCode', async () => {
    const w = new TelemetryWriter();
    await expect(w.writeMartianReport('', { outcome: 'SUCCESS', summary: 's' })).rejects.toThrow(
      TelemetryFilenameError,
    );
    expect(allFilesUnder(telemetryRoot)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// writeAdvisory — same primitive via taskId
// ───────────────────────────────────────────────────────────────────────────

describe('TelemetryWriter.writeAdvisory', () => {
  it('writes a well-formed taskId to advisory_<taskId>.json with correct content', async () => {
    const w = new TelemetryWriter();
    const taskId = 'task-0042';
    await w.writeAdvisory(taskId, { advice: 'consult more', tokens: 10 });

    const expected = join(datedDir(), `advisory_${taskId}.json`);
    expect(existsSync(expected)).toBe(true);

    const parsed = JSON.parse(readFileSync(expected, 'utf-8'));
    expect(parsed.taskId).toBe(taskId);
    expect(parsed.advice).toBe('consult more');
    expect(allFilesUnder(telemetryRoot)).toEqual([expected]);
  });

  it('THROWS on a traversal taskId and writes NO file', async () => {
    const w = new TelemetryWriter();
    await expect(w.writeAdvisory('../../escape', { advice: 'x' })).rejects.toThrow(
      TelemetryFilenameError,
    );
    expect(allFilesUnder(telemetryRoot)).toEqual([]);
  });

  it('THROWS when the taskId tries to break out of the advisory_ prefix', async () => {
    // "..%2f"-style raw separator inside the segment must not append a path.
    const w = new TelemetryWriter();
    await expect(w.writeAdvisory('a/../../b', { advice: 'x' })).rejects.toThrow(
      TelemetryFilenameError,
    );
    expect(allFilesUnder(telemetryRoot)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// writeFailforward — regression: numeric ts, no caller segment, still works
// ───────────────────────────────────────────────────────────────────────────

describe('TelemetryWriter.writeFailforward', () => {
  it('writes failforward_<ts>.json inside the dated dir (no traversal surface)', async () => {
    const w = new TelemetryWriter();
    await w.writeFailforward({ reason: 'strike-3', taskId: 'whatever' });

    const files = allFilesUnder(telemetryRoot);
    expect(files).toHaveLength(1);
    const file = files[0]!;
    expect(file.startsWith(datedDir() + sep)).toBe(true);
    expect(/[/\\]failforward_\d+\.json$/.test(file)).toBe(true);

    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    expect(parsed.reason).toBe('strike-3');
    expect(typeof parsed.ts).toBe('number');
  });
});
