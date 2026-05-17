/**
 * API key generation and verification.
 * TypeScript port of api/auth.py (Packet 31.5).
 */

import { createHash, randomBytes } from 'node:crypto';
import { BASE62_ALPHABET } from '../registry/genome-codec.js';
import { isValidApiKeyFormat } from './validation.js';

const _API_KEY_LENGTH = 43;

export { isValidApiKeyFormat };

export function generateApiKey(): string {
  const raw = randomBytes(32);
  let n = BigInt('0x' + raw.toString('hex'));
  const base = BigInt(62);
  const chars: string[] = [];
  while (n > 0n) {
    chars.push(BASE62_ALPHABET[Number(n % base)]!);
    n /= base;
  }
  // Reverse and pad to 43 chars
  const result = chars.reverse().join('');
  return result.padStart(_API_KEY_LENGTH, '0').slice(0, _API_KEY_LENGTH);
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}
