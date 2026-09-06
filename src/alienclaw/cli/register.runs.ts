/**
 * register.runs.ts
 * Registers `alienclaw runs` with OpenClaw's Commander program.
 * Follows the register.leaderboard.ts pattern.
 */

import type { Command } from 'commander';

export function registerRunsCommand(program: Command): void {
  program
    .command('runs')
    .description('List persisted local populations (read-only)')
    .addHelpText('after', `
Examples:
  alienclaw runs

Reads ALIENCLAW_POPULATIONS_ROOT (default ~/.alienclaw/populations/).
Prints one row per population: martian_type, generations, latest max_fitness.
`)
    .action(async () => {
      const { runRuns } = await import('./runs.js');
      process.exitCode = await runRuns();
    });
}
