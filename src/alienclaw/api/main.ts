/**
 * Entry point for the AlienClaw community API server.
 * Usage: tsx src/alienclaw/api/main.ts
 * Env vars: ALIENCLAW_API_DATA_ROOT, ALIENCLAW_API_PORT, ALIENCLAW_API_HOST
 */

import { configure, createApiServer } from './server.js';

const port = parseInt(process.env['PORT'] ?? process.env['ALIENCLAW_API_PORT'] ?? '8080', 10);
const host = process.env['ALIENCLAW_API_HOST'] ?? '0.0.0.0';
const root = process.env['ALIENCLAW_API_DATA_ROOT'];

configure({ dataRoot: root });
const server = await createApiServer(port, host);

process.stderr.write(`api.alienclaw.net listening on ${host}:${port}\n`);

process.on('SIGTERM', () => {
  server.close(() => {
    process.stderr.write('Graceful shutdown complete.\n');
    process.exit(0);
  });
});
