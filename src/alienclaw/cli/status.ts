/**
 * status.ts
 * Implements `alienclaw status` — prints live-fitness trends per martian_type.
 */
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join }    from 'node:path';

// PKT-1294: cap the on-disk size of the appended JSONL log so a hostile or
// misconfigured writer can't OOM the operator-facing CLI. Mirrors the Python
// twin at `online_fitness.py:67-79` which already streams. 64 MiB covers all
// current production campaigns (≤ ~5 MiB observed) with a 1000× margin.
const MAX_ONLINE_FITNESS_LOG_BYTES = 64 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

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
    // PKT-1294: chunked streaming read — caps per-call memory at ≤ READ_CHUNK_BYTES
    // (one chunk + one pending line). Pre-fix, the entire file was materialized into a
    // single UTF-8 string before any per-line parse, so a hostile or misconfigured
    // writer could OOM the operator CLI. The MAX_ONLINE_FITNESS_LOG_BYTES cap
    // short-circuits once crossed.
    let fd: number;
    try {
      fd = openSync(onlinePath, 'r');
    } catch {
      fd = -1;  // existsSync was true a moment ago; race or perms error — silently skip
    }
    if (fd >= 0) {
      try {
        const stat = fstatSync(fd);
        const totalSize = stat.size;
        const maxBytes = Math.min(totalSize, MAX_ONLINE_FITNESS_LOG_BYTES);
        const buf = Buffer.allocUnsafe(READ_CHUNK_BYTES);
        let pending = '';
        let bytesSeen = 0;
        while (bytesSeen < maxBytes) {
          const want = Math.min(READ_CHUNK_BYTES, maxBytes - bytesSeen);
          const n = readSync(fd, buf, 0, want, bytesSeen);
          if (n <= 0) break;
          bytesSeen += n;
          pending += buf.toString('utf-8', 0, n);
          let nl: number;
          while ((nl = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, nl);
            pending = pending.slice(nl + 1);
            if (!line.trim()) continue;
            try {
              const e = JSON.parse(line) as OnlineFitnessEntry;
              // PKT-1141: typeof === 'number' is necessary but not sufficient — JSON.parse
              // silently coerces `1e500` (valid JSON syntax) to Infinity, which then poisons
              // Math.max(cur.maxFitness, Infinity) permanently for that martian_type, and
              // Infinity.toFixed(4) returns the 8-char string "Infinity" instead of a 4-char
              // decimal. Mirror the hardening already applied in cli/runs.ts:55, cli/show.ts:34,
              // telemetry-reader.ts:136 (PKT-589), sync/local-population.ts:51 (PKT-654),
              // and ~12 other sites (see defect-class trend in PKT-1141 packet).
              if (typeof e.martian_type !== 'string'
                  || typeof e.fitness !== 'number'
                  || !Number.isFinite(e.fitness)) continue;
              const cur = online.get(e.martian_type) ?? { count: 0, maxFitness: -Infinity };
              online.set(e.martian_type, {
                count:      cur.count + 1,
                maxFitness: Math.max(cur.maxFitness, e.fitness),
              });
            } catch { /* skip malformed JSONL lines */ }
          }
        }
      } finally {
        closeSync(fd);
      }
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
