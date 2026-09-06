/**
 * runs.ts
 * Implements `alienclaw runs` — lists persisted local populations.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function defaultPopulationsRoot(): string {
  return process.env['ALIENCLAW_POPULATIONS_ROOT'] ?? join(homedir(), '.alienclaw', 'populations');
}

export async function runRuns(populationsRoot = defaultPopulationsRoot()): Promise<number> {
  if (!existsSync(populationsRoot)) {
    return 0;
  }

  let dirs: string[];
  try {
    dirs = readdirSync(populationsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch {
    return 0;
  }

  const rows: Array<{ type: string; generations: number; maxFitness: number }> = [];

  for (const martianType of dirs) {
    const metadataPath = join(populationsRoot, martianType, 'metadata.json');
    if (!existsSync(metadataPath)) continue;

    let generations = 0;
    try {
      const md = JSON.parse(readFileSync(metadataPath, 'utf-8')) as Record<string, unknown>;
      if (typeof md['generations'] === 'number' && Number.isFinite(md['generations'])) {
        generations = Math.max(0, Math.floor(md['generations']));
      }
    } catch { /* skip malformed metadata */ }

    let maxFitness = 0;
    const statsDir = join(populationsRoot, martianType, 'stats');
    if (existsSync(statsDir)) {
      try {
        const statFiles = readdirSync(statsDir)
          .filter(f => /^gen-\d+\.json$/.test(f))
          .sort();
        const latestFile = statFiles[statFiles.length - 1];
        if (latestFile) {
          const stats = JSON.parse(
            readFileSync(join(statsDir, latestFile), 'utf-8'),
          ) as Record<string, unknown>;
          const mf = stats['max_fitness'];
          if (typeof mf === 'number' && Number.isFinite(mf)) {
            maxFitness = mf;
          }
        }
      } catch { /* skip malformed stats */ }
    }

    rows.push({ type: martianType, generations, maxFitness });
  }

  for (const { type, generations, maxFitness } of rows) {
    process.stdout.write(`${type}\t${generations}\t${maxFitness.toFixed(4)}\n`);
  }
  return 0;
}
