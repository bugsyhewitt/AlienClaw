/**
 * register.leaderboard.ts
 * Registers `alienclaw leaderboard` with OpenClaw's Commander program.
 * Follows the register.submit.ts pattern (dynamic import inside .action).
 */

import type { Command } from 'commander';

/**
 * Coerce the operator-supplied --top value into a safe integer page size
 * in [1, 100]. Mirrors the standalone-path guard at cli/args.ts:181
 * (Number.isSafeInteger && 1..100), closing the Commander-wrapper NaN
 * slip-through. The naive `parseInt + Math.min/max` shape lets NaN through
 * (parseInt('abc', 10) === NaN, Math.max(1, Math.min(100, NaN)) === NaN).
 * Sister to PKT-589/617/654/696/1141/1142 (parseInt coercion family).
 *
 * Returns DEFAULT_TOP_N (10) for unset, non-integer, non-finite,
 * out-of-range, or unsafe-integer inputs — exactly the same defaults
 * used by cli/args.ts:171 and api/handlers/genomes.ts:clampTopN().
 */
export const DEFAULT_TOP_N = 10;
export const MAX_TOP_N = 100;

export function resolveTopN(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_TOP_N;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return DEFAULT_TOP_N;
  if (n < 1 || n > MAX_TOP_N) return DEFAULT_TOP_N;
  return n;
}

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
      const topN = resolveTopN(opts.top);
      process.exitCode = await runLeaderboard({ martianType: opts.martianType, topN });
    });
}
