/**
 * register.evolve.ts
 * Registers `alienclaw evolve` with OpenClaw's Commander program.
 * Follows the register.run.ts pattern (dynamic import inside .action so
 * registration stays dependency-free for tests).
 */

import type { Command } from 'commander';

export function registerEvolveCommand(program: Command): void {
  program
    .command('evolve')
    .description('Run local genome evolution for a Martian type (offline, no network)')
    .requiredOption('--type <martianType>', 'Martian type to evolve (e.g. compute_alone)')
    .option('--generations <n>', 'Number of generations', '10')
    .option('--population <n>',  'Population size', '32')
    .option('--seed <n>',        'RNG seed for reproducibility')
    .option('--inputs <json>',   'JSON inputs forwarded to the Martian')
    .addHelpText('after', `
Examples:
  alienclaw evolve --type compute_alone --generations 10
  alienclaw evolve --type compute_alone --generations 3 --population 16 --seed 42 --inputs '{"input": "2 + 2"}'

Populations persist under ~/.alienclaw/populations (ALIENCLAW_POPULATIONS_ROOT).
Submit your best genome afterwards with: alienclaw submit --type <martianType>
`)
    .action(async (opts: {
      type: string; generations: string; population: string; seed?: string; inputs?: string;
    }) => {
      const { runEvolve } = await import('./evolve.js');
      process.exitCode = await runEvolve({
        martianType: opts.type,
        generations: Number(opts.generations),
        population:  Number(opts.population),
        seed:        opts.seed !== undefined ? Number(opts.seed) : undefined,
        inputs:      opts.inputs,
      });
    });
}
