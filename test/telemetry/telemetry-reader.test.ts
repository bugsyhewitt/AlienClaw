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
 *   skipped; non-report files (advisory_*, failforward_*) are skipped; entries
 *   whose basename starts with "agent-channel" are skipped (the subdirectory is
 *   caught first by the .json extension guard; top-level agent-channel* files
 *   are caught by the explicit prefix check — packet 521).
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

/**
 * Write an arbitrary payload as JSON, bypassing the typed writeReport helper.
 * Required for PKT-704 shape-validation tests that must produce malformed-type fields.
 */
function writeRaw(
  root: string,
  dateDir: string,
  filename: string,
  payload: Record<string, unknown>,
): void {
  const dir = join(root, dateDir);
  mkdirSync(dir, { recursive: true });
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

  it('skips top-level files whose name starts with the agent-channel prefix', async () => {
    // Regression test for packet 521: the dead check `entry.startsWith('agent-channel/')`
    // never fires because readdir returns basenames (no slashes). A top-level file
    // named `agent-channel-leaked.json` passed through unguarded. The fix changes
    // the check to `entry.startsWith('agent-channel')` (no trailing slash).
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    writeReport(root, date, 'good.json', { ts: Date.now(), martianId: 'M-keep' });
    writeReport(root, date, 'agent-channel-leaked.json', { ts: Date.now() + 1, martianId: 'M-leak' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-keep']);
  });

  it('skips the agent-channel/ subdirectory via the .json extension guard', async () => {
    // The agent-channel subdirectory entry (`agent-channel`, no trailing slash,
    // no .json extension) is filtered by `!entry.endsWith('.json')` at line 69.
    // This test documents that existing behaviour and ensures the subdirectory
    // is never recursed into or mistaken for a Martian report.
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const { mkdirSync: mkdir, writeFileSync: write } = await import('node:fs');
    writeReport(root, date, 'good.json', { ts: Date.now(), martianId: 'M-keep' });
    mkdir(join(root, date, 'agent-channel'), { recursive: true });
    write(
      join(root, date, 'agent-channel', 'BossBot-AdvisorBot-1.json'),
      JSON.stringify({ from: 'BossBot', to: 'AdvisorBot', kind: 'request', content: 'x', ts: 1 }),
      'utf-8',
    );
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-keep']);
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
// ── PKT-615: summarizeFitness — malformed outcome enum ────────────────────────

describe('summarizeFitness — malformed outcome enum (PKT-615)', () => {
  function writeRawReport(
    root: string,
    dateDir: string,
    filename: string,
    fields: Record<string, unknown>,
  ): void {
    const dir = join(root, dateDir);
    mkdirSync(dir, { recursive: true });
    const payload = {
      reportCode: 'r-001',
      ts: Date.now(),
      taskId: 'task-1',
      subagentId: 'sub-1',
      martianId: 'M-target',
      domain: 'general',
      outcome: 'SUCCESS',
      summary: 'ok',
      ...fields,
    };
    writeFileSync(join(dir, filename), JSON.stringify(payload), 'utf-8');
  }

  it('PKT615-TR-T1: baseline — 2 SUCCESS + 1 FAILURE returns correct counts without malformed_count', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeRawReport(root, date, 's1.json', { ts: now,     martianId: 'M-x', outcome: 'SUCCESS' });
    writeRawReport(root, date, 's2.json', { ts: now + 1, martianId: 'M-x', outcome: 'SUCCESS' });
    writeRawReport(root, date, 'f1.json', { ts: now + 2, martianId: 'M-x', outcome: 'FAILURE' });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M-x', 60_000);
    expect(summary.runs).toBe(3);
    expect(summary.successes).toBe(2);
    expect(summary.failures).toBe(1);
    expect(summary.rate).toBeCloseTo(2 / 3, 10);
    // No malformed outcomes → malformed_count absent or zero
    expect((summary as unknown as Record<string, unknown>)['malformed_count'] ?? 0).toBe(0);
  });

  it('PKT615-TR-T2: lowercase "unknown" outcome is rejected — runs counts only canonical records', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeRawReport(root, date, 's1.json', { ts: now,     martianId: 'M-x', outcome: 'SUCCESS' });
    writeRawReport(root, date, 's2.json', { ts: now + 1, martianId: 'M-x', outcome: 'SUCCESS' });
    writeRawReport(root, date, 'b1.json', { ts: now + 2, martianId: 'M-x', outcome: 'unknown' });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M-x', 60_000);
    // Ghost filtered: runs=2, not 3; rate=1.0, not 0.667
    expect(summary.runs).toBe(2);
    expect(summary.successes).toBe(2);
    expect(summary.rate).toBe(1);
    expect((summary as unknown as Record<string, unknown>)['malformed_count']).toBe(1);
  });

  it('PKT615-TR-T3: null outcome is rejected — only canonical records count', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeRawReport(root, date, 's1.json', { ts: now,     martianId: 'M-x', outcome: 'SUCCESS' });
    writeRawReport(root, date, 's2.json', { ts: now + 1, martianId: 'M-x', outcome: 'SUCCESS' });
    writeRawReport(root, date, 'b1.json', { ts: now + 2, martianId: 'M-x', outcome: null });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M-x', 60_000);
    expect(summary.runs).toBe(2);
    expect(summary.successes).toBe(2);
    expect(summary.rate).toBe(1);
    expect((summary as unknown as Record<string, unknown>)['malformed_count']).toBe(1);
  });

  it('PKT615-TR-T4: undefined outcome (missing field) is rejected', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeRawReport(root, date, 's1.json', { ts: now,     martianId: 'M-x', outcome: 'SUCCESS' });
    // Write report with no outcome field at all (simulates undefined serialized as missing key)
    const dir = join(root, date);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'b1.json'), JSON.stringify({
      reportCode: 'b1', ts: now + 1, taskId: 't1', subagentId: 's1',
      martianId: 'M-x', domain: 'general', summary: 'no outcome field',
    }), 'utf-8');
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M-x', 60_000);
    expect(summary.runs).toBe(1);
    expect(summary.successes).toBe(1);
    expect(summary.rate).toBe(1);
    expect((summary as unknown as Record<string, unknown>)['malformed_count']).toBe(1);
  });

  it('PKT615-TR-T5: titlecase "Success" outcome is rejected', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeRawReport(root, date, 's1.json', { ts: now,     martianId: 'M-x', outcome: 'SUCCESS' });
    writeRawReport(root, date, 's2.json', { ts: now + 1, martianId: 'M-x', outcome: 'SUCCESS' });
    writeRawReport(root, date, 'b1.json', { ts: now + 2, martianId: 'M-x', outcome: 'Success' });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M-x', 60_000);
    expect(summary.runs).toBe(2);
    expect(summary.successes).toBe(2);
    expect(summary.rate).toBe(1);
    expect((summary as unknown as Record<string, unknown>)['malformed_count']).toBe(1);
  });

  it('PKT615-TR-T6: all-malformed — runs=0, malformed_count=5, rate=0, distinguishable from "broken Martian"', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const malformed = ['unknown', 'Success', null, 'TIMEOUT', 'PARTIAL'];
    malformed.forEach((o, i) => {
      writeRawReport(root, date, `b${i}.json`, { ts: now + i, martianId: 'M-x', outcome: o });
    });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M-x', 60_000);
    expect(summary.runs).toBe(0);
    expect(summary.successes).toBe(0);
    expect(summary.failures).toBe(0);
    expect(summary.escalations).toBe(0);
    expect(summary.rate).toBe(0);
    // malformed_count surfaces the ghost count — BossBot can distinguish
    expect((summary as unknown as Record<string, unknown>)['malformed_count']).toBe(5);
  });

  it('PKT615-TR-T7: empty relevant set — returns zeros without malformed_count', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeRawReport(root, date, 'other.json', { ts: now, martianId: 'M-other', outcome: 'SUCCESS' });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M-target-none', 60_000);
    expect(summary.runs).toBe(0);
    expect(summary.successes).toBe(0);
    expect(summary.failures).toBe(0);
    expect(summary.escalations).toBe(0);
    expect(summary.rate).toBe(0);
    expect((summary as unknown as Record<string, unknown>)['malformed_count'] ?? 0).toBe(0);
  });

  it('PKT615-TR-T8: malformed_count absent (not zero) when all outcomes are canonical (backward-compat)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeRawReport(root, date, 's1.json', { ts: now,     martianId: 'M-x', outcome: 'SUCCESS' });
    writeRawReport(root, date, 'e1.json', { ts: now + 1, martianId: 'M-x', outcome: 'ESCALATED' });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M-x', 60_000);
    expect(summary.runs).toBe(2);
    // malformed_count key must NOT be present when count is zero
    expect('malformed_count' in summary).toBe(false);
  });
});

