/**
 * Entry point for the AlienClaw community API server.
 * Usage: tsx src/alienclaw/api/main.ts
 * Env vars: ALIENCLAW_API_PORT, ALIENCLAW_API_HOST, ALIENCLAW_DB_URL
 */

import type { Server } from 'node:http';
import { configure, createApiServer } from './server.js';

// ── Global crash handlers (T1) ─────────────────────────────────────────────
// Log structured JSON, attempt graceful shutdown, exit only if ALIENCLAW_EXIT_ON_FATAL=1.
// Default: log + keep serving (Hostinger restart policy is undocumented).

let _server: Server | null = null;

process.on('unhandledRejection', (reason) => {
  process.stderr.write(JSON.stringify({
    level:   'fatal',
    event:   'unhandledRejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack:   reason instanceof Error ? reason.stack   : undefined,
    ts:      new Date().toISOString(),
  }) + '\n');
  if (process.env['ALIENCLAW_EXIT_ON_FATAL'] === '1') {
    (_server ?? { close: (cb?: () => void) => cb?.() }).close(() => process.exit(1));
  }
});

process.on('uncaughtException', (err) => {
  process.stderr.write(JSON.stringify({
    level:   'fatal',
    event:   'uncaughtException',
    message: err.message,
    stack:   err.stack,
    ts:      new Date().toISOString(),
  }) + '\n');
  if (process.env['ALIENCLAW_EXIT_ON_FATAL'] === '1') {
    (_server ?? { close: (cb?: () => void) => cb?.() }).close(() => process.exit(1));
  }
});

const port = parseInt(process.env['PORT'] ?? process.env['ALIENCLAW_API_PORT'] ?? '8080', 10);
const host = process.env['ALIENCLAW_API_HOST'] ?? '0.0.0.0';

configure();
const server = await createApiServer(port, host);
_server = server;

process.stderr.write(`api.alienclaw.net listening on ${host}:${port}\n`);

process.on('SIGTERM', () => {
  server.close(() => {
    process.stderr.write('Graceful shutdown complete.\n');
    process.exit(0);
  });
});
