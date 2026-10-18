/**
 * PKT-1041: --target-fitness CLI lever
 * RED on origin/main 9d21837: EvolveCommandArgs lacks targetFitness;
 *   --target-fitness token hits `default: return { type: 'unknown', raw }`.
 *   buildRunnerArgs never emits --target-fitness.
 *   formatGenerationLine passes target_reached JSON through unchanged.
 * GREEN after: args.ts + evolve.ts gain targetFitness support (Files C, D).
 *
 * Gate: pnpm exec vitest run test/cli/evolve-target-fitness.test.ts
 */
import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../../src/alienclaw/cli/args.js';
import { buildRunnerArgs, formatGenerationLine } from '../../src/alienclaw/cli/evolve.js';

describe('--target-fitness CLI lever', () => {
  it('A-001: parseCliArgs accepts --target-fitness 0.9', () => {
    const cmd = parseCliArgs([
      'evolve', '--type', 'compute', '--target-fitness', '0.9',
    ]);
    expect(cmd.type).toBe('evolve');
    if (cmd.type !== 'evolve') return;
    expect(cmd.args.targetFitness).toBe(0.9);
  });

  it('A-002: buildRunnerArgs emits --target-fitness when set', () => {
    const argv = buildRunnerArgs({
      martianType: 'compute', generations: 10, population: 32, targetFitness: 0.9,
    });
    expect(argv).toContain('--target-fitness');
    expect(argv).toContain('0.9');
  });

  it('A-003: buildRunnerArgs omits --target-fitness when absent', () => {
    const argv = buildRunnerArgs({ martianType: 'compute', generations: 10, population: 32 });
    expect(argv).not.toContain('--target-fitness');
  });

  it('R-001: parseCliArgs rejects --target-fitness 0 (must be > 0)', () => {
    const cmd = parseCliArgs(['evolve', '--type', 'compute', '--target-fitness', '0']);
    expect(cmd.type).toBe('unknown');
  });

  it('R-002: parseCliArgs rejects --target-fitness 1.5 (must be <= 1)', () => {
    const cmd = parseCliArgs(['evolve', '--type', 'compute', '--target-fitness', '1.5']);
    expect(cmd.type).toBe('unknown');
  });

  it('R-003: parseCliArgs accepts --target-fitness 1 (boundary)', () => {
    const cmd = parseCliArgs(['evolve', '--type', 'compute', '--target-fitness', '1']);
    expect(cmd.type).toBe('evolve');
  });

  it('F-001: formatGenerationLine formats target_reached JSON', () => {
    const line = JSON.stringify({
      type: 'target_reached',
      generation: 4,
      fitness: 0.9,
    });
    expect(formatGenerationLine(line, 10)).toBe(
      'target reached: fitness=0.900 at gen 4',
    );
  });

  it('F-002: non-target_reached gen rows still format as before', () => {
    const row = JSON.stringify({
      generation: 3, max_fitness: 0.87, mean_fitness: 0.55, distinct_genomes: 12,
    });
    expect(formatGenerationLine(row, 10)).toBe(
      'gen 3/10  max=0.870 mean=0.550 distinct=12',
    );
  });

  // PKT-1373: target_reached branch must drop non-finite fitness/gen before .toFixed().
  // Sister hardening to PR #605 (PKT-1142) on the gen/max_fitness/mean_fitness block.
  it('R-1373-A: fitness=1e500 (JSON.parse → Infinity) drops from target_reached arm', () => {
    const line = '{"type":"target_reached","fitness":1e500,"generation":3}';
    const out = formatGenerationLine(line, 10);
    expect(out).not.toContain('Infinity');
    expect(out).not.toContain('NaN');
    expect(out).toBe(line);
  });

  it('R-1373-B: fitness=-1e500 (JSON.parse → -Infinity) drops from target_reached arm', () => {
    const line = '{"type":"target_reached","fitness":-1e500,"generation":3}';
    const out = formatGenerationLine(line, 10);
    expect(out).not.toContain('Infinity');
    expect(out).not.toContain('NaN');
    expect(out).toBe(line);
  });

  it('R-1373-C: generation=1e500 (Infinity) drops from target_reached arm', () => {
    const line = '{"type":"target_reached","fitness":0.9,"generation":1e500}';
    const out = formatGenerationLine(line, 10);
    expect(out).not.toContain('Infinity');
    expect(out).not.toContain('NaN');
    expect(out).toBe(line);
  });

  it('R-1373-D: regression — happy path 0.9 at gen 4 still formats correctly', () => {
    const line = JSON.stringify({ type: 'target_reached', generation: 4, fitness: 0.9 });
    expect(formatGenerationLine(line, 10)).toBe('target reached: fitness=0.900 at gen 4');
  });
});
