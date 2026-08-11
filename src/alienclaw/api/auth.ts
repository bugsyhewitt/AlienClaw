/**
 * API key generation and verification.
 * TypeScript port of api/auth.py (Packet 31.5).
 */

import { createHash, randomBytes } from 'node:crypto';
import { BASE62_ALPHABET } from '../registry/genome-codec.js';
import { isValidApiKeyFormat } from './validation.js';

const _API_KEY_LENGTH = 43;
// 62^43 ≈ 2^256.03 > 2^256, so we must use 264-bit (33-byte) draws.
// _ACCEPT_MAX = floor(2^264 / 62^43) * 62^43 = 250 * 62^43.
// Rejection rate: (2^264 - 250*62^43) / 2^264 ≈ 0.26%.
const _BASE62_43 = 62n ** 43n;
const _ACCEPT_MAX = (2n ** 264n / _BASE62_43) * _BASE62_43;

export { isValidApiKeyFormat };

export function generateApiKey(): string {
  while (true) {
    const raw = randomBytes(33); // 264 bits; 62^43 > 2^256 requires > 256 bits
    const n = BigInt('0x' + raw.toString('hex'));
    if (n >= _ACCEPT_MAX) continue;
    const key_n = n % _BASE62_43;
    const base = 62n;
    const chars: string[] = [];
    let x = key_n;
    while (x > 0n) {
      chars.push(BASE62_ALPHABET[Number(x % base)]!);
      x /= base;
    }
    return chars.reverse().join('').padStart(_API_KEY_LENGTH, '0').slice(0, _API_KEY_LENGTH);
  }
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}
