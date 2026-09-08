/**
 * Standalone migration CLI for the AlienClaw community API.
 *
 * Runs all pending SQL migrations from the repo's `migrations/` directory
 * against the database named in ALIENCLAW_DB_URL, then exits.
 *
 * Usage:
 *   ALIENCLAW_DB_URL=mysql://user:pass@host/db pnpm migrate
 *
 * This is safe to run multiple times — runMigrations is idempotent.
 * It also wires into the staging runbook for applying migrations 004+005
 * without having to restart the API server.
 */

import { fileURLToPath } from 'node:url';
import { initPool }      from './storage.js';
import { runMigrations } from './migrate.js';

// Force migrations to run — that is the entire purpose of this CLI.
// The server uses the same env gate; here we set it programmatically.
process.env['ALIENCLAW_RUN_MIGRATIONS'] = '1';

const dbUrl = process.env['ALIENCLAW_DB_URL'];
if (!dbUrl) {
  process.stderr.write(
    '[migrate-cli] ALIENCLAW_DB_URL is required\n' +
    '  Example: ALIENCLAW_DB_URL=mysql://user:pass@host:3306/db pnpm migrate\n',
  );
  process.exit(1);
}

const pool          = initPool(dbUrl);
const migrationsDir = fileURLToPath(new URL('../../../migrations', import.meta.url));

try {
  await runMigrations(pool, migrationsDir);
  process.stderr.write('[migrate-cli] done\n');
} catch (err) {
  process.stderr.write(`[migrate-cli] FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
} finally {
  await pool.end();
}
