/**
 * test/hardening.test.ts (staged copy of AlienClaw test/net/hardened-fetch-hardening.test.ts,
 * minus the AlienClaw-only LEADERBOARD_POLICY / leaderboardFetch block)
 *
 * Regression tests for three hardenedFetch findings from the 2026-11-26
 * salvage security review (docs/salvage/SANDBOX-SECURITY-REVIEW.md):
 *
 *   SR-05  FetchPolicy fields failed open: maxBytes NaN / undefined / "1kb"
 *          removed the size cap, and maxRedirects NaN gave unbounded hops.
 *   SR-07  The time budget did not cover the body read (slow-drip body).
 *   SR-12  NAT64 64:ff9b::/96 with an embedded blocked IPv4 was allowed
 *          (64:ff9b::7f00:1 = 127.0.0.1, 64:ff9b::a9fe:a9fe = IMDS).
 *
 * Network-free: DNS via vi.mock, the HTTP transport via vi.spyOn on the
 * internal `transport` seam (globalThis.fetch until connection pinning
 * replaced it). The one integration test forwards the request to the real
 * transport, pointed at a 127.0.0.1 listener that this file starts and closes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fc from 'fast-check';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as dnsModule from 'node:dns/promises';
import {
  MAX_REDIRECTS,
  hardenedFetch,
  isBlockedHost,
  validateResolvedAddresses,
  type FetchPolicy,
} from '../src/index.js';
import { pinnedRequest, transport } from '../src/pinned-request.js';

const lookup = vi.mocked(dnsModule.lookup);
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const POLICY: FetchPolicy = { timeoutMs: 5_000, maxBytes: 1024 };

beforeEach(() => {
  lookup.mockResolvedValue(PUBLIC as never);
  // Guard: no test may reach the real network, even on an unfixed build.
  // Tests that expect a fetch re-stub it (vi.spyOn reuses this spy).
  vi.spyOn(transport, 'request').mockImplementation(async () => {
    throw new Error('test: unexpected real fetch');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  lookup.mockReset();
});

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/** A 200 response whose body is `total` bytes, streamed in 64 KiB chunks. */
function bigBody(total: number): Response {
  let sent = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) { controller.close(); return; }
      const n = Math.min(64 * 1024, total - sent);
      controller.enqueue(new Uint8Array(n).fill(0x41));
      sent += n;
    },
  }), { status: 200 });
}

/**
 * A 200 response that drips one byte every `everyMs`, for at most `chunks`
 * chunks (so an unfixed implementation eventually finishes instead of
 * leaking a timer for the rest of the run). `firstDelayMs` delays the
 * headers, to show that time spent before the body counts too.
 */
async function dripResponse(everyMs: number, chunks: number, firstDelayMs = 0): Promise<Response> {
  if (firstDelayMs > 0) await new Promise((r) => setTimeout(r, firstDelayMs));
  let sent = 0;
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((r) => setTimeout(r, everyMs));
      if (sent >= chunks) { controller.close(); return; }
      controller.enqueue(new Uint8Array([0x78]));
      sent++;
    },
  }), { status: 200 });
}

/** How `p` has settled after `ms`: "resolved: ...", "rejected: ..." or "still pending". */
function outcomeWithin(p: Promise<unknown>, ms: number): Promise<string> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('still pending'), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(`resolved: ${String(v).slice(0, 40)}`); },
      (e: unknown) => { clearTimeout(t); resolve(`rejected: ${(e as Error).message}`); },
    );
  });
}

/** The error hardenedFetch rejects with for `policy`; fails the test if it resolves. */
async function rejection(policy: unknown, url = 'https://example.com/'): Promise<Error> {
  try {
    await hardenedFetch(url, policy as FetchPolicy);
  } catch (err) {
    return err as Error;
  }
  throw new Error('test: hardenedFetch accepted the policy');
}

// ---------------------------------------------------------------------------
// SR-05: policy validation
// ---------------------------------------------------------------------------

