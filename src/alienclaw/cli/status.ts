/**
 * status.ts
 * Implements `alienclaw status` — prints live-fitness trends per martian_type.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join }    from 'node:path';

function defaultHome(): string {
  return process.env['ALIENCLAW_HOME'] ?? join(homedir(), '.alienclaw');
}

interface LiveFitnessSummary {
  martians: Array<{ id: string; fitness: number }>;
}

interface OnlineFitnessEntry {
  martian_type: string;
  fitness:      number;
}

export async function runStatus(home = defaultHome()): Promise<number> {
  const summaryPath = join(home, 'live-fitness-summary.json');
  const onlinePath  = join(home, 'online_fitness.jsonl');

  // Group online_fitness.jsonl by martian_type: observation count + max fitness
  const online = new Map<string, { count: number; maxFitness: number }>();
  if (existsSync(onlinePath)) {
    for (const line of readFileSync(onlinePath, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as OnlineFitnessEntry;
        if (typeof e.martian_type !== 'string' || typeof e.fitness !== 'number') continue;
        const cur = online.get(e.martian_type) ?? { count: 0, maxFitness: -Infinity };
        online.set(e.martian_type, {
          count:      cur.count + 1,
          maxFitness: Math.max(cur.maxFitness, e.fitness),
        });
      } catch { /* skip malformed JSONL lines */ }
    }
  }

  // Read live-fitness-summary.json for ordered list + fallback fitness
  let summaryMartians: Array<{ id: string; fitness: number }> = [];
  if (existsSync(summaryPath)) {
    try {
      const parsed = JSON.parse(readFileSync(summaryPath, 'utf-8')) as LiveFitnessSummary;
      if (Array.isArray(parsed.martians)) summaryMartians = parsed.martians;
    } catch { /* ignore corrupt summary */ }
  }

  if (summaryMartians.length === 0 && online.size === 0) {
    process.stdout.write('No fitness data found.\n');
    return 0;
  }

  // Merge: summary order first, then online-only types
  const seen = new Set<string>();
  const rows: Array<{ type: string; count: number; maxFitness: number }> = [];
  for (const { id, fitness } of summaryMartians) {
    seen.add(id);
    const o = online.get(id);
    rows.push({ type: id, count: o?.count ?? 0, maxFitness: o ? o.maxFitness : fitness });
  }
  for (const [type, o] of online) {
    if (!seen.has(type)) rows.push({ type, count: o.count, maxFitness: o.maxFitness });
  }

  for (const { type, count, maxFitness } of rows) {
    process.stdout.write(`${type}\t${count}\t${maxFitness.toFixed(4)}\n`);
  }
  return 0;
}
