/**
 * RFC 6598 shared address space (CGNAT) 100.64.0.0/10.
 *
 * The TS source has blocked this range since before staging (in-tree
 * hardened-fetch.ts isBlockedIpv4). These tests pin it at every layer, and
 * pin the /10 boundaries exactly. AlienClaw PR #630 adds the same range to the
 * Python twin, which does not block it on main.
 *
 * 100.100.100.200 is Alibaba Cloud's instance-metadata address and sits
 * inside this range.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as dnsModule from 'node:dns/promises';
import { hardenedFetch, isBlockedHost, validateResolvedAddresses, type FetchPolicy } from '../src/index.js';

const POLICY: FetchPolicy = { timeoutMs: 5_000, maxBytes: 64 * 1024 };
const lookup = vi.mocked(dnsModule.lookup);

afterEach(() => {
  vi.restoreAllMocks();
  lookup.mockReset();
});

const INSIDE = ['100.64.0.0', '100.64.0.1', '100.64.0.255', '100.100.100.100', '100.100.100.200', '100.127.255.255'];
const OUTSIDE = ['100.63.255.255', '100.128.0.0', '100.0.0.1', '100.255.255.255'];

describe('CGNAT 100.64.0.0/10: isBlockedHost', () => {
  for (const ip of INSIDE) it(`blocks ${ip}`, () => expect(isBlockedHost(ip)).toBe(true));
  for (const ip of OUTSIDE) it(`does not block adjacent ${ip}`, () => expect(isBlockedHost(ip)).toBe(false));
});

describe('CGNAT: obfuscated forms after new URL() canonicalisation', () => {
  for (const url of ['http://1681915905/', 'http://0144.0100.0.1/', 'http://0x64400001/', 'http://100.64.1/']) {
    it(`blocks ${url}`, () => {
      const host = new URL(url).hostname;
      expect(host).toBe('100.64.0.1');
      expect(isBlockedHost(host)).toBe(true);
    });
  }
  it('blocks IPv4-mapped [::ffff:100.64.0.1] (canonical [::ffff:6440:1])', () => {
    const host = new URL('http://[::ffff:100.64.0.1]/').hostname;
    expect(host).toBe('[::ffff:6440:1]');
    expect(isBlockedHost(host)).toBe(true);
  });
  it('blocks IPv4-translated [::ffff:0:6440:1]', () => {
    expect(isBlockedHost('[::ffff:0:6440:1]')).toBe(true);
  });
});

describe('CGNAT: validateResolvedAddresses', () => {
  for (const ip of INSIDE) {
    it(`rejects resolved ${ip}`, () =>
      expect(() => validateResolvedAddresses([{ address: ip, family: 4 }])).toThrow('blocked range'));
  }
  for (const ip of OUTSIDE) {
    it(`accepts resolved ${ip}`, () =>
      expect(() => validateResolvedAddresses([{ address: ip, family: 4 }])).not.toThrow());
  }
  it('rejects resolved IPv6-mapped ::ffff:100.64.0.1', () =>
    expect(() => validateResolvedAddresses([{ address: '::ffff:100.64.0.1', family: 6 }])).toThrow('blocked range'));
});

describe('CGNAT: hardenedFetch', () => {
  it('rejects a literal CGNAT URL before DNS', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(hardenedFetch('http://100.100.100.200/latest/meta-data/', POLICY))
      .rejects.toThrow(/SSRF rejected.*is blocked/);
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a hostname that DNS resolves into CGNAT', async () => {
    lookup.mockResolvedValue([{ address: '100.64.12.34', family: 4 }] as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(hardenedFetch('https://cgnat.example/', POLICY)).rejects.toThrow(/blocked range/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a redirect hop into CGNAT', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: 'http://100.100.100.200/' } }));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow(/SSRF rejected.*is blocked/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
