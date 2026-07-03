/**
 * Read local evolution populations off disk (the Python layer's layout).
 *
 * PopulationStorage (src/alienclaw/evolution/storage.py) writes
 *   <root>/<martian_type>/entries/<uuid>.json   — one population entry each
 *   <root>/<martian_type>/metadata.json         — config, not an entry
 *   <root>/<martian_type>/stats/                — per-generation stats
 * so entry readers must look ONLY inside entries/. (The previous flat
 * <root>/<type>/*.json reading parsed metadata.json as a candidate entry
 * and found no genomes at all against real populations.)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { GenomeResult } from '../leaderboard.js';

/** A single local population entry read off disk. */
export interface LocalPopulationEntry {
  genome:       string;
  fitness:      number;
  generation?:  number;
  run_metadata: Record<string, unknown>;
}

/**
 * Top-N entries (by fitness, descending) for one martian type.
 * Missing directories yield []; corrupted or shape-invalid entry files
 * are skipped.
 */
export function readTopEntries(
  populationsRoot: string,
  martianType: string,
  n: number,
): LocalPopulationEntry[] {
  const entriesDir = join(populationsRoot, martianType, 'entries');
  let files: string[];
  try {
    files = readdirSync(entriesDir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }

  const parsed: LocalPopulationEntry[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(entriesDir, f), 'utf-8')) as Record<string, unknown>;
      if (typeof raw['genome'] !== 'string' || typeof raw['fitness'] !== 'number') continue;
      parsed.push({
        genome:       raw['genome'],
        fitness:      raw['fitness'],
        generation:   typeof raw['generation'] === 'number' ? raw['generation'] : undefined,
        run_metadata: (raw['run_metadata'] ?? {}) as Record<string, unknown>,
      });
    } catch {
      // Skip corrupted entries
    }
  }

  return parsed.sort((a, b) => b.fitness - a.fitness).slice(0, n);
}

/**
 * The operator's best local genome for a martian type, in the
 * GenomeResult shape leaderboardCheck() consumes. Null when the
 * population is absent or empty.
 */
export function readOperatorBest(
  populationsRoot: string,
  martianType: string,
): GenomeResult | null {
  const [best] = readTopEntries(populationsRoot, martianType, 1);
  if (!best) return null;
  return {
    genome:      best.genome,
    genomeHash:  createHash('sha256').update(best.genome).digest('hex'),
    martianType,
    fitness:     best.fitness,
  };
}
