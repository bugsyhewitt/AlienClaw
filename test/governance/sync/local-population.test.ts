/**
 * local-population.test.ts — reading the real PopulationStorage layout.
 *
 * The Python layer (src/alienclaw/evolution/storage.py) writes
 * <root>/<type>/entries/<uuid>.json with metadata.json and stats/ as
 * siblings. These tests pin the reader to that layout — the previous
 * flat-layout reading silently found no genomes against real populations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  readTopEntries,
  readOperatorBest,
} from '../../../src/alienclaw/governance/common/sync/local-population.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aclaw-localpop-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seedEntry(
  martianType: string,
  fileName: string,
  entry: Record<string, unknown>,
): void {
  const dir = join(root, martianType, 'entries');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), JSON.stringify(entry), 'utf-8');
}

describe('readTopEntries', () => {
  it('reads entries from the entries/ subdirectory sorted by fitness desc', () => {
    seedEntry('compute', 'a.json', { genome: 'A'.repeat(16), fitness: 0.2, generation: 1, run_metadata: {} });
    seedEntry('compute', 'b.json', { genome: 'B'.repeat(16), fitness: 0.9, generation: 3, run_metadata: {} });
    seedEntry('compute', 'c.json', { genome: 'C'.repeat(16), fitness: 0.5, generation: 2, run_metadata: {} });

    const top = readTopEntries(root, 'compute', 2);
    expect(top.map(e => e.fitness)).toEqual([0.9, 0.5]);
    expect(top[0]!.genome).toBe('B'.repeat(16));
    expect(top[0]!.generation).toBe(3);
  });

  it('ignores metadata.json and stats/ siblings outside entries/', () => {
    seedEntry('compute', 'a.json', { genome: 'A'.repeat(16), fitness: 0.4, run_metadata: {} });
    // metadata.json sits BESIDE entries/, not inside it — must not be parsed as an entry
    writeFileSync(
      join(root, 'compute', 'metadata.json'),
      JSON.stringify({ martian_type: 'compute', population_size: 8 }),
      'utf-8',
    );
    mkdirSync(join(root, 'compute', 'stats'), { recursive: true });
    writeFileSync(join(root, 'compute', 'stats', 'gen-1.json'), JSON.stringify({ mean: 0.1 }), 'utf-8');

    const top = readTopEntries(root, 'compute', 10);
    expect(top).toHaveLength(1);
    expect(top[0]!.fitness).toBe(0.4);
  });

  it('skips corrupted and shape-invalid entry files', () => {
    seedEntry('compute', 'good.json', { genome: 'G'.repeat(16), fitness: 0.7, run_metadata: {} });
    writeFileSync(join(root, 'compute', 'entries', 'corrupt.json'), '{not json', 'utf-8');
    seedEntry('compute', 'no-genome.json', { fitness: 0.9 });
    seedEntry('compute', 'no-fitness.json', { genome: 'X'.repeat(16) });

    const top = readTopEntries(root, 'compute', 10);
    expect(top).toHaveLength(1);
    expect(top[0]!.genome).toBe('G'.repeat(16));
  });

  it('returns [] for an absent type directory', () => {
    expect(readTopEntries(root, 'nope', 5)).toEqual([]);
  });

  it('defaults run_metadata to an empty object', () => {
    seedEntry('compute', 'bare.json', { genome: 'G'.repeat(16), fitness: 0.1 });
    const [e] = readTopEntries(root, 'compute', 1);
    expect(e!.run_metadata).toEqual({});
  });

  // ── PKT-702: readTopEntries must reject non-finite and out-of-range fitness entries ──

  it('silently drops entry with fitness > 1 (out of range high)', () => {
    seedEntry('compute', 'high.json', { genome: 'H'.repeat(16), fitness: 2.0, run_metadata: {} });
    seedEntry('compute', 'ok.json',   { genome: 'O'.repeat(16), fitness: 0.7, run_metadata: {} });
    const top = readTopEntries(root, 'compute', 10);
    expect(top.map(e => e.fitness)).toEqual([0.7]);
  });

  it('silently drops entry with fitness < 0 (out of range low)', () => {
    seedEntry('compute', 'low.json', { genome: 'L'.repeat(16), fitness: -0.5, run_metadata: {} });
    seedEntry('compute', 'ok.json',  { genome: 'O'.repeat(16), fitness: 0.3, run_metadata: {} });
    const top = readTopEntries(root, 'compute', 10);
    expect(top.map(e => e.fitness)).toEqual([0.3]);
  });

  it('accepts valid boundary fitness=0 and fitness=1', () => {
    seedEntry('compute', 'zero.json', { genome: 'Z'.repeat(16), fitness: 0, run_metadata: {} });
    seedEntry('compute', 'one.json',  { genome: 'O'.repeat(16), fitness: 1, run_metadata: {} });
    const top = readTopEntries(root, 'compute', 10);
    expect(top.map(e => e.fitness)).toEqual([1, 0]);
  });

  it('does not regress on control fitness=0.7 after boundary checks', () => {
    seedEntry('compute', 'ok.json', { genome: 'G'.repeat(16), fitness: 0.7, run_metadata: {} });
    const top = readTopEntries(root, 'compute', 10);
    expect(top).toHaveLength(1);
    expect(top[0]!.fitness).toBe(0.7);
  });
});

describe('readTopEntries non-finite fitness defense', () => {
  it('skips entry with 1e500 fitness (parses to Infinity)', () => {
    seedEntry('compute', 'good.json', { genome: 'G'.repeat(16), fitness: 0.7, run_metadata: {} });
    // Manual JSON to bypass JSON.stringify's null-coercion of Infinity
    writeFileSync(
      join(root, 'compute', 'entries', 'poisoned-pos.json'),
      `{"genome":"${'P'.repeat(16)}","fitness":1e500,"run_metadata":{}}`,
      'utf-8'
    );
    const top = readTopEntries(root, 'compute', 10);
    expect(top).toHaveLength(1);
    expect(top[0]!.genome).toBe('G'.repeat(16));
  });

  it('skips entry with -1e500 fitness (parses to -Infinity)', () => {
    seedEntry('compute', 'good.json', { genome: 'G'.repeat(16), fitness: 0.7, run_metadata: {} });
    writeFileSync(
      join(root, 'compute', 'entries', 'poisoned-neg.json'),
      `{"genome":"${'N'.repeat(16)}","fitness":-1e500,"run_metadata":{}}`,
      'utf-8'
    );
    const top = readTopEntries(root, 'compute', 10);
    expect(top).toHaveLength(1);
    expect(top[0]!.genome).toBe('G'.repeat(16));
  });

  it('accepts entry with Number.MAX_VALUE fitness (boundary correctness)', () => {
    seedEntry('compute', 'max.json', { genome: 'M'.repeat(16), fitness: 1.7976931348623157e+308, run_metadata: {} });
    const top = readTopEntries(root, 'compute', 10);
    expect(top).toHaveLength(1);
    expect(Number.isFinite(top[0]!.fitness)).toBe(true);
  });

  it('readOperatorBest returns null when the only entry file has 1e500 fitness', () => {
    mkdirSync(join(root, 'compute', 'entries'), { recursive: true });
    writeFileSync(
      join(root, 'compute', 'entries', 'only-poisoned.json'),
      `{"genome":"${'O'.repeat(16)}","fitness":1e500,"run_metadata":{}}`,
      'utf-8'
    );
    expect(readOperatorBest(root, 'compute')).toBeNull();
  });
});

describe('readOperatorBest', () => {
  it('returns the best entry in GenomeResult shape with a sha256 hash', () => {
    const genome = 'Z'.repeat(16);
    seedEntry('compute', 'a.json', { genome: 'A'.repeat(16), fitness: 0.3, run_metadata: {} });
    seedEntry('compute', 'z.json', { genome, fitness: 0.8, run_metadata: {} });

    const best = readOperatorBest(root, 'compute');
    expect(best).not.toBeNull();
    expect(best!.genome).toBe(genome);
    expect(best!.fitness).toBe(0.8);
    expect(best!.martianType).toBe('compute');
    expect(best!.genomeHash).toBe(createHash('sha256').update(genome).digest('hex'));
  });

  it('returns null for an empty or missing population', () => {
    expect(readOperatorBest(root, 'compute')).toBeNull();
  });
});

describe('readTopEntries — fitness poison-input defense', () => {
  it('drops NaN-fitness entries (silent data-loss defense)', () => {
    seedEntry('compute', 'nan.json', { genome: 'N'.repeat(16), fitness: NaN, generation: 1, run_metadata: {} });
    expect(readTopEntries(root, 'compute', 10)).toHaveLength(0);
  });

  it('drops +Infinity-fitness entries', () => {
    seedEntry('compute', 'inf.json', { genome: 'I'.repeat(16), fitness: Infinity, generation: 1, run_metadata: {} });
    expect(readTopEntries(root, 'compute', 10)).toHaveLength(0);
  });

  it('drops -Infinity-fitness entries', () => {
    seedEntry('compute', 'ninf.json', { genome: 'J'.repeat(16), fitness: -Infinity, generation: 1, run_metadata: {} });
    expect(readTopEntries(root, 'compute', 10)).toHaveLength(0);
  });

  it('drops negative finite fitness entries (< 0)', () => {
    seedEntry('compute', 'neg.json', { genome: 'K'.repeat(16), fitness: -0.5, generation: 1, run_metadata: {} });
    expect(readTopEntries(root, 'compute', 10)).toHaveLength(0);
  });

  it('drops out-of-range finite fitness entries (> 1)', () => {
    seedEntry('compute', 'oor.json', { genome: 'L'.repeat(16), fitness: 1.5, generation: 1, run_metadata: {} });
    expect(readTopEntries(root, 'compute', 10)).toHaveLength(0);
  });

  it('returns [] for an all-poisoned population (regression: silent drop defense)', () => {
    seedEntry('compute', 'a.json', { genome: 'A'.repeat(16), fitness: NaN, run_metadata: {} });
    seedEntry('compute', 'b.json', { genome: 'B'.repeat(16), fitness: Infinity, run_metadata: {} });
    seedEntry('compute', 'c.json', { genome: 'C'.repeat(16), fitness: 1.5, run_metadata: {} });
    expect(readTopEntries(root, 'compute', 10)).toHaveLength(0);
  });

  it('preserves valid in-range entries alongside poisoned ones', () => {
    seedEntry('compute', 'good.json', { genome: 'G'.repeat(16), fitness: 0.7, run_metadata: {} });
    seedEntry('compute', 'nan.json',  { genome: 'N'.repeat(16), fitness: NaN, run_metadata: {} });
    seedEntry('compute', 'oor.json',  { genome: 'O'.repeat(16), fitness: 1.5, run_metadata: {} });
    const top = readTopEntries(root, 'compute', 10);
    expect(top).toHaveLength(1);
    expect(top[0]!.fitness).toBe(0.7);
  });

  it('accepts boundary values 0 and 1 exactly', () => {
    seedEntry('compute', 'zero.json', { genome: 'Z'.repeat(16), fitness: 0, run_metadata: {} });
    seedEntry('compute', 'one.json',  { genome: 'O'.repeat(16), fitness: 1, run_metadata: {} });
    const top = readTopEntries(root, 'compute', 10);
    expect(top).toHaveLength(2);
    expect(top.map(e => e.fitness).sort((a, b) => b - a)).toEqual([1, 0]);
  });
});

describe('readOperatorBest — fitness poison-input defense', () => {
  it('returns null for all-poisoned population (defect #1 regression)', () => {
    seedEntry('compute', 'a.json', { genome: 'A'.repeat(16), fitness: NaN, run_metadata: {} });
    seedEntry('compute', 'b.json', { genome: 'B'.repeat(16), fitness: Infinity, run_metadata: {} });
    expect(readOperatorBest(root, 'compute')).toBeNull();
  });

  it('returns best finite in-range entry when poisoned entries are present', () => {
    seedEntry('compute', 'best.json', { genome: 'B'.repeat(16), fitness: 0.9, run_metadata: {} });
    seedEntry('compute', 'nan.json',  { genome: 'N'.repeat(16), fitness: NaN, run_metadata: {} });
    const result = readOperatorBest(root, 'compute');
    expect(result).not.toBeNull();
    expect(result!.fitness).toBe(0.9);
  });
});
