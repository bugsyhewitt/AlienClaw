import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { poolStats } from '../storage.js';

// ── Build info ──────────────────────────────────────────────────────────────

interface BuildInfo { sha?: string; builtAt?: string; }

function readBuildInfo(): BuildInfo {
  try {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const p   = join(dir, '../../../../build-info.json');
    return JSON.parse(readFileSync(p, 'utf8')) as BuildInfo;
  } catch { return {}; }
}

const _START = Date.now();
const _BUILD = readBuildInfo();

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
    version:   '1.0.0',
  }];
}
