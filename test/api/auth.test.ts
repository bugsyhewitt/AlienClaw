/**
 * auth.test.ts
 *
 * Direct unit tests for the 3 exports in src/alienclaw/api/auth.ts:
 * generateApiKey, hashApiKey, and isValidApiKeyFormat.
 *
 * generateApiKey: Base62-encoded 43-char key from randomBytes(32).
 * hashApiKey: SHA-256 hex digest — the lookup key in InstallStore.
 * isValidApiKeyFormat: re-export from validation.ts; the identity
 * check verifies the re-export is present and accepts a new key.
 *
 * Zero DB, FS, or env-var dependencies. Pure unit tests.
 *
 * Coverage: generateApiKey (3), hashApiKey (2), re-export (1)
 * Total: 6 cases.
 *
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import {
  generateApiKey,
  hashApiKey,
  isValidApiKeyFormat,
} from '../../src/alienclaw/api/auth.js';
import { BASE62_ALPHABET } from '../../src/alienclaw/registry/genome-codec.js';

describe('generateApiKey', () => {
  it('returns a 43-character string', () => {
    const EXPECTED_LENGTH = 43;
    expect(generateApiKey()).toHaveLength(EXPECTED_LENGTH);
  });

  it('100 consecutive calls produce 100 unique values', () => {
    const SAMPLE_SIZE = 100;
    const keys = new Set<string>();
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      keys.add(generateApiKey());
    }
    expect(keys.size).toBe(SAMPLE_SIZE);
  });

  it('every character in 10 generated keys is in BASE62_ALPHABET', () => {
    const samples = Array.from({ length: 10 }, () => generateApiKey());
    for (const key of samples) {
      for (const ch of key) {
        expect(BASE62_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });
});

describe('hashApiKey', () => {
  it('hashApiKey("foo") matches Node SHA-256 digest', () => {
    const expected = createHash('sha256')
      .update('foo', 'utf8')
      .digest('hex');
    expect(hashApiKey('foo')).toBe(expected);
  });

  it('output is a 64-character lowercase hex string', () => {
    const hash = hashApiKey('bar');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isValidApiKeyFormat (re-export)', () => {
  it('is a function and accepts a freshly-generated key', () => {
    expect(typeof isValidApiKeyFormat).toBe('function');
    expect(isValidApiKeyFormat(generateApiKey())).toBe(true);
  });
});
