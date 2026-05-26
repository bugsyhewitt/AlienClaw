/**
 * MySQL-backed persistence for the AlienClaw community API.
 *
 * The API runs only on the server (api.alienclaw.net). The server has MySQL.
 * There is no flat-file fallback — if ALIENCLAW_DB_URL is missing or the
 * database is unreachable, the API fails fast at startup with a clear error.
 *
 * Connection: mysql.createPool(process.env.ALIENCLAW_DB_URL)
 * Schema: see migrations/001_leaderboard.sql
 */

import mysql from 'mysql2/promise';
import { randomBytes } from 'node:crypto';

// ── Connection pool ────────────────────────────────────────────────────────

let _pool: mysql.Pool | null = null;

export function initPool(dbUrl?: string): mysql.Pool {
  const url = dbUrl ?? process.env['ALIENCLAW_DB_URL'];
  if (!url) {
    throw new Error(
      'ALIENCLAW_DB_URL is not set. The AlienClaw API requires a MySQL database. ' +
      'Set ALIENCLAW_DB_URL=mysql://user:password@host/database and restart.'
    );
  }
  _pool = mysql.createPool(url);
  return _pool;
}

function pool(): mysql.Pool {
  if (!_pool) throw new Error('Database pool not initialized. Call initPool() at startup.');
  return _pool;
}

// ── Type definitions ───────────────────────────────────────────────────────

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

export interface RawStats {
  total_genomes:             number;
  total_installs:            number;
  total_fitness_evaluations: number;
  top_fitness_by_type:       Record<string, number>;
}

// ── SubmissionStore ────────────────────────────────────────────────────────

export class SubmissionStore {
  private readonly _given?: mysql.Pool;
  private get _pool(): mysql.Pool { return this._given ?? pool(); }

  constructor(p?: mysql.Pool) {
    this._given = p;
  }

  async save(opts: {
    genome:          string;
    martianType:     string;
    fitness:         number;
    apiKeyHash:      string;
    runMetadata:     Record<string, unknown>;
    leaderboardName: string;
  }): Promise<[string, string]> {
    const sid = `sub_${randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    await this._pool.execute(
      `INSERT INTO leaderboard_entries
         (submission_id, leaderboard_name, genome, martian_type, fitness,
          api_key_hash, submitted_at, run_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sid, opts.leaderboardName, opts.genome, opts.martianType, opts.fitness,
       opts.apiKeyHash, now, JSON.stringify(opts.runMetadata)]
    );
    return [sid, new Date().toISOString()];
  }

  async topForType(martianType: string, n = 10): Promise<StoredSubmission[]> {
    // LIMIT cannot be a prepared-statement parameter in MySQL 8.0 server-side mode.
    // n is a controlled integer (caller enforces max 100), safe to inline.
    const limit = Math.max(1, Math.floor(n));
    const [rows] = await this._pool.execute<mysql.RowDataPacket[]>(
      `SELECT submission_id, genome, martian_type, fitness, leaderboard_name,
              api_key_hash, run_metadata,
              DATE_FORMAT(submitted_at, '%Y-%m-%dT%TZ') AS submitted_at
       FROM leaderboard_entries
       WHERE martian_type = ?
       ORDER BY fitness DESC
       LIMIT ${limit}`,
      [martianType]
    );
    return rows.map(r => ({
      submission_id:    r['submission_id'] as string,
      genome:           r['genome'] as string,
      martian_type:     r['martian_type'] as string,
      fitness:          r['fitness'] as number,
      leaderboard_name: r['leaderboard_name'] as string,
      api_key_hash:     r['api_key_hash'] as string,
      run_metadata:     typeof r['run_metadata'] === 'string'
        ? JSON.parse(r['run_metadata']) as Record<string, unknown>
        : (r['run_metadata'] ?? {}) as Record<string, unknown>,
      submitted_at:     r['submitted_at'] as string,
    }));
  }

  async countForType(martianType: string): Promise<number> {
    const [rows] = await this._pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM leaderboard_entries WHERE martian_type = ?',
      [martianType]
    );
    return (rows[0]?.['cnt'] as number) ?? 0;
  }

  async rankForFitness(martianType: string, fitness: number): Promise<number> {
    const [rows] = await this._pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM leaderboard_entries WHERE martian_type = ? AND fitness > ?',
      [martianType, fitness]
    );
    return ((rows[0]?.['cnt'] as number) ?? 0) + 1;
  }

  async isNewTop(martianType: string, fitness: number): Promise<boolean> {
    const [rows] = await this._pool.execute<mysql.RowDataPacket[]>(
      'SELECT MAX(fitness) AS top FROM leaderboard_entries WHERE martian_type = ?',
      [martianType]
    );
    const top = rows[0]?.['top'];
    return top === null || top === undefined || fitness >= (top as number);
  }

  async findDuplicate(opts: {
    genome:      string;
    martianType: string;
    fitness:     number;
    apiKeyHash:  string;
  }): Promise<StoredSubmission | null> {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000)
      .toISOString().replace('T', ' ').replace('Z', '');
    const [rows] = await this._pool.execute<mysql.RowDataPacket[]>(
      `SELECT submission_id, genome, martian_type, fitness, leaderboard_name,
              api_key_hash, run_metadata,
              DATE_FORMAT(submitted_at, '%Y-%m-%dT%TZ') AS submitted_at
       FROM leaderboard_entries
       WHERE genome = ? AND martian_type = ? AND fitness = ?
         AND api_key_hash = ? AND submitted_at >= ?
       LIMIT 1`,
      [opts.genome, opts.martianType, opts.fitness, opts.apiKeyHash, cutoff]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      submission_id:    r['submission_id'] as string,
      genome:           r['genome'] as string,
      martian_type:     r['martian_type'] as string,
      fitness:          r['fitness'] as number,
      leaderboard_name: r['leaderboard_name'] as string,
      api_key_hash:     r['api_key_hash'] as string,
      run_metadata:     typeof r['run_metadata'] === 'string'
        ? JSON.parse(r['run_metadata']) as Record<string, unknown>
        : (r['run_metadata'] ?? {}) as Record<string, unknown>,
      submitted_at:     r['submitted_at'] as string,
    };
  }
}

