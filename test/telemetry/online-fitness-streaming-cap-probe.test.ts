/**
 * test/telemetry/online-fitness-streaming-cap-probe.test.ts
 *
 * PKT-1294 — File-A behavioral probe: three TS readers of
 * `~/.alienclaw/online_fitness.jsonl` currently buffer the entire file into a
 * single JS string. Mirror the streaming-read pattern of the Python twin at
 * `src/alienclaw/evolution/online_fitness.py:67-79`. This probe locks the
 * observable behavior on small fixtures (REGRESSION GUARD) and confirms the
 * RED state pre-fix.
 *
 * RED criteria (any one failing = streaming-read not yet in place):
 *   R-013: aggregateOnlineFitness MUST stream (RSS growth ≤ 30 MiB on a 30 MiB fixture).
 *          Pre-fix observes ~115 MiB delta (entire 30 MiB file + UTF-8 string overhead).
 *          Post-fix expects < 30 MiB delta (stream + readline buffers only).
 *   R-014: OnlineFitnessLog.read() returns all entries (the streaming property is intrinsic
 *          to the read-loop — RSS test would be confounded by the parsed-array contract).
 *          Pre-fix post-condition: 200_000 entries returned.
 *          Post-fix post-condition: 200_000 entries returned (identical).
 *   R-015: status.runStatus() MUST stream online_fitness.jsonl (RSS growth ≤ 30 MiB on a
 *          30 MiB fixture). Pre-fix observes ~40 MiB delta (entire 30 MiB file materialized).
 *          Post-fix expects < 30 MiB delta (stream + readline buffers only).
 *   R-016: streaming reads MUST preserve observable behavior on small fixtures
 *          (existing R-002 invariant — count + mean identical).
 *
 * The 30 MiB threshold is a generous upper bound on JS per-line overhead for
 * a 30 MiB fixture. UTF-8 string expansion is ~2-3× raw bytes for ASCII;
 * pre-fix RSS growth on a 30 MiB file exceeds 60 MiB. Post-fix RSS growth
 * is dominated by Node readline + per-line parse buffers, well under 30 MiB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'pkt1294-onfit-stream-'));
  process.env['ALIENCLAW_HOME'] = homeDir;
  vi.resetModules();
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env['ALIENCLAW_HOME'];
  vi.resetModules();
});

function buildLargeFixture(count: number, bytesPerEntry = 150): string[] {
  // Build `count` entries, each ~`bytesPerEntry` bytes long. Default: 200_000 × 150 = 30 MiB.
  const lines: string[] = [];
  const padLen = bytesPerEntry - 50;
  for (let i = 0; i < count; i++) {
    const pad = 'x'.repeat(Math.max(0, padLen));
    lines.push(
      JSON.stringify({
        martian_type: 'mt' + (i % 5),
        fitness:      0.5 + (i % 100) / 1000,
        ts:           new Date(1700000000000 + i * 1000).toISOString(),
        pad,
      }),
    );
  }
  return lines;
}

function forceGcBestEffort(): void {
  if (global.gc) {
    global.gc();
  }
}

async function loadAggregator(): Promise<{
  aggregateOnlineFitness: typeof import('../../src/alienclaw/telemetry/telemetry-reader.js')['aggregateOnlineFitness'];
}> {
  const mod = await import('../../src/alienclaw/telemetry/telemetry-reader.js');
  return { aggregateOnlineFitness: mod.aggregateOnlineFitness };
}

async function loadOnlineFitnessLog(): Promise<{
  OnlineFitnessLog: typeof import('../../src/alienclaw/governance/common/online-fitness-log.js')['OnlineFitnessLog'];
}> {
  const mod = await import('../../src/alienclaw/governance/common/online-fitness-log.js');
  return { OnlineFitnessLog: mod.OnlineFitnessLog };
}

async function loadRunStatus(): Promise<{
  runStatus: typeof import('../../src/alienclaw/cli/status.js')['runStatus'];
}> {
  const mod = await import('../../src/alienclaw/cli/status.js');
  return { runStatus: mod.runStatus };
}

describe('PKT-1294 unbounded-read cap (online_fitness.jsonl streaming)', () => {
  it('R-013 — aggregateOnlineFitness streams (RSS growth ≤ 30 MiB on a 30 MiB fixture)', async () => {
    const lines = buildLargeFixture(200_000);
    const logPath = join(homeDir, 'online_fitness.jsonl');
    writeFileSync(logPath, lines.join('\n') + '\n');

    const { aggregateOnlineFitness } = await loadAggregator();
    forceGcBestEffort();
    const rssBefore = process.memoryUsage().rss;
    const result = await aggregateOnlineFitness('mt1');
    forceGcBestEffort();
    const rssAfter = process.memoryUsage().rss;
    const rssDeltaMiB = (rssAfter - rssBefore) / 1024 / 1024;

    // Pre-fix: rssDeltaMiB ≈ 115 MiB (entire 30 MiB file materialized into UTF-8 string).
    // Post-fix: rssDeltaMiB < 30 MiB (stream + readline buffers only).
    expect(rssDeltaMiB).toBeLessThan(30);
    // Sanity: the streaming reader still returns the expected aggregate on a large fixture.
    expect(result.count).toBe(40_000);  // i % 5 → mt1 every 5th entry
  }, 60_000);

  it('R-014 — OnlineFitnessLog.read() returns all entries from a 30 MiB fixture (regression)', async () => {
    // The streaming-read is intrinsic to the for-await loop; the RSS test would be
    // confounded by the caller's array-return contract. Instead we assert that the
    // read-loop terminates and produces the expected count.
    const lines = buildLargeFixture(200_000);
    const logPath = join(homeDir, 'online_fitness.jsonl');
    writeFileSync(logPath, lines.join('\n') + '\n');

    const { OnlineFitnessLog } = await loadOnlineFitnessLog();
    const log = new OnlineFitnessLog(logPath);
    const entries = log.read();

    expect(entries.length).toBe(200_000);
  }, 60_000);

  it('R-015 — status.runStatus() streams online_fitness.jsonl (RSS growth ≤ 30 MiB on a 30 MiB fixture)', async () => {
    const lines = buildLargeFixture(200_000);
    const logPath = join(homeDir, 'online_fitness.jsonl');
    writeFileSync(logPath, lines.join('\n') + '\n');
    // Also drop a tiny summary file so runStatus() reaches the online_log path
    writeFileSync(join(homeDir, 'live-fitness-summary.json'), JSON.stringify({ martians: [] }));

    const { runStatus } = await loadRunStatus();
    forceGcBestEffort();
    const rssBefore = process.memoryUsage().rss;
    const code = await runStatus(homeDir);
    forceGcBestEffort();
    const rssAfter = process.memoryUsage().rss;
    const rssDeltaMiB = (rssAfter - rssBefore) / 1024 / 1024;

    expect(code).toBe(0);
    // Pre-fix: rssDeltaMiB ≈ 40 MiB (entire 30 MiB file materialized into UTF-8 string).
    // Post-fix: rssDeltaMiB < 30 MiB (stream + readline buffers only).
    expect(rssDeltaMiB).toBeLessThan(30);
  }, 60_000);

  it('R-016 — streaming reads preserve observable behavior on small fixtures (regression guard)', async () => {
    // Existing R-002 invariant: aggregateOnlineFitness returns {count:3, mean:0.8} on a
    // 4-entry log with 3 compute + 1 http_get.
    const logPath = join(homeDir, 'online_fitness.jsonl');
    writeFileSync(logPath, [
      JSON.stringify({ martian_type: 'compute', fitness: 0.8, ts: '2026-07-04T00:00:00Z' }),
      JSON.stringify({ martian_type: 'compute', fitness: 0.6, ts: '2026-07-04T00:01:00Z' }),
      JSON.stringify({ martian_type: 'http_get', fitness: 0.9, ts: '2026-07-04T00:02:00Z' }),
      JSON.stringify({ martian_type: 'compute', fitness: 1.0, ts: '2026-07-04T00:03:00Z' }),
    ].join('\n') + '\n', 'utf-8');
    const { aggregateOnlineFitness } = await loadAggregator();
    const result = await aggregateOnlineFitness('compute');
    expect(result.count).toBe(3);
    expect(result.mean_fitness).toBeCloseTo(0.8, 10);
  });
});
