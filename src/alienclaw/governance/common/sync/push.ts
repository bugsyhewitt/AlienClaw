/**
 * Push best local genomes to the network API.
 *
 * Reads top-N genomes from local population storage files and submits
 * each to the server via POST /v1/genomes. Skips genomes that were
 * already submitted (server returns 200 for duplicates).
 *
 * Every submission MUST carry a `leaderboard_name` — a public
 * 8-uppercase-letter operator handle (^[A-Z]{8}$). The deployed server
 * hard-requires it and returns 400 MISSING_FIELDS otherwise, silently
 * dropping the genome. Each population entry's name is sourced from its
 * own `run_metadata.leaderboard_name` when present and valid; otherwise
 * the install-level `defaultLeaderboardName` is used. Entries that can
 * resolve no valid name are skipped locally (recorded as an error) rather
 * than dispatched to a guaranteed rejection.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NetworkAPIClient } from './client.js';
import { validateLeaderboardName } from '../leaderboard.js';

export interface PushResult {
  martianType: string;
  pushed: number;
  skipped: number;
  errors: string[];
}

/** A single local population entry read off disk. */
interface PopulationEntry {
  genome: string;
  fitness: number;
  run_metadata: Record<string, unknown>;
}

/**
 * Resolve the leaderboard name for one population entry.
 *
 * Priority:
 *   1. `run_metadata.leaderboard_name` — when present and ^[A-Z]{8}$.
 *   2. `fallback` — the install-level default board name.
 *
 * Returns `null` when neither source yields a valid name, signalling the
 * caller to skip the entry rather than emit a request the server will reject.
 */
export function resolveLeaderboardName(
  runMetadata: Record<string, unknown>,
  fallback: string,
): string | null {
  const fromMeta = runMetadata['leaderboard_name'];
  if (typeof fromMeta === 'string' && validateLeaderboardName(fromMeta)) {
    return fromMeta;
  }
  if (validateLeaderboardName(fallback)) {
    return fallback;
  }
  return null;
}

/**
 * Push the top-N genomes for each martian type in populationsRoot.
 *
 * @param client  Authenticated API client.
 * @param populationsRoot  $ALIENCLAW_POPULATIONS_ROOT — contains one subdir per martian type.
 * @param defaultLeaderboardName  Install-level board handle (^[A-Z]{8}$) used for
 *        any entry whose run_metadata does not carry its own valid name.
 * @param topN  How many genomes per type to push (default 5).
 */
export async function pushTopGenomes(
  client: NetworkAPIClient,
  populationsRoot: string,
  defaultLeaderboardName: string,
  topN = 5,
): Promise<PushResult[]> {
  let typeDirs: string[];
  try {
    typeDirs = readdirSync(populationsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }

  const results: PushResult[] = [];

  for (const martianType of typeDirs) {
    const result = await _pushType(
      client,
      populationsRoot,
      martianType,
      defaultLeaderboardName,
      topN,
    );
    results.push(result);
  }

  return results;
}

async function _pushType(
  client: NetworkAPIClient,
  populationsRoot: string,
  martianType: string,
  defaultLeaderboardName: string,
  topN: number,
): Promise<PushResult> {
  const typeDir = join(populationsRoot, martianType);
  const result: PushResult = { martianType, pushed: 0, skipped: 0, errors: [] };

  let entries: PopulationEntry[];
  try {
    entries = _loadTopEntries(typeDir, topN);
  } catch (err) {
    result.errors.push(`Failed to read population: ${err}`);
    return result;
  }

  for (const entry of entries) {
    const leaderboardName = resolveLeaderboardName(entry.run_metadata, defaultLeaderboardName);
    if (leaderboardName === null) {
      // No valid board name available — skip rather than send a guaranteed 400.
      result.errors.push(
        'Missing leaderboard_name: entry run_metadata has no valid name and no valid install default was provided',
      );
      continue;
    }

    const r = await client.submitGenome(
      entry.genome,
      martianType,
      entry.fitness,
      leaderboardName,
      entry.run_metadata,
    );
    if (!r.ok) {
      if (r.status === 422 || r.status === 400) {
        // Validation failure — log but don't count as push error (bad local data)
        result.errors.push(`Validation error for genome: ${r.error.code}`);
      } else if (r.status === 429) {
        // Rate limited — stop pushing for this session
        result.errors.push('RATE_LIMIT_EXCEEDED — stopping push');
        break;
      } else {
        result.errors.push(`Submit failed (${r.status}): ${r.error.code}`);
      }
    } else if (r.status === 200) {
      result.skipped++;  // Duplicate
    } else {
      result.pushed++;   // 201 — new submission
    }
  }

  return result;
}

function _loadTopEntries(
  typeDir: string,
  topN: number,
): PopulationEntry[] {
  let files: string[];
  try {
    files = readdirSync(typeDir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }

  type Entry = { genome: string; fitness: number; run_metadata?: Record<string, unknown> };
  const parsed: Entry[] = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(typeDir, f), 'utf-8');
      parsed.push(JSON.parse(raw) as Entry);
    } catch {
      // Skip corrupted entries
    }
  }

  return parsed
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, topN)
    .map(e => ({ genome: e.genome, fitness: e.fitness, run_metadata: e.run_metadata ?? {} }));
}
