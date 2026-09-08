import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { poolStats } from '../storage.js';

// ── Build info ──────────────────────────────────────────────────────────────

interface BuildInfo { sha?: string; builtAt?: string; }

/**
 * Read build-info.json, trying:
 *   1. `pathOverride` when supplied (used in tests)
 *   2. The module-relative repo root (source-tree layout: 4 levels up from this file)
 *   3. process.cwd() (prod/dist layout: build-info.json sits next to the server bundle)
 *
 * Returns {} on any read/parse failure so callers fall back gracefully.
 */
export function readBuildInfo(pathOverride?: string): BuildInfo {
  const candidates: string[] = pathOverride
    ? [pathOverride]
    : [
        // Source layout: src/alienclaw/api/handlers/ → repo root
        join(fileURLToPath(new URL('.', import.meta.url)), '../../../../build-info.json'),
        // Prod/dist layout: process.cwd() is the deploy root
        join(process.cwd(), 'build-info.json'),
      ];

  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as BuildInfo;
    } catch { /* try next */ }
  }
  return {};
}

/**
 * Read the `version` field from package.json, trying:
 *   1. `pathOverride` when supplied (used in tests)
 *   2. The module-relative repo root (source layout)
 *   3. process.cwd()
 *
 * Returns 'unknown' on any read/parse failure.
 */
export function readVersion(pathOverride?: string): string {
  const candidates: string[] = pathOverride
    ? [pathOverride]
    : [
        join(fileURLToPath(new URL('.', import.meta.url)), '../../../../package.json'),
        join(process.cwd(), 'package.json'),
      ];

  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as { version?: unknown };
      if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
    } catch { /* try next */ }
  }
  return 'unknown';
}

const _START   = Date.now();
const _BUILD   = readBuildInfo();
const _VERSION = readVersion();

// ── Handler (T5) ─────────────────────────────────────────────────────────────

export async function handleHealth(pool?: mysql.Pool): Promise<[number, object]> {
  const stats = poolStats();

  let db: 'ok' | 'fail' = 'fail';
  if (pool) {
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2_000)),
      ]);
      db = 'ok';
    } catch { db = 'fail'; }
  }

  return [200, {
    ok:        db === 'ok',
    sha:       _BUILD.sha     ?? 'unknown',
    builtAt:   _BUILD.builtAt ?? 'unknown',
    node:      process.version,
    pid:       process.pid,
    uptimeSec: Math.floor((Date.now() - _START) / 1000),
    db,
    pool:      stats ?? {},
    version:   _VERSION,
  }];
}
