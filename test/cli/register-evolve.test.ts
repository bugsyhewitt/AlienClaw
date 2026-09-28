/**
 * register-evolve.test.ts — `alienclaw evolve` units.
 *
 * Covers the three pure/wiring layers of the evolve command:
 *   1. parseCliArgs 'evolve' branch (value-flag token walk)
 *   2. formatGenerationLine / buildRunnerArgs (pure helpers)
 *   3. registerEvolveCommand Commander wiring (fake-program pattern,
 *      matching test/cli/cli.test.ts — commander itself is not imported)
 */
import { describe, it, expect, vi } from 'vitest';
import type { Command } from 'commander';

vi.mock('../../src/alienclaw/cli/evolve.js', async (importActual) => {
  const actual = await importActual() as Record<string, unknown>;
  return { ...actual, runEvolve: vi.fn().mockResolvedValue(0) };
});

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

  it('rejects evolve --type with no value (dangling flag)', () => {
    // Triggers branch 10 arm1 (L75): value = raw[i+1] is undefined → value ?? '' fires
    expect(parseCliArgs(['evolve', '--type']).type).toBe('unknown');
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

  it('omits distinct= suffix when distinct_genomes is absent from the generation row', () => {
    const row = JSON.stringify({ generation: 3, mean_fitness: 0.55, max_fitness: 0.87 });
    expect(formatGenerationLine(row, 10)).toBe('gen 3/10  max=0.870 mean=0.550');
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

describe('registerEvolveCommand — action callback', () => {
  it('passes seed as Number(opts.seed) when seed is provided', async () => {
    const fake = makeFakeProgram();
    registerEvolveCommand(fake.program);
    const action = fake.lastAction() as (opts: Record<string, unknown>) => Promise<void>;
    await action({ type: 'compute', generations: '3', population: '16', seed: '42' });
    const { runEvolve } = await import('../../src/alienclaw/cli/evolve.js');
    expect(runEvolve).toHaveBeenCalledWith(expect.objectContaining({ seed: 42 }));
  });

  it('passes seed as undefined when seed option is omitted', async () => {
    const fake = makeFakeProgram();
    registerEvolveCommand(fake.program);
    const action = fake.lastAction() as (opts: Record<string, unknown>) => Promise<void>;
    await action({ type: 'compute', generations: '5', population: '8' });
    const { runEvolve } = await import('../../src/alienclaw/cli/evolve.js');
    expect(runEvolve).toHaveBeenCalledWith(expect.objectContaining({ seed: undefined }));
  });
});

// ── PKT-561 — evolve --type malformed input rejected ────────────────────────

describe('parseCliArgs — evolve --type malformed input rejected (PKT-561)', () => {
  const TRAVERSAL_TYPES: { label: string; type: string }[] = [
    { label: 'dot-dot traversal',  type: '../../etc/passwd' },
    { label: 'empty string',       type: '' },
    { label: 'forward slash',      type: 'a/b' },
    { label: 'NUL byte',           type: 'a\x00b' },
    { label: 'over 128 chars',     type: 'x'.repeat(129) },
  ];

  for (const { label, type } of TRAVERSAL_TYPES) {
    it(`rejects --type: ${label}`, () => {
      expect(parseCliArgs(['evolve', '--type', type]).type).toBe('unknown');
    });
  }
});

// ── PKT-1268 — register.evolve Commander shim numeric-coercion hardening ───
//
// The Commander shim at src/alienclaw/cli/register.evolve.ts forwards user
// flags via `Number(opts.X)` with no validation. The parallel parseCliArgs
// path (args.ts L122-141) DOES validate. Sister site of PKT-1267's
// register.show.ts / register.leaderboard.ts topN coercion defect.
//
// Failure modes exercised below:
//   - NaN propagation to runEvolve when opts.X is non-numeric
//     (Number('abc') / Number('') / Number('10abc'))
//   - Range bypass for ints (negative, zero, fractional)
//   - Range bypass for floats (top-fraction / crossover-rate / mutation-rate
//     outside [0, 1])

describe('registerEvolveCommand — numeric coercion hardening (PKT-1268)', () => {
  async function invokeAction(opts: Record<string, unknown>): Promise<unknown> {
    const fake = makeFakeProgram();
    registerEvolveCommand(fake.program);
    const action = fake.lastAction() as (o: Record<string, unknown>) => Promise<unknown>;
    return action(opts);
  }

  async function captureRunEvolveCall(opts: Record<string, unknown>): Promise<unknown> {
    const { runEvolve } = await import('../../src/alienclaw/cli/evolve.js');
    (runEvolve as unknown as { mockClear: () => void }).mockClear?.();
    await invokeAction(opts);
    const calls = (runEvolve as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    return calls[calls.length - 1]?.[0];
  }

  // ── generations ───────────────────────────────────────────────────────────

  it('rejects --generations=NaN — must not propagate NaN to runEvolve', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: 'abc', population: '8' });
    expect(called).toBeUndefined(); // action must reject before runEvolve
  });

  it('rejects --generations="" (empty) — Number("") === 0 silent-zero bypass', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '', population: '8' });
    expect(called).toBeUndefined();
  });

  it('rejects --generations="10abc" (parseInt-leading-digit bypass)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '10abc', population: '8' });
    expect(called).toBeUndefined();
  });

  it('rejects --generations=-5 (negative)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '-5', population: '8' });
    expect(called).toBeUndefined();
  });

  it('rejects --generations=0 (must be >= 1)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '0', population: '8' });
    expect(called).toBeUndefined();
  });

  it('rejects --generations=1.5 (non-integer)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '1.5', population: '8' });
    expect(called).toBeUndefined();
  });

  // ── population ────────────────────────────────────────────────────────────

  it('rejects --population=NaN — must not propagate NaN to runEvolve', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: 'NaN' });
    expect(called).toBeUndefined();
  });

  it('rejects --population=-1 (negative)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '-1' });
    expect(called).toBeUndefined();
  });

  // ── seed ──────────────────────────────────────────────────────────────────

  it('rejects --seed=lucky (non-numeric) — must not propagate NaN', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', seed: 'lucky' });
    expect(called).toBeUndefined();
  });

  it('rejects --seed=-1 (negative)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', seed: '-1' });
    expect(called).toBeUndefined();
  });

  it('rejects --seed=1.5 (non-integer)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', seed: '1.5' });
    expect(called).toBeUndefined();
  });

  // ── tournament-k ─────────────────────────────────────────────────────────

  it('rejects --tournament-k=-3 (negative — silent bypass otherwise)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', tournamentK: '-3' });
    expect(called).toBeUndefined();
  });

  it('rejects --tournament-k=0 (must be >= 1)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', tournamentK: '0' });
    expect(called).toBeUndefined();
  });

  it('rejects --tournament-k=1.5 (non-integer)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', tournamentK: '1.5' });
    expect(called).toBeUndefined();
  });

  // ── top-fraction ──────────────────────────────────────────────────────────

  it('rejects --top-fraction=2 (outside [0, 1] — silent bypass)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', topFraction: '2' });
    expect(called).toBeUndefined();
  });

  it('rejects --top-fraction=-0.1 (negative)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', topFraction: '-0.1' });
    expect(called).toBeUndefined();
  });

  it('rejects --top-fraction=NaN', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', topFraction: 'NaN' });
    expect(called).toBeUndefined();
  });

  // ── elitism ───────────────────────────────────────────────────────────────

  it('rejects --elitism=-1 (negative)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', elitism: '-1' });
    expect(called).toBeUndefined();
  });

  it('rejects --elitism=1.5 (non-integer)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', elitism: '1.5' });
    expect(called).toBeUndefined();
  });

  // ── crossover-rate / mutation-rate ────────────────────────────────────────

  it('rejects --crossover-rate=99 (outside [0, 1])', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', crossoverRate: '99' });
    expect(called).toBeUndefined();
  });

  it('rejects --mutation-rate=-0.1 (negative)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', mutationRate: '-0.1' });
    expect(called).toBeUndefined();
  });

  it('rejects --crossover-rate=NaN', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8', crossoverRate: 'NaN' });
    expect(called).toBeUndefined();
  });

  // ── Positive control: valid input still passes ────────────────────────────

  it('forwards valid --generations=3 --population=8 to runEvolve (positive control)', async () => {
    const called = await captureRunEvolveCall({ type: 'compute_alone', generations: '3', population: '8' });
    expect(called).toBeDefined();
    expect(called).toMatchObject({ generations: 3, population: 8 });
  });
});
