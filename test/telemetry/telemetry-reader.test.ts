/**
 * telemetry-reader.test.ts
 *
 * Direct unit tests for `src/alienclaw/telemetry/telemetry-reader.ts` (packet 086).
 *
 * Background:
 *   `telemetry-reader.ts` (98 lines, file size 3,541 bytes) exposes 4 public symbols:
 *     - MartianReport                (type — no runtime surface)
 *     - FitnessSummary               (type — no runtime surface)
 *     - readRecentMartianReports(sinceMs)    (NOT covered — file-IO reader)
 *     - summarizeFitness(martianId, windowMs) (NOT covered — aggregation)
 *
 *   The module has ZERO throw sites (verified §G-1). All failure modes are
 *   catch-and-skip: a missing telemetry dir returns []; unreadable subdirs are
 *   skipped; malformed JSON files are skipped; files without martianId are
 *   skipped; non-report files (advisory_*, failforward_*, agent-channel/) are
 *   skipped.
 *
 *   `readRecentMartianReports` is called by `src/alienclaw/wiring/hierarchy-bootstrap.ts:139, 194`
 *   (production-critical bootstrap path, invoked at CLI startup). `summarizeFitness`
 *   is the fitness aggregator called from the governance loop on every BossBot
 *   schedule tick. A regression in the date-dir filter, the file-prefix filter,
 *   the ts-floor filter, the sort order, or the rate formula would silently
 *   desync BossBot fitness telemetry with no test catching it today.
 *
 * Sandboxing: PATHS.telemetry is derived from ALIENCLAW_HOME at module-load
 * time, so we point ALIENCLAW_HOME at a fresh mkdtempSync dir BEFORE the
 * dynamic import (via `vi.resetModules()`), mirroring the seed-installer /
 * telemetry-writer / registry test patterns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Env setup ────────────────────────────────────────────────────────────────

let homeDir: string;

beforeEach(() => {
  // mkdtempSync is sync; safe at top of beforeEach.
  homeDir = mkdtempSync(join(tmpdir(), 'p086-tel-'));
  process.env['ALIENCLAW_HOME'] = homeDir;
  // Force the module under test to re-evaluate so PATHS picks up the new env.
  vi.resetModules();
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env['ALIENCLAW_HOME'];
  vi.resetModules();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Dynamic-import the module under test AFTER the env is set so PATHS resolves
 * to the temp dir. Returns the two exported functions.
 */
async function loadReader(): Promise<{
  readRecentMartianReports: typeof import('../../src/alienclaw/telemetry/telemetry-reader.js')['readRecentMartianReports'];
  summarizeFitness: typeof import('../../src/alienclaw/telemetry/telemetry-reader.js')['summarizeFitness'];
}> {
  const mod = await import('../../src/alienclaw/telemetry/telemetry-reader.js');
  return {
    readRecentMartianReports: mod.readRecentMartianReports,
    summarizeFitness: mod.summarizeFitness,
  };
}

/**
 * Resolve the telemetry root the reader will scan against, for fixture placement.
 */
async function telemetryRoot(): Promise<string> {
  const { PATHS } = await import('../../src/alienclaw/constants.js');
  return PATHS.telemetry;
}

/**
 * Write a single Martian report JSON file under <root>/<dateDir>/<name>.
 * Defaults to a SUCCESS report; override fields via the partial.
 */
function writeReport(
  root: string,
  dateDir: string,
  filename: string,
  fields: Partial<{
    reportCode: string;
    ts: number;
    taskId: string;
    subagentId: string;
    martianId: string;
    domain: string;
    outcome: 'SUCCESS' | 'FAILURE' | 'ESCALATED';
    summary: string;
  }> = {},
): void {
  const dir = join(root, dateDir);
  mkdirSync(dir, { recursive: true });
  const payload = {
    reportCode:  fields.reportCode  ?? 'r-001',
    ts:          fields.ts          ?? Date.now(),
    taskId:      fields.taskId      ?? 'task-1',
    subagentId:  fields.subagentId  ?? 'sub-1',
    martianId:   fields.martianId   ?? 'martian-A',
    domain:      fields.domain      ?? 'general',
    outcome:     fields.outcome     ?? 'SUCCESS',
    summary:     fields.summary     ?? 'ok',
  };
  writeFileSync(join(dir, filename), JSON.stringify(payload), 'utf-8');
}

// ─── readRecentMartianReports ─────────────────────────────────────────────────

