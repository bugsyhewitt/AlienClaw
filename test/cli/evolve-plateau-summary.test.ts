/**
 * evolve-plateau-summary.test.ts — formatGenerationLine plateau_summary arm.
 *
 * RED (origin/main 86dee6e2): formatGenerationLine passes plateau_summary JSON
 *   through unchanged (only generation/max_fitness/mean_fitness trigger formatting).
 * GREEN: after type:'plateau_summary' arm added to formatGenerationLine.
 *
 * Covers R-301..R-304.
 */
import { describe, it, expect } from 'vitest';
import { formatGenerationLine } from '../../src/alienclaw/cli/evolve.js';

describe('formatGenerationLine — plateau_summary', () => {
  it('R-301: formats single plateau', () => {
    const line = JSON.stringify({
      type: 'plateau_summary',
      total_generations: 10,
      plateaus: [{ start_generation: 6, length: 5 }],
    });
    expect(formatGenerationLine(line, 10)).toBe(
      'Convergence: plateau at gen 6 (5 flat gens, Δ<0.01)',
    );
  });

  it('R-302: reports no plateau when plateaus array is empty', () => {
    const line = JSON.stringify({
      type: 'plateau_summary',
      total_generations: 10,
      plateaus: [],
    });
    expect(formatGenerationLine(line, 10)).toBe('Convergence: no plateau detected');
  });

  it('R-303: formats multiple plateaus', () => {
    const line = JSON.stringify({
      type: 'plateau_summary',
      total_generations: 20,
      plateaus: [
        { start_generation: 3, length: 6 },
        { start_generation: 15, length: 5 },
      ],
    });
    expect(formatGenerationLine(line, 20)).toBe(
      'Convergence: 2 plateaus (at gen 3 len 6, gen 15 len 5)',
    );
  });

  it('R-304: non-plateau gen rows still format as before', () => {
    const row = JSON.stringify({
      generation: 3,
      max_fitness: 0.87,
      mean_fitness: 0.55,
      distinct_genomes: 12,
    });
    expect(formatGenerationLine(row, 10)).toBe(
      'gen 3/10  max=0.870 mean=0.550 distinct=12',
    );
  });

  // PKT-1142 D1: Number.isFinite hardening — JSON.parse coerces 1e500 to Infinity
  // and -1e500 to -Infinity; typeof === 'number' passes both through and
  // .toFixed(3) then emits the 8-char string "Infinity" / "-Infinity" instead
  // of a 3-decimal number, poisoning the operator's stdout.
  it('R-1142-A: max_fitness=1e500 falls through (no "Infinity" in output)', () => {
    const row = JSON.stringify({
      generation: 3,
      mean_fitness: 0.55,
      max_fitness: 1e500,
    });
    const out = formatGenerationLine(row, 10);
    expect(out).not.toContain('Infinity');
    expect(out).toBe(row); // passes through unchanged when validation rejects it
  });

  it('R-1142-B: mean_fitness=-1e500 falls through (no "-Infinity" in output)', () => {
    const row = JSON.stringify({
      generation: 3,
      mean_fitness: -1e500,
      max_fitness: 0.87,
    });
    const out = formatGenerationLine(row, 10);
    expect(out).not.toContain('Infinity');
    expect(out).toBe(row);
  });

  it('R-1142-C: distinct_genomes=1e500 is dropped from the "distinct=" segment', () => {
    const row = JSON.stringify({
      generation: 1,
      mean_fitness: 0.7,
      max_fitness: 0.7,
      distinct_genomes: 1e500,
    });
    const out = formatGenerationLine(row, 10);
    // gen/max/mean are all finite so the row IS formatted, but the poisoned
    // distinct_genomes is excluded — output contains no "distinct=" segment
    // at all (rather than printing "distinct=Infinity").
    expect(out).not.toContain('distinct=');
    expect(out).not.toContain('Infinity');
    expect(out).toBe('gen 1/10  max=0.700 mean=0.700');
  });

  it('R-1142-D: distinct_genomes missing still formats finite row', () => {
    const row = JSON.stringify({
      generation: 2,
      max_fitness: 0.5,
      mean_fitness: 0.5,
    });
    expect(formatGenerationLine(row, 10)).toBe(
      'gen 2/10  max=0.500 mean=0.500',
    );
  });
});
