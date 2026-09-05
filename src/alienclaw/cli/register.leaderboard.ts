/**
 * register.leaderboard.ts
 * Registers `alienclaw leaderboard` with OpenClaw's Commander program.
 * Follows the register.submit.ts pattern (dynamic import inside .action).
 */

import type { Command } from 'commander';

export function registerLeaderboardCommand(program: Command): void {
  program
    .command('leaderboard')
    .description('Show the public top-N leaderboard for a Martian type (read-only)')
    .requiredOption('--martian-type <type>', 'Martian type (e.g. compute)')
    .option('--top <n>', 'Number of entries to show (1–100)', '10')
    .addHelpText('after', `
Examples:
  alienclaw leaderboard --martian-type compute
  alienclaw leaderboard --martian-type compute --top 5

Reads the public leaderboard at api.alienclaw.net. No credentials required.
`)
    .action(async (opts: { martianType: string; top?: string }) => {
      const { runLeaderboard } = await import('./leaderboard.js');
      const topN = Math.max(1, Math.min(100, parseInt(opts.top ?? '10', 10)));
      process.exitCode = await runLeaderboard({ martianType: opts.martianType, topN });
    });
}
