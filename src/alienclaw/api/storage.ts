/**
 * Flat-file persistence for the AlienClaw community API.
 * TypeScript port of api/storage.py (Packet 31.5).
 *
 * Layout:
 *   DATA_ROOT/genomes/<martian_type>/<submission_id>.json
 *   DATA_ROOT/installs/<hash[:2]>/<hash>.json
 *   DATA_ROOT/stats/global.json
 *
 * If ALIENCLAW_DB_URL is set, SubmissionStore uses MySQL instead.
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { GenomeEntry } from './types.js';

function dataRoot(): string {
  return process.env['ALIENCLAW_API_DATA_ROOT'] ?? '/var/alienclaw';
}

function atomicWrite(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, path);
}

// ── SubmissionStore ────────────────────────────────────────────────────────

export interface StoredSubmission {
  submission_id:    string;
  genome:           string;
  martian_type:     string;
  fitness:          number;
  leaderboard_name: string;
  api_key_hash:     string;
  run_metadata:     Record<string, unknown>;
  submitted_at:     string;
}

export class SubmissionStore {
  private readonly _root: string;

  constructor(root?: string) {
    this._root = root ?? dataRoot();
  }

  private _genomeDir(martianType: string): string {
    return join(this._root, 'genomes', martianType);
  }

  save(opts: {
    genome:          string;
    martianType:     string;
    fitness:         number;
    apiKeyHash:      string;
    runMetadata:     Record<string, unknown>;
    leaderboardName: string;
  }): [string, string] {
    const sid = `sub_${randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();
    const data: StoredSubmission = {
      submission_id:    sid,
      genome:           opts.genome,
      martian_type:     opts.martianType,
      fitness:          opts.fitness,
      leaderboard_name: opts.leaderboardName,
      api_key_hash:     opts.apiKeyHash,
      run_metadata:     opts.runMetadata,
      submitted_at:     now,
    };
    const path = join(this._genomeDir(opts.martianType), `${sid}.json`);
    atomicWrite(path, data as unknown as Record<string, unknown>);
    this._updateGlobalStats(opts.martianType, opts.fitness);
    return [sid, now];
  }

  topForType(martianType: string, n = 10): StoredSubmission[] {
    const dir = this._genomeDir(martianType);
    if (!existsSync(dir)) return [];
    const entries: StoredSubmission[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        entries.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as StoredSubmission);
      } catch { /* skip corrupt files */ }
    }
    entries.sort((a, b) => b.fitness - a.fitness);
    return entries.slice(0, n);
  }

  countForType(martianType: string): number {
    const dir = this._genomeDir(martianType);
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter(f => f.endsWith('.json')).length;
  }

  rankForFitness(martianType: string, fitness: number): number {
    const dir = this._genomeDir(martianType);
    if (!existsSync(dir)) return 1;
    let countAbove = 0;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const e = JSON.parse(readFileSync(join(dir, f), 'utf8')) as StoredSubmission;
        if (e.fitness > fitness) countAbove++;
      } catch { /* skip */ }
    }
    return countAbove + 1;
  }

  isNewTop(martianType: string, fitness: number): boolean {
    const top = this.topForType(martianType, 1);
    return top.length === 0 || fitness >= top[0]!.fitness;
  }

  findDuplicate(opts: {
    genome:      string;
    martianType: string;
    fitness:     number;
    apiKeyHash:  string;
  }): StoredSubmission | null {
    const dir = this._genomeDir(opts.martianType);
    if (!existsSync(dir)) return null;
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const e = JSON.parse(readFileSync(join(dir, f), 'utf8')) as StoredSubmission;
        if (e.genome === opts.genome && e.fitness === opts.fitness
            && e.api_key_hash === opts.apiKeyHash && e.submitted_at >= cutoff) {
          return e;
        }
      } catch { /* skip */ }
    }
    return null;
  }

  private _updateGlobalStats(martianType: string, fitness: number): void {
    const path = join(this._root, 'stats', 'global.json');
    let stats: Record<string, unknown> = {
      total_genomes: 0, total_fitness_evaluations: 0, top_fitness_by_type: {},
    };
    if (existsSync(path)) {
      try { stats = JSON.parse(readFileSync(path, 'utf8')); } catch { /* use defaults */ }
    }
    stats['total_genomes'] = ((stats['total_genomes'] as number) ?? 0) + 1;
    stats['total_fitness_evaluations'] = ((stats['total_fitness_evaluations'] as number) ?? 0) + 1;
    const byType = (stats['top_fitness_by_type'] ?? {}) as Record<string, number>;
    if (!(martianType in byType) || byType[martianType]! < fitness) {
      byType[martianType] = fitness;
    }
    stats['top_fitness_by_type'] = byType;
    atomicWrite(path, stats);
  }
}

// ── InstallStore ────────────────────────────────────────────────────────────

interface StoredInstall {
  install_id:   string;
  api_key_hash: string;
  machine_hash: string;
  registered_at: string;
}

export class InstallStore {
  private readonly _root: string;

  constructor(root?: string) {
    this._root = root ?? dataRoot();
  }

  private _installPath(apiKeyHash: string): string {
    return join(this._root, 'installs', apiKeyHash.slice(0, 2), `${apiKeyHash}.json`);
  }

  register(apiKeyHash: string, machineHash: string): [string, boolean] {
    const path = this._installPath(apiKeyHash);
    if (existsSync(path)) {
      const stored = JSON.parse(readFileSync(path, 'utf8')) as StoredInstall;
      return [stored.install_id, false];
    }
    const installId = randomBytes(8).toString('hex');
    const data: StoredInstall = {
      install_id:    installId,
      api_key_hash:  apiKeyHash,
      machine_hash:  machineHash,
      registered_at: new Date().toISOString(),
    };
    atomicWrite(path, data as unknown as Record<string, unknown>);
    return [installId, true];
  }

  exists(apiKeyHash: string): boolean {
    return existsSync(this._installPath(apiKeyHash));
  }

  count(): number {
    const dir = join(this._root, 'installs');
    if (!existsSync(dir)) return 0;
    let count = 0;
    for (const sub of readdirSync(dir)) {
      const subDir = join(dir, sub);
      try { count += readdirSync(subDir).filter(f => f.endsWith('.json')).length; } catch { /* skip */ }
    }
    return count;
  }
}

// ── GlobalStats ─────────────────────────────────────────────────────────────

export interface RawStats {
  total_genomes:              number;
  total_installs:             number;
  total_fitness_evaluations:  number;
  top_fitness_by_type:        Record<string, number>;
}

export class GlobalStats {
  private readonly _root: string;

  constructor(root?: string) {
    this._root = root ?? dataRoot();
  }

  get(): RawStats {
    const path = join(this._root, 'stats', 'global.json');
    if (!existsSync(path)) {
      return { total_genomes: 0, total_installs: 0, total_fitness_evaluations: 0, top_fitness_by_type: {} };
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as RawStats;
    } catch {
      return { total_genomes: 0, total_installs: 0, total_fitness_evaluations: 0, top_fitness_by_type: {} };
    }
  }
}
