/**
 * leaderboard.ts
 * Implements `alienclaw leaderboard` — prints the public top-N for a martian type.
 * Pull-only: no submission, no credentials required.
 */
import { hardenedFetch, validateLeaderboardResponse } from '../governance/common/leaderboard.js';
import type { LeaderboardCommandArgs } from './args.js';

const DEFAULT_API_URL = 'https://api.alienclaw.net';

export async function runLeaderboard(args: LeaderboardCommandArgs): Promise<number> {
  const apiUrl = (process.env['ALIENCLAW_API_URL'] ?? DEFAULT_API_URL).replace(/\/$/, '');
  const url = `${apiUrl}/v1/genomes/top?martian_type=${encodeURIComponent(args.martianType)}&n=${args.topN}`;

  try {
    const raw   = await hardenedFetch(url);
    const board = validateLeaderboardResponse(raw);

    const entries = [...board.genomes].sort((a, b) => b.fitness - a.fitness);
    for (const [i, entry] of entries.entries()) {
      process.stdout.write(`${i + 1}\t${entry.leaderboard_name}\t${entry.fitness.toFixed(4)}\n`);
    }
    return 0;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[alienclaw] leaderboard: ${msg}\n`);
    return 1;
  }
}
