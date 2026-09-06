/**
 * PKT-1036: mutation/crossover/elitism rate levers
 * Tests A-004, A-005, A-006, R-004, R-005, R-006 (TypeScript side).
 * RED on origin/main (--elitism unknown token → type:unknown; buildRunnerArgs missing flags).
 * GREEN after fix.
 */
import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../../src/alienclaw/cli/args.js';
import { buildRunnerArgs } from '../../src/alienclaw/cli/evolve.js';

describe('mutation/crossover/elitism rate levers', () => {
  it('A-004: parseCliArgs accepts --elitism --crossover-rate --mutation-rate', () => {
    const cmd = parseCliArgs([
      'evolve', '--type', 'compute_alone',
      '--elitism', '4', '--crossover-rate', '0.75', '--mutation-rate', '0.02',
    ]);
    expect(cmd.type).toBe('evolve');
    if (cmd.type !== 'evolve') return;
    expect(cmd.args.elitism).toBe(4);
    expect(cmd.args.crossoverRate).toBe(0.75);
    expect(cmd.args.mutationRate).toBe(0.02);
  });

  it('A-005: buildRunnerArgs passes --elitism and --crossover-rate, omits --mutation-rate when absent', () => {
    const argv = buildRunnerArgs({
      martianType: 'compute_alone', generations: 3, population: 32,
      elitism: 4, crossoverRate: 0.75,
    } as any);
    expect(argv).toContain('--elitism');
    expect(argv).toContain('4');
    expect(argv).toContain('--crossover-rate');
    expect(argv).toContain('0.75');
    expect(argv).not.toContain('--mutation-rate');
  });

  it('A-006: buildRunnerArgs omits all rate flags when none provided', () => {
    const argv = buildRunnerArgs({ martianType: 'compute_alone', generations: 3, population: 32 });
    expect(argv).not.toContain('--elitism');
    expect(argv).not.toContain('--crossover-rate');
    expect(argv).not.toContain('--mutation-rate');
  });

  it('R-004: parseCliArgs rejects --elitism negative or non-integer', () => {
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--elitism', '-1']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--elitism', '1.5']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--elitism', '0']).type).toBe('evolve');
  });

  it('R-005: parseCliArgs rejects --crossover-rate outside [0, 1]', () => {
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--crossover-rate', '-0.1']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--crossover-rate', '1.5']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--crossover-rate', '0']).type).toBe('evolve');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--crossover-rate', '1']).type).toBe('evolve');
  });

  it('R-006: parseCliArgs rejects --mutation-rate outside [0, 1]', () => {
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--mutation-rate', '-0.01']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--mutation-rate', '1.1']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--mutation-rate', '0']).type).toBe('evolve');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--mutation-rate', '1']).type).toBe('evolve');
  });
});
