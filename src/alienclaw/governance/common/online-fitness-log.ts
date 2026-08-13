/**
 * OnlineFitnessLog — append-only JSONL keyed by martian_type.
 *
 * TypeScript port of src/alienclaw/evolution/online_fitness.py.
 * Writes to the same default path so Python and TypeScript readers share one log.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_PATH = join(homedir(), '.alienclaw', 'online_fitness.jsonl');

export interface FitnessEntry {
  martian_type: string;
  fitness:      number;
  ts:           string;
}

// Strip a single leading UTF-8 BOM if present (PKT-634, mirrors Python `open(encoding="utf-8")`
// BOM tolerance). Without this, `JSON.parse` of the first line returns "Unexpected token ﻿".
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

export class OnlineFitnessLog {
  private readonly _path: string;

  constructor(path?: string) {
    this._path = path ?? DEFAULT_PATH;
    mkdirSync(dirname(this._path), { recursive: true });
  }

  record(martianType: string, fitness: number): void {
    // PKT-634: cross-language parity with Python `online_fitness.py:42-48 record()` finite-guard.
    // Python drops non-finite (NaN/±Inf) with a stderr WARNING; we do the same here.
    // Out-of-range fitness (1.5, -0.5) is NOT dropped — Python preserves it (overmind verdict
    // PKT-608 explicitly rejects writer-side range-drop as cross-language inconsistency).
    if (!Number.isFinite(fitness)) {
      process.stderr.write(
        `[online-fitness] WARNING: dropped non-finite fitness ` +
        `(martian_type=${JSON.stringify(martianType)}, fitness=${String(fitness)})\n`,
      );
      return;
    }
    const entry: FitnessEntry = {
      martian_type: martianType,
      fitness,
      ts:           new Date().toISOString(),
    };
    appendFileSync(this._path, JSON.stringify(entry) + '\n', 'utf-8');
  }

  read(): FitnessEntry[] {
    if (!existsSync(this._path)) return [];
    // PKT-634 prescribed subset (BOM strip + per-line try/catch + non-object skip).
    // Malformed lines (truncated, partial-write from crash mid-serialization) are silently skipped.
    // Non-object JSON lines (raw null, number, string) are skipped.
    // NOTE: Python `online_fitness.py:65-76 read()` also runs `_is_valid_fitness_entry` which
    // rejects non-finite, non-numeric, and out-of-range [0,1] fitness values. That validity
    // filter is outside PKT-634 scope (overmind verdict: reader-side range filter is the
    // consumer's job — PKT-589 `telemetry-reader.ts` owns that layer). Out-of-range/null/string
    // fitness entries are therefore preserved here, unlike the Python twin's read().
    const raw = stripBom(readFileSync(this._path, 'utf-8'));
    const out: FitnessEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;  // malformed JSONL line — skip per Python twin policy
      }
      if (typeof parsed !== 'object' || parsed === null) continue;
      out.push(parsed as FitnessEntry);
    }
    return out;
  }

  clear(): void {
    if (existsSync(this._path)) unlinkSync(this._path);
  }
}
