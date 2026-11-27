/**
 * Ported from the hardened-fetch section of AlienClaw
 * test/jail-hostile-genomes.test.ts ("T8: SSRF through network brains").
 *
 * The two in-tree `expect(true).toBe(true)` construction notes (web_search stub,
 * oversized body) are not ported: web_search is AlienClaw-specific, and the
 * size cap has a real stubbed test in ssrf-vectors.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { isBlockedHost, validateResolvedAddresses } from '../src/index.js';

describe('Jail: SSRF through network tools', () => {
  it('http_get to 169.254.169.254 is blocked by isBlockedHost', () => {
    expect(isBlockedHost('169.254.169.254')).toBe(true);
  });

  it('url_fetch to 10.0.0.1 is blocked by isBlockedHost', () => {
    expect(isBlockedHost('10.0.0.1')).toBe(true);
  });

  it('DNS resolving to private IP is blocked by validateResolvedAddresses', () => {
    expect(() => validateResolvedAddresses([{ address: '192.168.1.100', family: 4 }]))
      .toThrow(/blocked range/);
  });
});
