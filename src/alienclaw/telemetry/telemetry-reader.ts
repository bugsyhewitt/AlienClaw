/**
 * telemetry-reader.ts
 * Reads structured telemetry records from ~/.alienclaw/registry/telemetry/<date>/.
 *
 * Provides:
 *   readRecentMartianReports(sinceMs)  — all Martian execution reports since a timestamp
 *   summarizeFitness(martianId, windowMs) — aggregated fitness stats for one Martian
 */

import { readFile, readdir } from 'node:fs/promises';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../constants.js';
import { dateStamp } from '../utils.js';

// PKT-1294: cap the on-disk size of the appended JSONL log so a hostile or
// misconfigured writer can't OOM the server-side reader (called from
// /v1/martian-types on every request). Mirrors the Python twin at
// `online_fitness.py:67-79`. 64 MiB covers all current production campaigns
// (≤ ~5 MiB observed) with a 1000× margin.
const MAX_ONLINE_FITNESS_LOG_BYTES = 64 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MartianReport {
  reportCode:  string;
  ts:          number;
  taskId:      string;
  subagentId:  string;
  martianId:   string;
  domain:      string;
  outcome:     'SUCCESS' | 'FAILURE' | 'ESCALATED';
  summary:     string;
}

export interface FitnessSummary {
  runs:            number;
  successes:       number;
  escalations:     number;
  failures:        number;
  rate:            number;  // successes / runs (0 if runs === 0)
  malformed_count?: number; // PKT-615: count of reports with non-canonical outcome enum values
}

export interface OnlineFitnessEntry {
  martian_type: string;
  fitness:      number;
  ts:           string;  // ISO 8601
}

export interface OnlineFitnessAggregate {
  count:        number;
  mean_fitness: number;  // 0 when count === 0
}

// ── Runtime shape predicate ───────────────────────────────────────────────────

/**
 * Type guard that validates every field of a parsed MartianReport at runtime.
 * Mirrors the analogous checks in aggregateOnlineFitness (L112-114) and the
 * established pattern from online_fitness.py (referenced at L61 of that file).
 *
 * All three field defects are closed here:
 *   A — outcome must be exactly one of the three enum literals (closes false-URGENT)
 *   B — ts must be a finite number (closes silent telemetry loss on string ts)
 *   C — martianId must be a non-empty string (closes silent aggregation keying loss)
 */
function isValidMartianReport(parsed: unknown): parsed is MartianReport {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const p = parsed as Record<string, unknown>;
  if (typeof p['ts'] !== 'number' || !Number.isFinite(p['ts'])) return false;          // Defect B
  if (typeof p['martianId'] !== 'string' || p['martianId'].length === 0) return false;  // Defect C
  if (typeof p['reportCode'] !== 'string') return false;
  if (p['outcome'] !== 'SUCCESS' && p['outcome'] !== 'FAILURE' && p['outcome'] !== 'ESCALATED') return false; // Defect A
  return true;
}

// ── Reader ────────────────────────────────────────────────────────────────────

/**
 * Return all Martian reports with ts >= sinceMs.
 */
export async function readRecentMartianReports(sinceMs: number): Promise<MartianReport[]> {
  const telemetryRoot = PATHS.telemetry;
  const cutoffDate = new Date(sinceMs);
  const reports: MartianReport[] = [];

  try {
    const dateDirs = await readdir(telemetryRoot);
    for (const dateDir of dateDirs) {
      if (dateDir < dateStamp(cutoffDate)) continue; // skip old dates
      const dirPath = join(telemetryRoot, dateDir);
      let entries: string[];
      try {
        entries = await readdir(dirPath);
      } catch {
        continue; // skip unreadable dirs
      }
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        // Skip non-report files (advisory_*, failforward_*, agent-channel*).
        // Note: readdir returns basenames only (no slashes), so the agent-channel
        // subdirectory itself is already filtered by !entry.endsWith('.json') above.
        // The prefix check below guards against any top-level file whose basename
        // starts with "agent-channel" (e.g. a write that lands outside the subdir).
        if (entry.startsWith('advisory_') || entry.startsWith('failforward_')) continue;
        if (entry.startsWith('agent-channel')) continue;
        try {
          const raw = await readFile(join(dirPath, entry), 'utf-8');
          const parsed: unknown = JSON.parse(raw);
          if (isValidMartianReport(parsed) && parsed.ts >= sinceMs) {
            reports.push(parsed);
          }
        } catch {
          // Skip malformed files
        }
      }
    }
  } catch {
    // Telemetry dir may not exist yet — return empty
  }

  return reports.sort((a, b) => a.ts - b.ts);
}

