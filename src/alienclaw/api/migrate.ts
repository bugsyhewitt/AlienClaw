/**
 * SQL migration runner for the AlienClaw community API.
 * Gated by ALIENCLAW_RUN_MIGRATIONS=1 — no-ops in production unless explicitly set.
 *
 * On startup (when enabled):
 *   1. Acquires a MySQL named lock so concurrent restarts serialize.
 *   2. Bootstraps the schema_migrations bookkeeping table if absent.
 *   3. Reads all *.sql files from `migrationsDir` in sorted filename order.
 *   4. Applies each pending (not yet recorded) migration inside the same connection.
 *   5. Records each applied migration in schema_migrations.
 *   6. Releases the lock unconditionally via `finally`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join }                      from 'node:path';
import type {
  Pool,
  PoolConnection,
  RowDataPacket,
} from 'mysql2/promise';

// ── Bootstrap DDL ─────────────────────────────────────────────────────────

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

// ── Internal helpers ───────────────────────────────────────────────────────

interface LockRow extends RowDataPacket {
  ok: number | null;
}

function log(msg: string): void {
  process.stderr.write(`[migrate] ${msg}\n`);
}

/**
 * Split a raw SQL file on semicolons and return non-empty statement strings.
 * This is intentionally simple — migrations should avoid stored procedures
 * that require DELIMITER rewriting.
 */
function splitStatements(sql: string): string[] {
  return sql.split(';').map(s => s.trim()).filter(Boolean);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Run pending SQL migrations from `migrationsDir` against `pool`.
 *
 * No-op unless ALIENCLAW_RUN_MIGRATIONS=1.
 * Thread-safe via MySQL's `GET_LOCK` — concurrent callers wait up to 30 s.
 *
 * @param pool          - mysql2/promise Pool (any pool size; one connection is borrowed).
 * @param migrationsDir - Absolute path to the directory containing *.sql files.
 */
export async function runMigrations(
  pool:           Pool,
  migrationsDir:  string,
): Promise<void> {
  if (process.env['ALIENCLAW_RUN_MIGRATIONS'] !== '1') return;

  const conn: PoolConnection = await pool.getConnection();
  try {
    // Acquire a named MySQL advisory lock (timeout: 30 s)
    const [[lockRow]] = await conn.query<LockRow[]>(
      "SELECT GET_LOCK('alienclaw_migrate', 30) AS ok",
    );

    if (!lockRow || lockRow.ok !== 1) {
      throw new Error(
        'Could not acquire migration lock after 30 s. Another migration may be running.',
      );
    }

    try {
      // Ensure the bookkeeping table exists
      await conn.query(BOOTSTRAP_SQL);

      // Fetch already-applied migration filenames
      const [appliedRows] = await conn.query<RowDataPacket[]>(
        'SELECT filename FROM schema_migrations',
      );
      const appliedSet = new Set<string>(
        appliedRows.map((r: RowDataPacket) => r['filename'] as string),
      );

      // Discover migration files in sorted order
      let files: string[];
      try {
        files = readdirSync(migrationsDir)
          .filter(f => f.endsWith('.sql'))
          .sort();
      } catch {
        log('No migrations directory found — skipping.');
        return;
      }

      let appliedCount = 0;
      for (const file of files) {
        if (appliedSet.has(file)) continue;

        const sql = readFileSync(join(migrationsDir, file), 'utf8');
        const statements = splitStatements(sql);

        for (const stmt of statements) {
          await conn.query(stmt);
        }

        await conn.query(
          'INSERT INTO schema_migrations (filename) VALUES (?)',
          [file],
        );
        log(`Applied ${file}`);
        appliedCount++;
      }

      if (appliedCount === 0) {
        log('All migrations already applied.');
      }
    } finally {
      // Always release the advisory lock, even if migration throws
      await conn.query("SELECT RELEASE_LOCK('alienclaw_migrate')");
    }
  } finally {
    // Always return the connection to the pool
    conn.release();
  }
}
