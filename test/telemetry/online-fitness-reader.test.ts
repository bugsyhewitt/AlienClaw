/**
 * test/telemetry/online-fitness-reader.test.ts
 *
 * Tests for aggregateOnlineFitness() — added to telemetry-reader.ts by packet 145.
 * Uses vi.resetModules() + ALIENCLAW_HOME redirect (same pattern as telemetry-reader.test.ts)
 * so PATHS.home resolves to a temp dir at test-time.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'p145-onfit-'));
  process.env['ALIENCLAW_HOME'] = homeDir;
  vi.resetModules();
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env['ALIENCLAW_HOME'];
  vi.resetModules();
});

async function loadAggregator(): Promise<{
  aggregateOnlineFitness: typeof import('../../src/alienclaw/telemetry/telemetry-reader.js')['aggregateOnlineFitness'];
}> {
  const mod = await import('../../src/alienclaw/telemetry/telemetry-reader.js');
  return { aggregateOnlineFitness: mod.aggregateOnlineFitness };
}

describe('aggregateOnlineFitness', () => {
  it('returns {count:0, mean_fitness:0} when online_fitness.jsonl does not exist', async () => {
    // homeDir exists but no online_fitness.jsonl — must swallow ENOENT and return zeros (R-001)
    const { aggregateOnlineFitness } = await loadAggregator();
    const result = await aggregateOnlineFitness('compute');
    expect(result).toEqual({ count: 0, mean_fitness: 0 });
  });

  it('returns correct aggregate for the requested martian_type, ignoring other types', async () => {
    // 3 compute entries (0.8, 0.6, 1.0) + 1 http_get entry that must be excluded (R-002)
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
    // mean = (0.8 + 0.6 + 1.0) / 3 = 0.8
    expect(result.mean_fitness).toBeCloseTo(0.8, 10);
  });

  it('returns {count:0, mean_fitness:0} when no entries match the requested type', async () => {
    const logPath = join(homeDir, 'online_fitness.jsonl');
    writeFileSync(logPath,
      JSON.stringify({ martian_type: 'http_get', fitness: 0.9, ts: '2026-07-04T00:00:00Z' }) + '\n',
      'utf-8');
    const { aggregateOnlineFitness } = await loadAggregator();
    const result = await aggregateOnlineFitness('compute');
    expect(result).toEqual({ count: 0, mean_fitness: 0 });
  });

  it('skips malformed lines and aggregates only valid entries (R-003)', async () => {
    const logPath = join(homeDir, 'online_fitness.jsonl');
    writeFileSync(logPath, [
      JSON.stringify({ martian_type: 'compute', fitness: 0.5, ts: '2026-07-04T00:00:00Z' }),
      '{not valid json',
      '',
      JSON.stringify({ martian_type: 'compute', fitness: 0.5, ts: '2026-07-04T00:01:00Z' }),
    ].join('\n') + '\n', 'utf-8');
    const { aggregateOnlineFitness } = await loadAggregator();
    const result = await aggregateOnlineFitness('compute');
    expect(result.count).toBe(2);
    expect(result.mean_fitness).toBeCloseTo(0.5, 10);
  });
});
