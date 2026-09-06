/**
 * PKT-1038: alienclaw runs — list persisted local populations.
 * Tests A-001 through A-004.
 * RED on origin/main: runs.ts does not exist → ERR_MODULE_NOT_FOUND at collection.
 * GREEN after fix: all 4 pass.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliArgs } from '../../src/alienclaw/cli/args.js';
import { runRuns } from '../../src/alienclaw/cli/runs.js';

afterEach(() => { vi.restoreAllMocks(); });

function captureStdout(): { lines: () => string[] } {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return { lines: () => chunks.join('').trimEnd().split('\n').filter(Boolean) };
}

function makePop(root: string, martianType: string, generations: number, maxFitness?: number): void {
  const dir = join(root, martianType);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify({
    martian_type: martianType,
    generations,
    config: {},
  }));
  if (maxFitness !== undefined) {
    const statsDir = join(dir, 'stats');
    mkdirSync(statsDir, { recursive: true });
    const genNum = String(Math.max(0, generations - 1)).padStart(4, '0');
    writeFileSync(join(statsDir, `gen-${genNum}.json`), JSON.stringify({
      martian_type: martianType,
      generation: generations - 1,
      max_fitness: maxFitness,
      min_fitness: 0.1,
      mean_fitness: 0.5,
      median_fitness: 0.5,
      stddev_fitness: 0.1,
      distinct_genomes: 20,
      count: 32,
      captured_at: '2026-09-06T00:00:00Z',
    }));
  }
}

describe('alienclaw runs', () => {
  it('A-001: parseCliArgs routes "runs" to type:runs', () => {
    expect(parseCliArgs(['node', 'alienclaw.mjs', 'runs']).type).toBe('runs');
  });

  it('A-002: 2 population dirs → 2 rows in ascending martian_type order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-runs-'));
    makePop(root, 'compute', 5, 0.87);
    makePop(root, 'web_search', 10, 0.65);

    const cap = captureStdout();
    const code = await runRuns(root);
    const rows = cap.lines();

    expect(code).toBe(0);
    expect(rows).toHaveLength(2);

    const r0 = rows[0]!.split('\t');
    expect(r0[0]).toBe('compute');
    expect(r0[1]).toBe('5');
    expect(r0[2]).toBe('0.8700');

    const r1 = rows[1]!.split('\t');
    expect(r1[0]).toBe('web_search');
    expect(r1[1]).toBe('10');
    expect(r1[2]).toBe('0.6500');
  });

  it('A-003: population with no stats dir → max_fitness 0.0000', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-runs-'));
    makePop(root, 'compute', 3);  // no maxFitness → no stats dir

    const cap = captureStdout();
    const code = await runRuns(root);
    const rows = cap.lines();

    expect(code).toBe(0);
    expect(rows).toHaveLength(1);
    const r = rows[0]!.split('\t');
    expect(r[0]).toBe('compute');
    expect(r[1]).toBe('3');
    expect(r[2]).toBe('0.0000');
  });

  it('A-004: missing populations root → no output, exit 0', async () => {
    const root = join(tmpdir(), `ac-runs-nonexistent-${Date.now()}`);

    const cap = captureStdout();
    const code = await runRuns(root);

    expect(code).toBe(0);
    expect(cap.lines()).toHaveLength(0);
  });
});
