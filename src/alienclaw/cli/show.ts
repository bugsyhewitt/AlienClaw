import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ShowCommandArgs } from './args.js';

function defaultPopulationsRoot(): string {
  return process.env['ALIENCLAW_POPULATIONS_ROOT'] ?? join(homedir(), '.alienclaw', 'populations');
}

export async function runShow(
  args: ShowCommandArgs,
  populationsRoot = defaultPopulationsRoot(),
): Promise<number> {
  const entriesDir = join(populationsRoot, args.martianType, 'entries');

  if (!existsSync(entriesDir)) {
    return 0;
  }

  let files: string[];
  try {
    files = readdirSync(entriesDir).filter(f => f.endsWith('.json'));
  } catch {
    return 0;
  }

  const entries: Array<{ fitness: number; genome: string }> = [];

  for (const file of files) {
    try {
      const raw = JSON.parse(
        readFileSync(join(entriesDir, file), 'utf-8'),
      ) as Record<string, unknown>;
      const fitness = typeof raw['fitness'] === 'number' && Number.isFinite(raw['fitness'])
        ? raw['fitness']
        : null;
      const genome = typeof raw['genome'] === 'string' && raw['genome'].length === 256
        ? raw['genome']
        : null;
      if (fitness !== null && genome !== null) {
        entries.push({ fitness, genome });
      }
    } catch { /* skip malformed */ }
  }

  entries.sort((a, b) => b.fitness - a.fitness);
  const top = entries.slice(0, args.topN);

  for (const [i, entry] of top.entries()) {
    process.stdout.write(`${i + 1}\t${entry.fitness.toFixed(4)}\t${entry.genome}\n`);
  }
  return 0;
}
