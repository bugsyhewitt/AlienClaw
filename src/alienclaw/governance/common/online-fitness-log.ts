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

export class OnlineFitnessLog {
  private readonly _path: string;

  constructor(path?: string) {
    this._path = path ?? DEFAULT_PATH;
    mkdirSync(dirname(this._path), { recursive: true });
  }

  record(martianType: string, fitness: number): void {
    const entry: FitnessEntry = {
      martian_type: martianType,
      fitness,
      ts:           new Date().toISOString(),
    };
    appendFileSync(this._path, JSON.stringify(entry) + '\n', 'utf-8');
  }

  read(): FitnessEntry[] {
    if (!existsSync(this._path)) return [];
    return readFileSync(this._path, 'utf-8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l) as FitnessEntry);
  }

  clear(): void {
    if (existsSync(this._path)) unlinkSync(this._path);
  }
}
