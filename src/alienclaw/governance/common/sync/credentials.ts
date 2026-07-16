/**
 * credentials.ts
 * Operator credentials for the network API, per
 * docs/specs/LEADERBOARD_API_SPEC.md §Authentication:
 *
 *   - api key: self-generated 43-char Base62, persisted at
 *     ~/.alienclaw/api-key.txt (mode 0600) and reused thereafter.
 *   - machine hash: sha256 of /etc/machine-id when readable, else of a
 *     UUID persisted at ~/.alienclaw/machine-id.
 *
 * POST /v1/install is unauthenticated and idempotent server-side, so
 * callers can register on every submit without special-casing first use.
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateApiKey } from '../../../api/auth.js';

/** Late-bound (unlike constants.ALIENCLAW_HOME) so tests can retarget via env. */
function defaultHome(): string {
  return process.env['ALIENCLAW_HOME'] ?? join(homedir(), '.alienclaw');
}

/** Read the persisted api key, or mint one (0600) on first use. */
export function ensureApiKey(home: string = defaultHome()): string {
  const keyPath = join(home, 'api-key.txt');
  try {
    const key = readFileSync(keyPath, 'utf-8').trim();
    if (key.length > 0) return key;
  } catch {
    // First use — mint below.
  }
  const key = generateApiKey();
  mkdirSync(home, { recursive: true });
  writeFileSync(keyPath, key + '\n', { encoding: 'utf-8', mode: 0o600 });
  chmodSync(keyPath, 0o600); // mode option is ignored for pre-existing files
  return key;
}

/** Stable machine hash: sha256 of /etc/machine-id, else of a persisted UUID. */
export function machineHash(home: string = defaultHome()): string {
  let source: string;
  try {
    source = readFileSync('/etc/machine-id', 'utf-8').trim();
  } catch {
    source = '';
  }
  if (!source) {
    const idPath = join(home, 'machine-id');
    try {
      source = readFileSync(idPath, 'utf-8').trim();
    } catch {
      source = '';
    }
    if (!source) {
      source = randomUUID();
      mkdirSync(home, { recursive: true });
      writeFileSync(idPath, source + '\n', 'utf-8');
    }
  }
  return createHash('sha256').update(source).digest('hex');
}
