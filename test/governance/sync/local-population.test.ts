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
