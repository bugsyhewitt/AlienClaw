/**
 * register-evolve.test.ts — `alienclaw evolve` units.
 *
 * Covers the three pure/wiring layers of the evolve command:
 *   1. parseCliArgs 'evolve' branch (value-flag token walk)
 *   2. formatGenerationLine / buildRunnerArgs (pure helpers)
 *   3. registerEvolveCommand Commander wiring (fake-program pattern,
 *      matching test/cli/cli.test.ts — commander itself is not imported)
 */
import { describe, it, expect } from 'vitest';
import type { Command } from 'commander';

import { parseCliArgs } from '../../src/alienclaw/cli/args.js';
import { formatGenerationLine, buildRunnerArgs } from '../../src/alienclaw/cli/evolve.js';
import { registerEvolveCommand } from '../../src/alienclaw/cli/register.evolve.js';

// ── 1. parseCliArgs evolve branch ────────────────────────────────────────────

describe('parseCliArgs — evolve', () => {
  it('parses the full flag set', () => {
    const cmd = parseCliArgs([
      'evolve', '--type', 'compute_alone', '--generations', '3',
      '--population', '16', '--seed', '42', '--inputs', '{"input":"2 + 2"}',
    ]);
    expect(cmd).toEqual({
      type: 'evolve',
      args: {
        martianType: 'compute_alone',
        generations: 3,
        population:  16,
        seed:        42,
        inputs:      '{"input":"2 + 2"}',
      },
    });
  });

  it('applies defaults (generations 10, population 32) with only --type', () => {
    const cmd = parseCliArgs(['evolve', '--type', 'compute_alone']);
    expect(cmd).toEqual({
      type: 'evolve',
      args: { martianType: 'compute_alone', generations: 10, population: 32 },
    });
  });

  it('rejects evolve without --type', () => {
    expect(parseCliArgs(['evolve']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--generations', '5']).type).toBe('unknown');
  });

  it('rejects non-numeric or out-of-range numeric flags', () => {
    expect(parseCliArgs(['evolve', '--type', 'x', '--generations', 'many']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'x', '--population', '0']).type).toBe('unknown');
    expect(parseCliArgs(['evolve', '--type', 'x', '--seed', 'lucky']).type).toBe('unknown');
  });

  it('rejects unknown evolve flags', () => {
    expect(parseCliArgs(['evolve', '--type', 'x', '--bogus', '1']).type).toBe('unknown');
  });

  it('still routes --help before the evolve branch', () => {
    expect(parseCliArgs(['evolve', '--help']).type).toBe('help');
  });
});

// ── 2. Pure helpers ──────────────────────────────────────────────────────────

describe('formatGenerationLine', () => {
  it('reformats a generation JSON row', () => {
    const row = JSON.stringify({
      generation: 3, next_generation: 4, mean_fitness: 0.55,
      max_fitness: 0.87, min_fitness: 0.1, stddev_fitness: 0.2,
      distinct_genomes: 12, children_minted: 30,
    });
    expect(formatGenerationLine(row, 10)).toBe('gen 3/10  max=0.870 mean=0.550 distinct=12');
  });

  it('passes non-JSON lines through unchanged', () => {
    expect(formatGenerationLine('some warning text', 10)).toBe('some warning text');
  });

  it('passes JSON without generation fields through unchanged', () => {
    const line = JSON.stringify({ note: 'not a generation row' });
    expect(formatGenerationLine(line, 10)).toBe(line);
  });
});

describe('buildRunnerArgs', () => {
  it('builds the full runner argv including optional flags', () => {
    expect(buildRunnerArgs({
      martianType: 'compute_alone', generations: 3, population: 16, seed: 42, inputs: '{"input":"2 + 2"}',
    })).toEqual([
      '-m', 'alienclaw.evolution', 'run-experiment',
      '--martian-type', 'compute_alone',
      '--generations', '3',
      '--population-size', '16',
      '--seed', '42',
      '--inputs', '{"input":"2 + 2"}',
    ]);
  });

  it('omits seed and inputs when not provided', () => {
    const argv = buildRunnerArgs({ martianType: 'compute_alone', generations: 10, population: 32 });
    expect(argv).not.toContain('--seed');
    expect(argv).not.toContain('--inputs');
  });
});

// ── 3. Commander wiring ──────────────────────────────────────────────────────

function makeFakeProgram(): { program: Command;
                              lastCommandName: () => string | null;
                              lastAction:      () => ((...args: unknown[]) => unknown) | null;
                              helpText:        () => string | null } {
  let _cmdName: string | null = null;
  let _action:  ((...args: unknown[]) => unknown) | null = null;
  let _helpText: string | null = null;

  const program: Command = {
    command:  (name: string) => { _cmdName = name; return program; },
    description: () => program,
    option:   () => program,
    requiredOption: () => program,
    addHelpText: (_when: string, text: string) => { _helpText = text; return program; },
    action:   (fn: (...args: unknown[]) => unknown) => { _action = fn; return program; },
  } as unknown as Command;

  return {
    program,
    lastCommandName: () => _cmdName,
    lastAction:      () => _action,
    helpText:        () => _helpText,
  };
}

describe('registerEvolveCommand', () => {
  it('registers the evolve command with an action and examples', () => {
    const fake = makeFakeProgram();
    registerEvolveCommand(fake.program);
    expect(fake.lastCommandName()).toBe('evolve');
    expect(fake.lastAction()).toBeTypeOf('function');
    expect(fake.helpText()).toContain('alienclaw evolve --type compute_alone');
  });
});
