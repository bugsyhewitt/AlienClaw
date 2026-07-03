/**
 * register.submit.ts
 * Registers `alienclaw submit` with OpenClaw's Commander program.
 * Follows the register.run.ts pattern (dynamic import inside .action).
 */

import type { Command } from 'commander';

export function registerSubmitCommand(program: Command): void {
  program
    .command('submit')
    .description('Submit your best local genome for a Martian type to the public leaderboard')
    .requiredOption('--type <martianType>', 'Martian type to submit (e.g. compute_alone)')
    .option('--name <handle>', 'Public leaderboard handle (8 uppercase letters); persisted to preferences')
    .option('--yes',   'Skip the confirmation prompt', false)
    .option('--force', 'Submit even when your best does not beat the public top', false)
    .addHelpText('after', `
Examples:
  alienclaw submit --type compute_alone --name ALIENBOT
  alienclaw submit --type compute_alone --yes            (handle from preferences or env)

The submission is explicit and confirmed — nothing runs in the background.
Credentials: a self-generated api key is persisted at ~/.alienclaw/api-key.txt.
`)
    .action(async (opts: { type: string; name?: string; yes?: boolean; force?: boolean }) => {
      const { runSubmit } = await import('./submit.js');
      process.exitCode = await runSubmit({
        martianType: opts.type,
        name:        opts.name,
        yes:         opts.yes === true,
        force:       opts.force === true,
      });
    });
}
