/**
 * Push best local genomes to the network API.
 *
 * Reads top-N genomes from local population storage files and submits
 * each to the server via POST /v1/genomes. Skips genomes that were
 * already submitted (server returns 200 for duplicates).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NetworkAPIClient } from './client.js';

export interface PushResult {
  martianType: string;
  pushed: number;
  skipped: number;
  errors: string[];
}

/**
 * Push the top-N genomes for each martian type in populationsRoot.
 *
 * @param client  Authenticated API client.
 * @param populationsRoot  $ALIENCLAW_POPULATIONS_ROOT — contains one subdir per martian type.
 * @param topN  How many genomes per type to push (default 5).
 */
export async function pushTopGenomes(
  client: NetworkAPIClient,
  populationsRoot: string,
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
    const result = await _pushType(client, populationsRoot, martianType, topN);
    results.push(result);
  }

  return results;
}

async function _pushType(
  client: NetworkAPIClient,
  populationsRoot: string,
  martianType: string,
  topN: number,
): Promise<PushResult> {
  const typeDir = join(populationsRoot, martianType);
  const result: PushResult = { martianType, pushed: 0, skipped: 0, errors: [] };

  let entries: Array<{ genome: string; fitness: number; run_metadata: Record<string, unknown> }>;
  try {
    entries = _loadTopEntries(typeDir, topN);
  } catch (err) {
    result.errors.push(`Failed to read population: ${err}`);
    return result;
  }

  for (const entry of entries) {
    const r = await client.submitGenome(
      entry.genome,
      martianType,
      entry.fitness,
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
): Array<{ genome: string; fitness: number; run_metadata: Record<string, unknown> }> {
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
