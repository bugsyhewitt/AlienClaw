/**
 * Pull top genomes from the network API into the local population.
 *
 * Fetches top-N genomes per martian type from GET /v1/genomes/top and
 * writes them into the local populations directory so the evolution loop
 * can use them as seeds.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NetworkAPIClient, GenomeEntry } from './client.js';

export interface PullResult {
  martianType: string;
  received: number;
  written: number;
  errors: string[];
}

/**
 * Pull top genomes for each given martian type.
 *
 * @param client  API client (no auth required for reads).
 * @param martianTypes  List of martian types to pull (e.g. ['compute', 'search_text']).
 * @param populationsRoot  $ALIENCLAW_POPULATIONS_ROOT — one subdir per type.
 * @param topN  How many genomes to pull per type (default 10).
 */
export async function pullTopGenomes(
  client: NetworkAPIClient,
  martianTypes: string[],
  populationsRoot: string,
  topN = 10,
): Promise<PullResult[]> {
  const results: PullResult[] = [];

  for (const martianType of martianTypes) {
    const result = await _pullType(client, martianType, populationsRoot, topN);
    results.push(result);
  }

  return results;
}

async function _pullType(
  client: NetworkAPIClient,
  martianType: string,
  populationsRoot: string,
  topN: number,
): Promise<PullResult> {
  const result: PullResult = { martianType, received: 0, written: 0, errors: [] };

  const r = await client.topGenomes(martianType, topN);
  if (!r.ok) {
    result.errors.push(`Fetch failed (${r.status}): ${r.error.code}`);
    return result;
  }

  const entries = r.data.genomes;
  result.received = entries.length;

  // Python's PopulationStorage reads <type>/entries/*.json, so seeds must
  // land there — and in the full PopulationEntry shape (_entry_from_dict
  // KeyErrors on anything less, which would poison Population.load for the
  // entire type).
  const entriesDir = join(populationsRoot, martianType, 'entries');
  try {
    mkdirSync(entriesDir, { recursive: true });
  } catch (err) {
    result.errors.push(`Cannot create directory: ${err}`);
    return result;
  }

  for (const entry of entries) {
    try {
      _writeEntry(entriesDir, entry);
      result.written++;
    } catch (err) {
      result.errors.push(`Write failed for ${entry.submission_id}: ${err}`);
    }
  }

  return result;
}

function _writeEntry(entriesDir: string, entry: GenomeEntry): void {
  const filename = `network-${entry.submission_id}.json`;
  const path = join(entriesDir, filename);
  // Full PopulationEntry shape (mirrors evolution/storage.py _entry_to_dict).
  // Genomes are server-validated (length/alphabet/checksum) at submission
  // time, which is the trust boundary for pulled seeds.
  const record = {
    entry_id:   `network-${entry.submission_id}`,
    genome:     entry.genome,
    fitness:    entry.fitness,
    generation: entry.generation ?? 0,
    parent_ids: [] as string[],
    run_metadata: {
      source:           'network',
      submission_id:    entry.submission_id,
      leaderboard_name: entry.leaderboard_name,
    },
    created_at: entry.submitted_at || new Date().toISOString(),
  };
  // Atomic-ish write: write to temp then rename not available in pure Node without tmp lib,
  // so write directly — population files are append-only seeds, not transactional.
  writeFileSync(path, JSON.stringify(record, null, 2), { encoding: 'utf-8', flag: 'w' });
}