// ─── Shape validation (PKT-704) ───────────────────────────────────────────────

describe('readRecentMartianReports — shape validation (PKT-704)', () => {
  // ── Defect A: outcome is not a string ──

  it('skips reports whose outcome is a number (not a string)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: 'M-bad', domain: 'g', outcome: 1, summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  it('skips reports whose outcome is a boolean (true)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: 'M-bad', domain: 'g', outcome: true, summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  it('skips reports whose outcome is null', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: 'M-bad', domain: 'g', outcome: null, summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  it('skips reports whose outcome field is absent (undefined)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    // Omit outcome key entirely
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: 'M-bad', domain: 'g', summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  // ── Defect A: outcome is a string but not in the allowed enum ──

  it('skips reports whose outcome is a string typo (SUCCESSS)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: 'M-bad', domain: 'g', outcome: 'SUCCESSS', summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  it('skips reports whose outcome is lowercase (success)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: 'M-bad', domain: 'g', outcome: 'success', summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  it('skips reports whose outcome is an empty string', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: 'M-bad', domain: 'g', outcome: '', summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  // ── Defect B: ts is not a finite number ──

  it('skips reports whose ts is a string', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    // A numeric-looking string — NaN >= sinceMs is false under old code, skipped for wrong reason;
    // new predicate skips it because typeof '...' !== 'number'.
    writeFileSync(
      join(root, date, 'bad.json'),
      JSON.stringify({ reportCode: 'r', ts: '99999999999999', taskId: 't', subagentId: 's', martianId: 'M-bad', domain: 'g', outcome: 'SUCCESS', summary: 'ok' }),
      'utf-8',
    );
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  it('skips reports whose ts is null (what NaN/Infinity serialise to in JSON)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: null, taskId: 't', subagentId: 's', martianId: 'M-bad', domain: 'g', outcome: 'SUCCESS', summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  it('skips reports whose ts is Infinity (non-finite number)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    // 1e309 is parsed as Infinity by JavaScript's JSON.parse; Number.isFinite(Infinity) === false
    writeFileSync(
      join(root, date, 'bad.json'),
      '{"reportCode":"r","ts":1e309,"taskId":"t","subagentId":"s","martianId":"M-bad","domain":"g","outcome":"SUCCESS","summary":"ok"}',
      'utf-8',
    );
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  // ── Defect C: martianId is not a non-empty string ──

  it('skips reports whose martianId is a number', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: 42, domain: 'g', outcome: 'SUCCESS', summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  it('skips reports whose martianId is an object', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: { subvert: 'attempt' }, domain: 'g', outcome: 'SUCCESS', summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  it('skips reports whose martianId is an empty string', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'good.json', { ts: now, martianId: 'M-good' });
    writeRaw(root, date, 'bad.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: '', domain: 'g', outcome: 'SUCCESS', summary: 'ok' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result.map(r => r.martianId)).toEqual(['M-good']);
  });

  // ── Regression guard: valid reports must not be dropped ──

  it('does not drop well-formed reports (regression guard for the predicate)', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    writeReport(root, date, 'a.json', { ts: now,     martianId: 'M1', outcome: 'SUCCESS'   });
    writeReport(root, date, 'b.json', { ts: now + 1, martianId: 'M1', outcome: 'FAILURE'   });
    writeReport(root, date, 'c.json', { ts: now + 2, martianId: 'M1', outcome: 'ESCALATED' });
    const { readRecentMartianReports } = await loadReader();
    const result = await readRecentMartianReports(0);
    expect(result).toHaveLength(3);
  });
});

describe('summarizeFitness — shape validation (PKT-704)', () => {
  it('returns zero-counts when ALL reports in window are malformed-shape', async () => {
    const root = await telemetryRoot();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    // outcome is a number — old code: zeroed successes; new code: whole report skipped
    writeRaw(root, date, 'bad1.json', { reportCode: 'r', ts: now,     taskId: 't', subagentId: 's', martianId: 'M-target', domain: 'g', outcome: 1,    summary: 'ok' });
    writeRaw(root, date, 'bad2.json', { reportCode: 'r', ts: now + 1, taskId: 't', subagentId: 's', martianId: 'M-target', domain: 'g', outcome: true, summary: 'ok' });
    const { summarizeFitness } = await loadReader();
    const summary = await summarizeFitness('M-target', 60_000);
    expect(summary).toEqual({ runs: 0, successes: 0, escalations: 0, failures: 0, rate: 0 });
  });
});
