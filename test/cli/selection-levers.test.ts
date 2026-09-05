/**
 * PKT-1032: selection-strategy CLI levers
 * Tests A-004, A-005, A-006 (TypeScript side).
 * RED on origin/main (--selection unknown → type:unknown; buildRunnerArgs missing flags).
 * GREEN after fix.
 */
import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../../src/alienclaw/cli/args.js';
import { buildRunnerArgs } from '../../src/alienclaw/cli/evolve.js';

describe('selection-strategy CLI levers', () => {
  it('A-004: parseCliArgs accepts --selection --top-fraction --tournament-k', () => {
    const cmd = parseCliArgs([
      'evolve', '--type', 'compute_alone',
      '--selection', 'truncation', '--top-fraction', '0.25', '--tournament-k', '5',
    ]);
    expect(cmd.type).toBe('evolve');
    if (cmd.type !== 'evolve') return;
    expect(cmd.args.selection).toBe('truncation');
    expect(cmd.args.topFraction).toBe(0.25);
    expect(cmd.args.tournamentK).toBe(5);
  });

  it('A-005: buildRunnerArgs passes --selection and --top-fraction, omits --tournament-k when absent', () => {
    const argv = buildRunnerArgs({
      martianType: 'compute_alone', generations: 3, population: 32,
      selection: 'truncation', topFraction: 0.25,
    });
    expect(argv).toContain('--selection');
    expect(argv).toContain('truncation');
    expect(argv).toContain('--top-fraction');
    expect(argv).toContain('0.25');
    expect(argv).not.toContain('--tournament-k');
  });

  it('A-006: buildRunnerArgs omits all selection flags when none provided', () => {
    const argv = buildRunnerArgs({ martianType: 'compute_alone', generations: 3, population: 32 });
    expect(argv).not.toContain('--selection');
    expect(argv).not.toContain('--tournament-k');
    expect(argv).not.toContain('--top-fraction');
  });

  it('R-004: parseCliArgs rejects invalid --selection value', () => {
    const cmd = parseCliArgs(['evolve', '--type', 'compute_alone', '--selection', 'bogus_strategy']);
    expect(cmd.type).toBe('unknown');
  });

  it('R-005: parseCliArgs rejects --tournament-k 0 and non-integer', () => {
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--tournament-k', '0']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--tournament-k', '2.5']).type).toBe('unknown');
  });

  it('R-006: parseCliArgs rejects --top-fraction outside (0, 1]', () => {
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--top-fraction', '0']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--top-fraction', '1.5']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'compute_alone', '--top-fraction', '1']).type).toBe('evolve');
  });
});