/**
 * Aggregate online fitness entries for a specific martian_type.
 * Reads ~/.alienclaw/online_fitness.jsonl written by OnlineFitnessLog (Python).
 * Returns {count:0, mean_fitness:0} when the file is absent or has no matching entries.
 */
export async function aggregateOnlineFitness(
  martianType: string,
): Promise<OnlineFitnessAggregate> {
  const logPath = join(PATHS.home, 'online_fitness.jsonl');
  // PKT-1294: chunked streaming read — caps per-call memory at ≤ READ_CHUNK_BYTES
  // (one chunk + one pending line) plus the bounded matching-entries array. Pre-fix,
  // the full file was materialized into a UTF-8 string before any per-line parse,
  // so a 1 GiB log forced ≥ 1 GiB of RSS in this server-side reader (called from
  // /v1/martian-types on every request). The MAX_ONLINE_FITNESS_LOG_BYTES cap
  // short-circuits once crossed. The aggregate shape (count + mean of matching
  // finite [0,1] entries) is unchanged.
  const entries: OnlineFitnessEntry[] = [];
  let fd: number;
  try {
    fd = openSync(logPath, 'r');
  } catch {
    return { count: 0, mean_fitness: 0 };  // ENOENT or permission error — matches pre-fix catch
  }
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
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const parsed = JSON.parse(trimmed) as OnlineFitnessEntry;
          if (parsed.martian_type === martianType &&
              typeof parsed.fitness === 'number' && Number.isFinite(parsed.fitness) &&
              parsed.fitness >= 0 && parsed.fitness <= 1) {
            entries.push(parsed);
          }
        } catch {
          continue;  // malformed JSONL line — skip
        }
      }
    }
  } finally {
    closeSync(fd);
  }

  if (entries.length === 0) return { count: 0, mean_fitness: 0 };
  const sum = entries.reduce((acc, e) => acc + e.fitness, 0);
  return { count: entries.length, mean_fitness: sum / entries.length };
}

/**
 * Compute fitness statistics for a Martian over a time window.
 * Returns a FitnessSummary with aggregated counts and success rate.
 */
export async function summarizeFitness(
  martianId: string,
  windowMs:  number,
): Promise<FitnessSummary> {
  const sinceMs = Date.now() - windowMs;
  const reports = await readRecentMartianReports(sinceMs);

  const relevant = reports.filter(r => r.martianId === martianId);
  // PKT-615: reject malformed outcomes (non-canonical enum values) so they don't
  // inflate `runs` while contributing to no numerator (silent deflation defect).
  const valid = relevant.filter(r =>
    r.outcome === 'SUCCESS' || r.outcome === 'FAILURE' || r.outcome === 'ESCALATED',
  );
  const malformedCount = relevant.length - valid.length;
  const runs        = valid.length;
  const successes   = valid.filter(r => r.outcome === 'SUCCESS').length;
  const escalations = valid.filter(r => r.outcome === 'ESCALATED').length;
  const failures    = valid.filter(r => r.outcome === 'FAILURE').length;
  const rate        = runs > 0 ? successes / runs : 0;

  return { runs, successes, escalations, failures, rate, ...(malformedCount > 0 ? { malformed_count: malformedCount } : {}) };
}
