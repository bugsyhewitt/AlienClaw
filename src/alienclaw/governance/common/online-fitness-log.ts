/**
 * OnlineFitnessLog — append-only JSONL keyed by martian_type.
 *
 * TypeScript port of src/alienclaw/evolution/online_fitness.py.
 * Writes to the same default path so Python and TypeScript readers share one log.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// PKT-1294: cap the on-disk size of the appended JSONL log so a hostile or
// misconfigured writer can't OOM every reader. Mirrors the Python twin at
// `src/alienclaw/evolution/online_fitness.py:67-79` which already streams
// line-by-line. 64 MiB covers all current production campaigns (≤ ~5 MiB
// observed) with a 1000× margin.
const MAX_ONLINE_FITNESS_LOG_BYTES = 64 * 1024 * 1024;
// Read chunk size for the streaming read. 64 KiB balances syscall overhead
// against peak per-chunk buffer allocation; per-line state never exceeds one
// chunk + one line.
const READ_CHUNK_BYTES = 64 * 1024;

const DEFAULT_PATH = join(homedir(), '.alienclaw', 'online_fitness.jsonl');

export interface FitnessEntry {
  martian_type: string;
  fitness:      number;
  ts:           string;
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
    // PKT-1294: chunked synchronous read — keeps per-call memory bounded by the file's
    // STREAMING footprint (≤ READ_CHUNK_BYTES + one pending line) rather than the
    // pre-fix full-file materialized footprint (file_size × UTF-8 expansion). Mirrors
    // the Python twin's line-iterator shape at `online_fitness.py:67-79`. The cap at
    // MAX_ONLINE_FITNESS_LOG_BYTES short-circuits once crossed; pre-fix, there was no
    // cap and a 1 GiB log forced ≥ 1 GiB of RSS before any per-line parse.
    const out: FitnessEntry[] = [];
    let fd: number;
    try {
      fd = openSync(this._path, 'r');
    } catch {
      return [];  // ENOENT or permission error — silent return, matches pre-fix behavior
    }
    try {
      const stat = fstatSync(fd);
      const totalSize = stat.size;
      const maxBytes = Math.min(totalSize, MAX_ONLINE_FITNESS_LOG_BYTES);
      const buf = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      let pending = '';
      let bytesSeen = 0;
      let firstLine = true;
      while (bytesSeen < maxBytes) {
        const want = Math.min(READ_CHUNK_BYTES, maxBytes - bytesSeen);
        const n = readSync(fd, buf, 0, want, bytesSeen);
        if (n <= 0) break;
        bytesSeen += n;
        pending += buf.toString('utf-8', 0, n);
        // PKT-634 BOM tolerance on first line.
        if (firstLine && pending.charCodeAt(0) === 0xFEFF) pending = pending.slice(1);
        firstLine = false;
        let nl: number;
        while ((nl = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
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
      }
    } finally {
      closeSync(fd);
    }
    return out;
  }

  clear(): void {
    if (existsSync(this._path)) unlinkSync(this._path);
  }
}
