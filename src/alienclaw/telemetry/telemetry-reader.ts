/**
 * telemetry-reader.ts
 * Reads structured telemetry records from ~/.alienclaw/registry/telemetry/<date>/.
 *
 * Provides:
 *   readRecentMartianReports(sinceMs)  — all Martian execution reports since a timestamp
 *   summarizeFitness(martianId, windowMs) — aggregated fitness stats for one Martian
 */

import { readFile, readdir } from 'node:fs/promises';
import { join }              from 'node:path';
import { PATHS }             from '../constants.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MartianReport {
  reportCode:  string;
  ts:          number;
  taskId:      string;
  employeeId:  string;
  martianId:   string;
  domain:      string;
  outcome:     'SUCCESS' | 'FAILURE' | 'ESCALATED';
  summary:     string;
}

export interface FitnessSummary {
  runs:        number;
  successes:   number;
  escalations: number;
  failures:    number;
  rate:        number;  // successes / runs (0 if runs === 0)
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
      if (dateDir < cutoffDate.toISOString().slice(0, 10)) continue; // skip old dates
      const dirPath = join(telemetryRoot, dateDir);
      let entries: string[];
      try {
        entries = await readdir(dirPath);
      } catch {
        continue; // skip unreadable dirs
      }
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        // Skip non-report files (advisory_*, failforward_*)
        if (entry.startsWith('advisory_') || entry.startsWith('failforward_')) continue;
        if (entry.startsWith('agent-channel/')) continue;
        try {
          const raw = await readFile(join(dirPath, entry), 'utf-8');
          const parsed = JSON.parse(raw) as MartianReport;
          if (parsed.ts >= sinceMs && parsed.martianId) {
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
  const runs      = relevant.length;
  const successes = relevant.filter(r => r.outcome === 'SUCCESS').length;
  const escalations = relevant.filter(r => r.outcome === 'ESCALATED').length;
  const failures  = relevant.filter(r => r.outcome === 'FAILURE').length;
  const rate = runs > 0 ? successes / runs : 0;

  return { runs, successes, escalations, failures, rate };
}
