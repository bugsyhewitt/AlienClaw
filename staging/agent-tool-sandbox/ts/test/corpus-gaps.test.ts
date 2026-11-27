/**
 * Gaps the shared SSRF vector corpus exposed (vectors/DIFFERENCES.md, 2026-11-26).
 *
 *   1. IPv6 transition and deprecated prefixes, blocked whole, as the Python
 *      package does (DIFFERENCES.md g6, g7, g11; SR-12). Since connection
 *      pinning stripped IPv6-literal brackets (SR-09), these literals really
 *      dial, so the gap became reachable:
 *        - 6to4 2002::/16 (RFC 3056, deprecated by RFC 7526)
 *        - Teredo 2001:0::/32 (RFC 4380): the client IPv4 is obfuscated and
 *          the server IPv4 is attacker-chosen, so no embedded-address check
 *          can be trusted
 *        - site-local fec0::/10 (deprecated by RFC 3879)
 *   2. Azure WireServer 168.63.129.16: a PUBLIC address that the Azure host
 *      fabric answers inside every VM (goal state, extension configuration).
 *      Blocked by name, in the IPv4 table, so its NAT64 embedding is caught too.
 *   3. Port 0: the pinned transport passed 0 to node:http, which treats it as
 *      "use the default" and dialled 80. Ports outside 1-65535 are refused.
 *
 * Declared divergences from the in-tree module: test/parity-in-tree.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as dnsModule from 'node:dns/promises';
import { hardenedFetch, isBlockedHost, validateResolvedAddresses, type FetchPolicy } from '../src/index.js';
import { transport } from '../src/pinned-request.js';

const POLICY: FetchPolicy = { timeoutMs: 5_000, maxBytes: 64 * 1024 };
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const lookup = vi.mocked(dnsModule.lookup);

beforeEach(() => {
  // Guard: no test may reach the real transport (and so the network).
  vi.spyOn(transport, 'request').mockImplementation(async () => {
    throw new Error('test: unexpected real request');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  lookup.mockReset();
});

const blockedV6 = (address: string): void => {
  expect(isBlockedHost(`[${address}]`), `[${address}]`).toBe(true);
  expect(isBlockedHost(address), address).toBe(true);
  expect(() => validateResolvedAddresses([{ address, family: 6 }]), address).toThrow(/blocked range/);
};
const allowedV6 = (address: string): void => {
  expect(isBlockedHost(`[${address}]`), `[${address}]`).toBe(false);
  expect(() => validateResolvedAddresses([{ address, family: 6 }]), address).not.toThrow();
};

describe('6to4 2002::/16 is blocked whole', () => {
  const INSIDE = [
    '2002::', '2002:7f00:1::1', '2002:a9fe:a9fe::', '2002:a9fe:a9fe::1', '2002:a00:1::1',
    '2002:808:808::1',  // public embedded IPv4: blocked too (whole /16, like Python)
    '2002:a83f:8110::1', '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2002:0:0:0:0:0:127.0.0.1',
  ];
  for (const a of INSIDE) it(`blocks ${a}`, () => blockedV6(a));
  for (const a of ['2003::1', '2001:4860:4860::8888']) it(`does not block ${a}`, () => allowedV6(a));
});

describe('Teredo 2001:0::/32 is blocked whole', () => {
  const INSIDE = [
    '2001::', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:0:4136:e378:8000:63bf:80ff:fffe',
    '2001:0:4136:e378:8000:63bf:5601:5601', '2001:0:ffff:ffff:ffff:ffff:ffff:ffff', '2001:0000:0:0:0:0:0:1',
  ];
  for (const a of INSIDE) it(`blocks ${a}`, () => blockedV6(a));
  // The next /32 up is IETF protocol-assignment space TS still allows (DIFFERENCES.md g8),
  // and 2001:200::/23 onwards is ordinary global unicast.
  for (const a of ['2001:200::1', '2001:4860:4860::8888']) it(`does not block ${a}`, () => allowedV6(a));
});

describe('site-local fec0::/10 is blocked whole', () => {
  const INSIDE = ['fec0::', 'fec0::1', 'FEC0::1', 'fed0::1', 'fee0:1::1', 'feff::1', 'feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'];
  for (const a of INSIDE) it(`blocks ${a}`, () => blockedV6(a));
  it('blocks fec0::1 with a zone ID', () => expect(isBlockedHost('[fec0::1%eth0]')).toBe(true));
});

describe('Azure WireServer 168.63.129.16', () => {
  it('isBlockedHost blocks it, and not its neighbours', () => {
    expect(isBlockedHost('168.63.129.16')).toBe(true);
    for (const ip of ['168.63.129.15', '168.63.129.17', '168.63.128.16', '168.62.129.16']) {
      expect(isBlockedHost(ip), ip).toBe(false);
    }
  });

  for (const url of ['http://2822734096/', 'http://0xa83f8110/', 'http://168.63.33040/', 'http://0250.077.0201.020/']) {
    it(`blocks ${url} after new URL() canonicalisation`, () => {
      const host = new URL(url).hostname;
      expect(host).toBe('168.63.129.16');
      expect(isBlockedHost(host)).toBe(true);
    });
  }

  it('validateResolvedAddresses rejects it in every embedding', () => {
    for (const [address, family] of [
      ['168.63.129.16', 4], ['::ffff:168.63.129.16', 6], ['64:ff9b::a83f:8110', 6],
      ['64:ff9b::168.63.129.16', 6], ['2002:a83f:8110::', 6],
    ] as const) {
      expect(() => validateResolvedAddresses([{ address, family }]), address).toThrow(/blocked range/);
    }
    expect(() => validateResolvedAddresses([{ address: '168.63.129.17', family: 4 }])).not.toThrow();
    expect(() => validateResolvedAddresses([{ address: '64:ff9b::a83f:8111', family: 6 }])).not.toThrow();
  });

  it('hardenedFetch rejects the literal before DNS', async () => {
    const fetchSpy = vi.spyOn(transport, 'request');
    await expect(hardenedFetch('http://168.63.129.16/machine?comp=goalstate', POLICY))
      .rejects.toThrow('SSRF rejected: hostname "168.63.129.16" is blocked');
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hardenedFetch rejects a name that resolves to it, and a redirect hop to it', async () => {
    lookup.mockResolvedValue([{ address: '168.63.129.16', family: 4 }] as never);
    const fetchSpy = vi.spyOn(transport, 'request');
    await expect(hardenedFetch('https://wireserver.example/', POLICY)).rejects.toThrow(/blocked range/);
    expect(fetchSpy).not.toHaveBeenCalled();

    lookup.mockResolvedValue(PUBLIC as never);
    fetchSpy.mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: 'http://168.63.129.16/machine?comp=goalstate' } }));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow(/SSRF rejected.*is blocked/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('IPv6 literals in these ranges never reach the transport', () => {
  for (const url of [
    'http://[2002:a9fe:a9fe::]/latest/meta-data/', 'http://[2002:7f00:1::1]/',
    'http://[2001:0:4136:e378:8000:63bf:80ff:fffe]/', 'http://[fec0::1]/',
  ]) {
    it(`rejects ${url} before DNS`, async () => {
      const fetchSpy = vi.spyOn(transport, 'request');
      await expect(hardenedFetch(url, POLICY)).rejects.toThrow(/SSRF rejected: hostname .* is blocked/);
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  for (const address of ['2002:a9fe:a9fe::1', '2001:0:4136:e378:8000:63bf:5601:5601', 'fec0::1']) {
    it(`rejects a DNS answer of ${address}`, async () => {
      lookup.mockResolvedValue([{ address, family: 6 }] as never);
      const fetchSpy = vi.spyOn(transport, 'request');
      await expect(hardenedFetch('https://v6.example/', POLICY)).rejects.toThrow(/blocked range/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }
});

describe('port 0 is refused (node:http would dial the default port)', () => {
  for (const url of [
    'http://example.com:0/', 'https://example.com:0/', 'http://example.com:00/', 'http://example.com:0000/x?y=1',
    'http://93.184.216.34:0/', 'http://[2606:4700:4700::1111]:0/',
  ]) {
    it(`rejects ${url} before DNS`, async () => {
      expect(new URL(url).port).toBe('0');
      lookup.mockResolvedValue(PUBLIC as never);
      const fetchSpy = vi.spyOn(transport, 'request');
      await expect(hardenedFetch(url, POLICY)).rejects.toThrow(/^Port rejected: 0 /);
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it('rejects a redirect hop to port 0', async () => {
    lookup.mockResolvedValue(PUBLIC as never);
    const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: 'http://example.com:0/next' } }));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow(/^Port rejected: 0 /);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a port above 65535 is still an invalid URL', async () => {
    await expect(hardenedFetch('http://example.com:65536/', POLICY)).rejects.toThrow(/^Invalid URL/);
  });

  for (const url of ['http://example.com:65535/', 'http://example.com:8080/', 'http://example.com:00080/', 'http://example.com:/']) {
    it(`still allows ${url}`, async () => {
      lookup.mockResolvedValue(PUBLIC as never);
      const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok'));
      await expect(hardenedFetch(url, POLICY)).resolves.toBe('ok');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  }
});