describe('SR-05: FetchPolicy is validated up front and fails closed', () => {
  const TEN_MIB = 10 * 1024 * 1024;
  const MAX_BYTES_CEILING = 256 * 1024 * 1024;

  const badMaxBytes: Array<[string, unknown]> = [
    ['NaN', NaN],
    ['undefined', undefined],
    ['a unit string "1kb"', '1kb'],
    ['a numeric string "1024"', '1024'],
    ['null', null],
    ['Infinity', Infinity],
    ['negative', -1],
    ['fractional', 1.5],
    ['above the 256 MiB ceiling', MAX_BYTES_CEILING + 1],
  ];
  for (const [label, value] of badMaxBytes) {
    it(`maxBytes ${label}: TypeError before DNS or fetch (10 MiB body never read)`, async () => {
      const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => bigBody(TEN_MIB));
      const err = await rejection({ ...POLICY, maxBytes: value });
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toMatch(/^Invalid FetchPolicy: maxBytes must be an integer from 0 to 268435456 /);
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  const badTimeouts: Array<[string, unknown]> = [
    ['NaN', NaN],
    ['undefined', undefined],
    ['a string "5000"', '5000'],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['2^31 (Node would clamp the timer to 1 ms, SR-11)', 2 ** 31],
  ];
  for (const [label, value] of badTimeouts) {
    it(`timeoutMs ${label}: TypeError before DNS or fetch`, async () => {
      const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok'));
      const err = await rejection({ ...POLICY, timeoutMs: value });
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toMatch(/^Invalid FetchPolicy: timeoutMs must be an integer from 1 to 2147483647 /);
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  const badRedirects: Array<[string, unknown]> = [
    ['NaN', NaN],
    ['null', null],
    ['a string "3"', '3'],
    ['Infinity', Infinity],
    ['negative', -1],
    ['fractional', 1.5],
    ['above the 20-hop ceiling', 21],
  ];
  for (const [label, value] of badRedirects) {
    it(`maxRedirects ${label}: TypeError, no hops followed`, async () => {
      const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => redirect('https://example.com/loop'));
      // A short budget so an unfixed build ends its NaN redirect loop quickly.
      const err = await rejection({ ...POLICY, timeoutMs: 200, maxRedirects: value });
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toMatch(/^Invalid FetchPolicy: maxRedirects must be an integer from 0 to 20 /);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  const badProtocols: Array<[string, unknown]> = [
    ['a bare string "https" (String#includes would accept "http")', 'https'],
    ['null', null],
    ['an array with a non-string', ['https', 1]],
    ['an object', { https: true }],
  ];
  for (const [label, value] of badProtocols) {
    it(`protocols ${label}: TypeError`, async () => {
      const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok'));
      const err = await rejection({ ...POLICY, protocols: value }, 'http://example.com/');
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toMatch(/^Invalid FetchPolicy: protocols must be an array of strings /);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  const badAllowedHosts: Array<[string, unknown]> = [
    ['null (would silently disable the allowlist)', null],
    ['false', false],
    ['an array', ['api.example.com']],
    ['a string', 'api.example.com'],
  ];
  for (const [label, value] of badAllowedHosts) {
    it(`allowedHosts ${label}: TypeError`, async () => {
      const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok'));
      const err = await rejection({ ...POLICY, allowedHosts: value }, 'https://other.example/');
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toMatch(/^Invalid FetchPolicy: allowedHosts must be a Set of hostnames /);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  for (const value of [null, undefined, 'policy', 42]) {
    it(`a non-object policy (${String(value)}) is a TypeError`, async () => {
      const err = await rejection(value);
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toMatch(/^Invalid FetchPolicy: /);
    });
  }

  it('the error names the bad value without echoing objects', async () => {
    expect((await rejection({ ...POLICY, maxBytes: '1kb' })).message).toContain('(got "1kb")');
    expect((await rejection({ ...POLICY, maxBytes: NaN })).message).toContain('(got NaN)');
    expect((await rejection({ ...POLICY, maxBytes: { big: true } })).message).toContain('(got object)');
  });

  // --- boundaries that must stay accepted ---------------------------------

  it('maxBytes 0 accepts an empty body; the 256 MiB ceiling itself is accepted', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response(''));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxBytes: 0 })).resolves.toBe('');
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxBytes: MAX_BYTES_CEILING })).resolves.toBe('');
  });

  it('timeoutMs 2147483647 (the largest timer Node honours) is accepted', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok'));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 2_147_483_647 })).resolves.toBe('ok');
  });

  it('maxRedirects 20 follows 20 hops; omitted or undefined defaults to MAX_REDIRECTS', async () => {
    const twenty = vi.spyOn(transport, 'request');
    for (let i = 0; i < 20; i++) twenty.mockResolvedValueOnce(redirect(`/hop${i}`));
    twenty.mockResolvedValueOnce(new Response('landed'));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxRedirects: 20 })).resolves.toBe('landed');
    expect(twenty).toHaveBeenCalledTimes(21);
    twenty.mockClear();

    for (const policy of [POLICY, { ...POLICY, maxRedirects: undefined }]) {
      const loop = vi.spyOn(transport, 'request').mockImplementation(async () => redirect('https://example.com/loop'));
      await expect(hardenedFetch('https://example.com/', policy))
        .rejects.toThrow(`Too many redirects (>${MAX_REDIRECTS})`);
      expect(loop).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
      loop.mockClear();
    }
  });

  it('explicitly undefined protocols / allowedHosts fall back to the defaults', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok'));
    await expect(hardenedFetch('http://example.com/', { ...POLICY, protocols: undefined, allowedHosts: undefined }))
      .resolves.toBe('ok');
    await expect(hardenedFetch('ftp://example.com/', { ...POLICY, protocols: undefined }))
      .rejects.toThrow(/Protocol rejected: ftp:/);
  });
});

