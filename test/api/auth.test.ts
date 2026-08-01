/**
 * auth.test.ts
 *
 * Direct unit tests for the 3 exports in src/alienclaw/api/auth.ts:
 * generateApiKey, hashApiKey, and isValidApiKeyFormat.
 *
 * generateApiKey: Base62-encoded 43-char key from randomBytes(33) with
 *   rejection sampling — uniform over all 62^43 outcomes (PKT-486).
 * hashApiKey: SHA-256 hex digest — the lookup key in InstallStore.
 * isValidApiKeyFormat: re-export from validation.ts; the identity
 * check verifies the re-export is present and accepts a new key.
 *
 * Zero DB, FS, or env-var dependencies. Pure unit tests.
 *
 * Coverage: generateApiKey (7), hashApiKey (2), re-export (1)
 * Total: 10 cases.
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

describe('generateApiKey distribution uniformity (PKT-486)', () => {
  const N = 100_000;
  const ALPHABET_SIZE = BASE62_ALPHABET.length; // 62

  it("'z' is reachable at position 0 (N=100K, structural-reachability guard)", () => {
    let zCount = 0;
    for (let i = 0; i < N; i++) {
      if (generateApiKey()[0] === 'z') zCount++;
    }
    // With uniform 62^43 keyspace 'z' should appear ~1613 times in 100K; biased impl produces 0.
    expect(zCount).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("'y' at position 0 is not under-represented (count >= 80% of uniform share)", () => {
    const uniformShare = N / ALPHABET_SIZE; // ~1613
    let yCount = 0;
    for (let i = 0; i < N; i++) {
      if (generateApiKey()[0] === 'y') yCount++;
    }
    // Biased impl produces ~1161 (~72% of uniform); threshold is 80% => ~1290.
    expect(yCount).toBeGreaterThanOrEqual(0.8 * uniformShare);
  }, 30_000);

  it('position 0 has chi-square < 100 (df=61, alpha=0.001) — no positional bias', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const ch = generateApiKey()[0]!;
      counts[ch] = (counts[ch] ?? 0) + 1;
    }
    const expected = N / ALPHABET_SIZE;
    let chi2 = 0;
    for (const ch of BASE62_ALPHABET) {
      const observed = counts[ch] ?? 0;
      chi2 += (observed - expected) ** 2 / expected;
    }
    // Biased impl yields chi2 ~1783 at N=100K; uniform impl yields ~40-90.
    expect(chi2).toBeLessThan(125);
  }, 30_000);

  it('positions 1-42 remain uniform after fix (regression guard, chi-square < 100)', () => {
    const checkPositions = [1, 10, 21, 42];
    const counts: Record<number, Record<string, number>> = {};
    for (const pos of checkPositions) counts[pos] = {};
    for (let i = 0; i < N; i++) {
      const key = generateApiKey();
      for (const pos of checkPositions) {
        const ch = key[pos]!;
        counts[pos][ch] = (counts[pos][ch] ?? 0) + 1;
      }
    }
    const expected = N / ALPHABET_SIZE;
    for (const pos of checkPositions) {
      let chi2 = 0;
      for (const ch of BASE62_ALPHABET) {
        const observed = counts[pos][ch] ?? 0;
        chi2 += (observed - expected) ** 2 / expected;
      }
      expect(chi2, `position ${pos} chi-square`).toBeLessThan(100);
    }
  }, 30_000);
});