describe('readRecentMartianReports', () => {
  it('returns [] when the telemetry root does not exist', async () => {
    const { readRecentMartianReports } = await loadReader();
    // homeDir exists but telemetry/ subdir does NOT — reader must swallow the
    // ENOENT and return [] (verified source line 72-74).
    const result = await readRecentMartianReports(0);
    expect(result).toEqual([]);
  });

  it('returns [] when telemetry root is empty', async () => {
    const root = await telemetryRoot();
    mkdirSync(root, { recursive: true });
    const { readRecentMartianReports } = await loadReader();
    expect(await readRecentMartianReports(0)).toEqual([]);
  });

  it('skips date directories whose name is lexicographically before the cutoff', async () => {
    const root = await telemetryRoot();
    writeReport(root, '2020-01-01', 'old.json', { ts: 1_577_836_800_000 }); // 2020-01-01
    writeReport(root, '2099-12-31', 'future.json', { ts: 4_102_444_800_000 }); // 2099-12-31
    const { readRecentMartianReports } = await loadReader();
    // sinceMs = 2025-01-01 → cutoff date = '2025-01-01'
    // Source line 48: `if (dateDir < cutoffDate.toISOString().slice(0, 10)) continue;`
    // '2020-01-01' < '2025-01-01' → skipped.
    // '2099-12-31' >= '2025-01-01' → read.
    const sinceMs = Date.UTC(2025, 0, 1);
    const result = await readRecentMartianReports(sinceMs);
    expect(result).toHaveLength(1);
    expect(result[0]!.summary).toBe('ok'); // the future.json entry
  });

  it('reads all reports under a matching date dir regardless of filename', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    writeReport(root, date, 'a.json', { ts: Date.now(), martianId: 'M1' });
    writeReport(root, date, 'b.json', { ts: Date.now() + 1, martianId: 'M2' });
    writeReport(root, date, 'xyz.json', { ts: Date.now() + 2, martianId: 'M3' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.martianId).sort()).toEqual(['M1', 'M2', 'M3']);
  });

  it('skips entries that do not end in .json', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    writeReport(root, date, 'good.json', { ts: Date.now(), martianId: 'M-keep' });
    // .txt and .jsonl must NOT be read (source line 57).
    writeFileSync(join(root, date, 'skipme.txt'), 'noise', 'utf-8');
    writeFileSync(join(root, date, 'skipme.jsonl'), '{"x":1}', 'utf-8');
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result).toHaveLength(1);
    expect(result[0]!.martianId).toBe('M-keep');
  });

  it('skips advisory_ and failforward_ prefixed entries (top-level filename prefix check)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    writeReport(root, date, 'report-001.json', { ts: Date.now(), martianId: 'M-keep' });
    // The advisory_/failforward_ prefix check fires on filename START.
    writeReport(root, date, 'advisory_X1.json', { ts: Date.now(), martianId: 'M-adv' });
    writeReport(root, date, 'failforward_Y2.json', { ts: Date.now(), martianId: 'M-ff' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-keep']);
  });

  it('skips files with malformed JSON (parse error → caught)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    writeReport(root, date, 'good.json', { ts: Date.now(), martianId: 'M-keep' });
    writeFileSync(join(root, date, 'bad.json'), '{not valid json', 'utf-8');
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result).toHaveLength(1);
    expect(result[0]!.martianId).toBe('M-keep');
  });

  it('skips files whose parsed JSON lacks martianId', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    writeReport(root, date, 'with-id.json', { ts: Date.now(), martianId: 'M-keep' });
    writeFileSync(
      join(root, date, 'no-id.json'),
      JSON.stringify({ ts: Date.now(), reportCode: 'r', outcome: 'SUCCESS' }),
      'utf-8',
    );
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result).toHaveLength(1);
    expect(result[0]!.martianId).toBe('M-keep');
  });

  it('skips files whose ts is before the sinceMs floor', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'old.json', { ts: now - 10_000, martianId: 'M-old' });
    writeReport(root, date, 'fresh.json', { ts: now, martianId: 'M-fresh' });
    const { readRecentMartianReports } = await loadReader();
    // Pass sinceMs = now → only ts >= now kept.
    const result = await readRecentMartianReports(now);
    expect(result.map(r => r.martianId)).toEqual(['M-fresh']);
  });

  it('skips a date directory whose readdir throws (caught → continue)', async () => {
    // Simulate "unreadable dir" by writing a FILE at the path the reader would
    // expect to be a directory. readdir() on a file throws ENOTDIR → source
    // line 53 catch → continue (the file-as-dir case is one path; permission
    // denial is the other — both end up in the same catch).
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    // Ensure the parent (telemetry root) exists, then plant a FILE where the
    // reader will try to open a directory.
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, date), 'not a directory', 'utf-8');
    // Plus a valid dir to confirm we still walk it.
    const otherDate = '2099-01-01';
    writeReport(root, otherDate, 'ok.json', { ts: Date.now() + 1000, martianId: 'M-ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-ok']);
  });

  it('returns the result sorted by ts ascending', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const base = Date.now();
    writeReport(root, date, 'c.json', { ts: base + 200, martianId: 'M3' });
    writeReport(root, date, 'a.json', { ts: base, martianId: 'M1' });
    writeReport(root, date, 'b.json', { ts: base + 100, martianId: 'M2' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M1', 'M2', 'M3']);
  });

  it('aggregates reports across multiple date directories in chronological order', async () => {
    const root = await telemetryRoot();
    const base = Date.now();
    writeReport(root, '2099-01-02', 'b.json', { ts: base + 200, martianId: 'M2' });
    writeReport(root, '2099-01-01', 'a.json', { ts: base + 100, martianId: 'M1' });
    writeReport(root, '2099-01-03', 'c.json', { ts: base + 300, martianId: 'M3' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M1', 'M2', 'M3']);
  });
});

// ─── summarizeFitness ─────────────────────────────────────────────────────────

describe('summarizeFitness', () => {
  it('returns rate=0 and zeros when no reports match the martianId', async () => {
    const { summarizeFitness } = await loadReader();
    // No telemetry dir → reports is [] → relevant is [] → rate = 0.
    const summary = await summarizeFitness('M-nonesuch', 60_000);
    expect(summary).toEqual({
      runs: 0,
      successes: 0,
      escalations: 0,
      failures: 0,
      rate: 0,
    });
  });

  it('counts outcomes correctly for a single Martian', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 's1.json', { ts: now, martianId: 'M-target', outcome: 'SUCCESS' });
    writeReport(root, date, 's2.json', { ts: now + 1, martianId: 'M-target', outcome: 'SUCCESS' });
    writeReport(root, date, 'f1.json', { ts: now + 2, martianId: 'M-target', outcome: 'FAILURE' });
    writeReport(root, date, 'e1.json', { ts: now + 3, martianId: 'M-target', outcome: 'ESCALATED' });
    // An irrelevant Martian — must NOT be counted.
    writeReport(root, date, 'other.json', { ts: now + 4, martianId: 'M-other', outcome: 'SUCCESS' });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M-target', 60_000);
    expect(summary.runs).toBe(4);
    expect(summary.successes).toBe(2);
    expect(summary.failures).toBe(1);
    expect(summary.escalations).toBe(1);
    expect(summary.rate).toBe(0.5); // 2/4
  });

  it('excludes reports whose ts is older than (now - windowMs)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    // Write a report with ts in the past; since windowMs is small, readRecent
    // will see it but the floor on ts >= sinceMs will filter it. However
    // summarizeFitness passes (now - windowMs) which is ~now, so anything
    // materially older is dropped.
    writeReport(root, date, 'old.json', { ts: now - 10_000, martianId: 'M1', outcome: 'SUCCESS' });
    writeReport(root, date, 'new.json', { ts: now, martianId: 'M1', outcome: 'SUCCESS' });
    const { summarizeFitness } = await loadReader();
    // windowMs=1000 → sinceMs = now - 1000. The "old" report (ts = now-10000)
    // is below the floor and is filtered out by readRecentMartianReports.
    const summary = await summarizeFitness('M1', 1_000);
    expect(summary.runs).toBe(1);
    expect(summary.successes).toBe(1);
    expect(summary.rate).toBe(1);
  });

  it('returns rate=1 when all matching reports succeed', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'a.json', { ts: now, martianId: 'M1', outcome: 'SUCCESS' });
    writeReport(root, date, 'b.json', { ts: now + 1, martianId: 'M1', outcome: 'SUCCESS' });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M1', 60_000);
    expect(summary.runs).toBe(2);
    expect(summary.rate).toBe(1);
  });

  it('returns rate=0 when all matching reports fail or escalate', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'f.json', { ts: now, martianId: 'M1', outcome: 'FAILURE' });
    writeReport(root, date, 'e.json', { ts: now + 1, martianId: 'M1', outcome: 'ESCALATED' });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M1', 60_000);
    expect(summary.runs).toBe(2);
    expect(summary.successes).toBe(0);
    expect(summary.failures).toBe(1);
    expect(summary.escalations).toBe(1);
    expect(summary.rate).toBe(0);
  });

  it('does not double-count irrelevant Martians', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'a.json', { ts: now, martianId: 'M-A', outcome: 'SUCCESS' });
    writeReport(root, date, 'b.json', { ts: now + 1, martianId: 'M-B', outcome: 'FAILURE' });
    writeReport(root, date, 'c.json', { ts: now + 2, martianId: 'M-C', outcome: 'ESCALATED' });
    const { summarizeFitness } = await loadReader();
    const a = await summarizeFitness('M-A', 60_000);
    const b = await summarizeFitness('M-B', 60_000);
    const c = await summarizeFitness('M-C', 60_000);
    expect(a.runs).toBe(1);
    expect(a.successes).toBe(1);
    expect(a.rate).toBe(1);
    expect(b.runs).toBe(1);
    expect(b.successes).toBe(0);
    expect(b.failures).toBe(1);
    expect(b.rate).toBe(0);
    expect(c.runs).toBe(1);
    expect(c.escalations).toBe(1);
    expect(c.rate).toBe(0);
  });
});