// ---------------------------------------------------------------------------
// SR-07: one deadline covers DNS, connect, headers and the whole body read
// ---------------------------------------------------------------------------

describe('SR-07: the time budget covers the whole call, body read included', () => {
  it('a slow-drip body aborts at the policy timeout (stubbed stream)', async () => {
    vi.spyOn(transport, 'request').mockImplementation(() => dripResponse(40, 60));
    const started = Date.now();
    const result = await outcomeWithin(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 200 }), 1_500);
    expect(result).toBe('rejected: Fetch timeout: exceeded 200ms budget');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('time spent before the headers counts against the body read (one budget, not two)', async () => {
    // Headers at ~130 ms, then one byte every 40 ms: well past 200 ms in total.
    vi.spyOn(transport, 'request').mockImplementation(() => dripResponse(40, 5, 130));
    const result = await outcomeWithin(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 200 }), 1_500);
    expect(result).toBe('rejected: Fetch timeout: exceeded 200ms budget');
  });

  it('a DNS lookup that never answers aborts at the policy timeout', async () => {
    lookup.mockImplementation(() => new Promise(() => { /* never settles */ }) as never);
    const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response('reached'));
    const result = await outcomeWithin(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 200 }), 1_000);
    expect(result).toBe('rejected: Fetch timeout: exceeded 200ms budget');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a body that finishes inside the budget is still returned whole', async () => {
    vi.spyOn(transport, 'request').mockImplementation(() => dripResponse(5, 4));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 2_000 })).resolves.toBe('xxxx');
  });

  describe('the real node:http transport against a 127.0.0.1 slow-drip listener', () => {
    let server: http.Server | undefined;
    let clientClosed = false;
    const timers = new Set<NodeJS.Timeout>();

    afterEach(async () => {
      for (const t of timers) clearInterval(t);
      timers.clear();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((r) => server!.close(() => r()));
        server = undefined;
      }
    });

    it('aborts the socket at the policy timeout instead of reading forever', async () => {
      clientClosed = false;
      server = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.flushHeaders();
        const iv = setInterval(() => res.write('x'), 25);
        timers.add(iv);
        res.on('close', () => { clearInterval(iv); clientClosed = true; });
      });
      await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
      const { port } = server.address() as AddressInfo;
      const target = `http://127.0.0.1:${port}/drip`;

      // Validation sees a public DNS answer for drip.example; the request is
      // forwarded to the local listener through the real transport, with the
      // signal hardenedFetch passed, so abort propagation is real.
      vi.spyOn(transport, 'request').mockImplementation((_url, init) =>
        pinnedRequest(target, { signal: init.signal, addresses: [{ address: '127.0.0.1', family: 4 }] }));

      const started = Date.now();
      const result = await outcomeWithin(hardenedFetch('https://drip.example/', { ...POLICY, timeoutMs: 200 }), 2_000);
      expect(result).toBe('rejected: Fetch timeout: exceeded 200ms budget');
      expect(Date.now() - started).toBeLessThan(1_500);

      // The client hung up: the server sees the response stream close.
      for (let i = 0; i < 50 && !clientClosed; i++) await new Promise((r) => setTimeout(r, 20));
      expect(clientClosed).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// SR-12: NAT64
// ---------------------------------------------------------------------------

function nat64(v4: [number, number, number, number]): string {
  const hi = ((v4[0] << 8) | v4[1]).toString(16);
  const lo = ((v4[2] << 8) | v4[3]).toString(16);
  return `64:ff9b::${hi}:${lo}`;
}

describe('SR-12: NAT64 prefixes', () => {
  const BLOCKED_EMBEDDED: Array<[string, string]> = [
    ['64:ff9b::7f00:1', '127.0.0.1 loopback'],
    ['64:ff9b::a9fe:a9fe', '169.254.169.254 cloud metadata'],
    ['64:ff9b::a00:1', '10.0.0.1 RFC1918'],
    ['64:ff9b::ac10:1', '172.16.0.1 RFC1918'],
    ['64:ff9b::c0a8:101', '192.168.1.1 RFC1918'],
    ['64:ff9b::6464:64c8', '100.100.100.200 CGNAT / Alibaba metadata'],
    ['64:ff9b::', '0.0.0.0'],
    ['64:ff9b::e000:1', '224.0.0.1 multicast'],
    ['64:ff9b::ffff:ffff', '255.255.255.255 broadcast'],
  ];

  for (const [addr, why] of BLOCKED_EMBEDDED) {
    it(`blocks ${addr} (embeds ${why}) as a literal and as a DNS answer`, () => {
      expect(isBlockedHost(`[${addr}]`)).toBe(true);
      expect(isBlockedHost(addr)).toBe(true);
      expect(() => validateResolvedAddresses([{ address: addr, family: 6 }])).toThrow(/blocked range/);
    });
  }

  it('blocks the dotted and uncompressed spellings after URL canonicalisation, before DNS', async () => {
    const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response('reached'));
    for (const url of [
      'http://[64:ff9b::127.0.0.1]/',
      'http://[64:ff9b::169.254.169.254]/latest/meta-data/',
      'http://[0064:ff9b:0000:0000:0000:0000:0a00:0001]/',
    ]) {
      await expect(hardenedFetch(url, POLICY)).rejects.toThrow(/SSRF rejected: hostname .* is blocked/);
    }
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // DNS may hand back the dotted form too.
    expect(() => validateResolvedAddresses([{ address: '64:ff9b::169.254.169.254', family: 6 }])).toThrow(/blocked range/);
  });

  it('a DNS64 answer embedding a blocked IPv4 is rejected; a public one is fetched', async () => {
    const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response('via nat64'));
    lookup.mockResolvedValueOnce([{ address: '64:ff9b::a9fe:a9fe', family: 6 }] as never);
    await expect(hardenedFetch('https://imds.example/', POLICY)).rejects.toThrow(/blocked range/);
    expect(fetchSpy).not.toHaveBeenCalled();

    lookup.mockResolvedValueOnce([{ address: '64:ff9b::5db8:d822', family: 6 }] as never);  // 93.184.216.34
    await expect(hardenedFetch('https://v4only.example/', POLICY)).resolves.toBe('via nat64');
  });

  it('keeps DNS64-synthesised public addresses reachable (8.8.8.8, 1.1.1.1, 93.184.216.34)', () => {
    for (const addr of ['64:ff9b::808:808', '64:ff9b::101:101', '64:ff9b::5db8:d822', '64:ff9b::8.8.8.8']) {
      expect(isBlockedHost(`[${addr}]`)).toBe(false);
      expect(() => validateResolvedAddresses([{ address: addr, family: 6 }])).not.toThrow();
    }
  });

  it('blocks the whole RFC 8215 local-use prefix 64:ff9b:1::/48, public embedded IPv4 included', () => {
    for (const addr of ['64:ff9b:1::', '64:ff9b:1::808:808', '64:ff9b:1:a9fe:a9:fe00::', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff']) {
      expect(isBlockedHost(`[${addr}]`)).toBe(true);
      expect(() => validateResolvedAddresses([{ address: addr, family: 6 }])).toThrow(/blocked range/);
    }
  });

  it('boundary: addresses outside both NAT64 prefixes are not affected', () => {
    // 64:ff9b:2::/48 and the non-/96 rest of 64:ff9b::/32 are not NAT64 prefixes.
    expect(isBlockedHost('[64:ff9b:2::7f00:1]')).toBe(false);
    expect(isBlockedHost('[64:ff9b:0:0:1::7f00:1]')).toBe(false);
    expect(isBlockedHost('[65:ff9b::7f00:1]')).toBe(false);
  });

  it('property: a 64:ff9b::/96 address is blocked exactly when its embedded IPv4 is', () => {
    const octet = fc.integer({ min: 0, max: 255 });
    fc.assert(fc.property(fc.tuple(octet, octet, octet, octet), (v4) => {
      const dotted = v4.join('.');
      const expected = isBlockedHost(dotted);
      const addr = nat64(v4);
      expect(isBlockedHost(`[${addr}]`)).toBe(expected);
      expect(isBlockedHost(new URL(`http://[64:ff9b::${dotted}]/`).hostname)).toBe(expected);
      const threw = (() => {
        try { validateResolvedAddresses([{ address: addr, family: 6 }]); return false; } catch { return true; }
      })();
      expect(threw).toBe(expected);
    }), { numRuns: 2_000 });
  });
});
