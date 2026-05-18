// Hostinger entry point — spawns tsx to run the TypeScript API.
import { spawn } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const child = spawn('./node_modules/.bin/tsx', ['src/alienclaw/api/main.ts'], {
  stdio: 'inherit',
  env: process.env,
  cwd: __dirname,
});

child.on('close', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT',  () => child.kill('SIGINT'));
