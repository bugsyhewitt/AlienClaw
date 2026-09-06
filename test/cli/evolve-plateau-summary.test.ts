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
});
