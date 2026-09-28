/**
 * register.evolve.ts
 * Registers `alienclaw evolve` with OpenClaw's Commander program.
 * Follows the register.run.ts pattern (dynamic import inside .action so
 * registration stays dependency-free for tests).
 *
 * PKT-1268: Numeric flag coercion hardened against NaN propagation and
 * range bypass. Sister fix to parseCliArgs (args.ts L122-141), which
 * already validates these flags. Commander's value-flags arrive as
 * strings; without isFinite / range checks, Number() silently produces
 * NaN, negative, fractional, or out-of-range values that either crash
 * Python argparse with a confusing message or run with semantically
 * broken inputs.
 */

import type { Command } from 'commander';

/**
 * Strict integer coercion: must parse as a safe integer and meet a min.
 * Returns undefined for any non-conforming input. Rejects NaN, Infinity,
 * fractional, out-of-range, empty-string (Number('')===0 bypass), and
 * parseInt-leading-digit ('10abc') bypass.
 */
function coerceInt(raw: string | undefined, min: number): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  // Reject leading-sign parseInt bypass: only digits (no leading '-').
  // Number('10abc')===NaN already (Number not parseInt), but we also reject
  // '10.5' here (Number===10.5, parseInt('10.5')===10).
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < min) return undefined;
  return n;
}

/**
 * Strict float coercion: must parse as a finite number in [min, max].
 * Returns undefined for any non-conforming input.
 */
function coerceFloatInRange(raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

const VALID_SELECTIONS = new Set(['tournament', 'roulette_wheel', 'truncation']);

export function registerEvolveCommand(program: Command): void {
  program
    .command('evolve')
    .description('Run local genome evolution for a Martian type (offline, no network)')
    .requiredOption('--type <martianType>', 'Martian type to evolve (e.g. compute_alone)')
    .option('--generations <n>', 'Number of generations', '10')
    .option('--population <n>',  'Population size', '32')
    .option('--seed <n>',        'RNG seed for reproducibility')
    .option('--inputs <json>',   'JSON inputs forwarded to the Martian')
    .option('--selection <strategy>', 'Selection strategy: tournament, roulette_wheel, truncation')
    .option('--tournament-k <n>',     'Tournament size (tournament strategy; default 3)')
    .option('--top-fraction <f>',     'Top fraction to keep (truncation strategy; default 0.5)')
    .option('--elitism <n>',          'Elite genomes to preserve per generation (default 2)')
    .option('--crossover-rate <f>',   'Crossover fraction [0, 1] (default 0.5)')
    .option('--mutation-rate <f>',    'Per-character mutation probability [0, 1] (default 1/256)')
    .addHelpText('after', `
Examples:
  alienclaw evolve --type compute_alone --generations 10
  alienclaw evolve --type compute_alone --generations 3 --population 16 --seed 42 --inputs '{"input": "2 + 2"}'

Populations persist under ~/.alienclaw/populations (ALIENCLAW_POPULATIONS_ROOT).
Submit your best genome afterwards with: alienclaw submit --type <martianType>
`)
    .action(async (opts: {
      type: string; generations: string; population: string; seed?: string; inputs?: string;
      selection?: string; tournamentK?: string; topFraction?: string;
      elitism?: string; crossoverRate?: string; mutationRate?: string;
    }) => {
      // PKT-1268: validate each flag before forwarding to runEvolve.
      // parseInt/Number without isFinite lets NaN / out-of-range / parseInt-
      // leading-digit bypass through to Python, surfacing as confusing
      // argparse errors or silently-broken evolution runs.
      const generations = coerceInt(opts.generations, 1);
      const population  = coerceInt(opts.population,  1);
      const seed        = coerceInt(opts.seed,        0);
      const tournamentK = coerceInt(opts.tournamentK, 1);
      const topFraction = coerceFloatInRange(opts.topFraction, 0, 1);
      const elitism        = coerceInt(opts.elitism, 0);
      const crossoverRate  = coerceFloatInRange(opts.crossoverRate, 0, 1);
      const mutationRate   = coerceFloatInRange(opts.mutationRate,  0, 1);

      const selectionOk = opts.selection === undefined || VALID_SELECTIONS.has(opts.selection);
      const allValid =
        generations !== undefined && population !== undefined &&
        (opts.seed === undefined || seed !== undefined) &&
        (opts.tournamentK === undefined || tournamentK !== undefined) &&
        (opts.topFraction === undefined || topFraction !== undefined) &&
        (opts.elitism === undefined || elitism !== undefined) &&
        (opts.crossoverRate === undefined || crossoverRate !== undefined) &&
        (opts.mutationRate === undefined || mutationRate !== undefined) &&
        selectionOk;

      if (!allValid) {
        console.error('alienclaw evolve: invalid numeric argument (see --help for ranges).');
        process.exitCode = 1;
        return;
      }

      const { runEvolve } = await import('./evolve.js');
      process.exitCode = await runEvolve({
        martianType:   opts.type,
        generations:   generations!,
        population:    population!,
        seed,
        inputs:        opts.inputs,
        selection:     opts.selection,
        tournamentK,
        topFraction,
        elitism,
        crossoverRate,
        mutationRate,
      });
    });
}