// ── InstallStore ────────────────────────────────────────────────────────────

export class InstallStore {
  private readonly _given?: mysql.Pool;
  private get _pool(): mysql.Pool { return this._given ?? pool(); }

  constructor(p?: mysql.Pool) {
    this._given = p;
  }

  async register(apiKeyHash: string, machineHash: string): Promise<[string, boolean]> {
    // Check if already registered (UNIQUE constraint on api_key_hash)
    const [rows] = await this._pool.execute<mysql.RowDataPacket[]>(
      'SELECT install_id FROM installs WHERE api_key_hash = ? LIMIT 1',
      [apiKeyHash]
    );
    if (rows[0]) return [rows[0]['install_id'] as string, false];

    const installId = randomBytes(8).toString('hex');
    await this._pool.execute(
      `INSERT INTO installs (install_id, api_key_hash, machine_hash) VALUES (?, ?, ?)`,
      [installId, apiKeyHash, machineHash]
    );
    return [installId, true];
  }

  async exists(apiKeyHash: string): Promise<boolean> {
    const [rows] = await this._pool.execute<mysql.RowDataPacket[]>(
      'SELECT 1 FROM installs WHERE api_key_hash = ? LIMIT 1',
      [apiKeyHash]
    );
    return rows.length > 0;
  }

  async count(): Promise<number> {
    const [rows] = await this._pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM installs'
    );
    return (rows[0]?.['cnt'] as number) ?? 0;
  }
}

// ── GlobalStats ─────────────────────────────────────────────────────────────

export class GlobalStats {
  private readonly _given?: mysql.Pool;
  private get _pool(): mysql.Pool { return this._given ?? pool(); }

  constructor(p?: mysql.Pool) {
    this._given = p;
  }

  async get(): Promise<RawStats> {
    const [[genomeRows], [installRows], [topRows]] = await Promise.all([
      this._pool.execute<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS cnt FROM leaderboard_entries'
      ),
      this._pool.execute<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS cnt FROM installs'
      ),
      this._pool.execute<mysql.RowDataPacket[]>(
        'SELECT martian_type, MAX(fitness) AS top_fitness FROM leaderboard_entries GROUP BY martian_type'
      ),
    ]);

    const totalGenomes   = (genomeRows[0]?.['cnt']   as number) ?? 0;
    const totalInstalls  = (installRows[0]?.['cnt']  as number) ?? 0;
    const topByType: Record<string, number> = {};
    for (const row of topRows) {
      topByType[row['martian_type'] as string] = row['top_fitness'] as number;
    }

    return {
      total_genomes:             totalGenomes,
      total_installs:            totalInstalls,
      total_fitness_evaluations: totalGenomes,
      top_fitness_by_type:       topByType,
    };
  }
}
