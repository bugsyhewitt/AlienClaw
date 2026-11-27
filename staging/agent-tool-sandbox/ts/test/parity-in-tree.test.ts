/**
 * Parity: the staged module must make the same decisions as the in-tree
 * AlienClaw module it was copied from (src/alienclaw/net/hardened-fetch.ts).
 *
 * The only allowed decision differences are DECLARED_DIVERGENCES, asserted
 * explicitly below. Block-list divergences are currently NONE: CGNAT
 * 100.64.0.0/10 was already blocked in-tree, so nothing was added, and the
 * 2026-11-26 fixes (policy validation, whole-call deadline, NAT64) were made
 * in both modules. The corpus below covers the NAT64 prefixes and the
 * end-to-end scenarios cover invalid policies and a never-ending body.
 *
 * The export surface differs by design: the in-tree module also exports the
 * AlienClaw-specific LEADERBOARD_POLICY and leaderboardFetch.
 *
 * This file is coupled to the AlienClaw tree by a relative import. Delete it
 * (or point it at a pinned copy) when the package leaves the repo.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as dnsModule from 'node:dns/promises';
import * as staged from '../src/hardened-fetch.js';
import * as stagedIndex from '../src/index.js';
import * as inTree from '../../../../src/alienclaw/net/hardened-fetch.js';
import { transport } from '../src/pinned-request.js';

type Decision = { input: string; staged: string; inTree: string };

/** Decision differences we accept on purpose. Empty: none today. */
const DECLARED_DIVERGENCES: readonly Decision[] = [];

const lookup = vi.mocked(dnsModule.lookup);

afterEach(() => {
  vi.restoreAllMocks();
  lookup.mockReset();
});

function outcome(fn: () => unknown): string {
  try {
    return `ok:${JSON.stringify(fn())}`;
  } catch (err) {
    return `throw:${(err as Error).message}`;
  }
}

async function asyncOutcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    return `ok:${JSON.stringify(await fn())}`;
  } catch (err) {
    return `throw:${(err as Error).message}`;
  }
}

// ---------------------------------------------------------------------------
// Shared corpus
// ---------------------------------------------------------------------------

const IPV4 = [
  '0.0.0.0', '0.0.0.1', '0.255.255.255', '1.0.0.0', '10.0.0.1', '10.255.255.255', '11.0.0.0',
  '127.0.0.1', '127.255.255.255', '128.0.0.0', '169.254.0.0', '169.254.169.254', '169.253.255.255',
  '169.255.0.0', '172.15.255.255', '172.16.0.0', '172.31.255.255', '172.32.0.0', '192.0.0.0',
  '192.0.0.9', '192.0.0.170', '192.0.0.255', '192.0.1.0', '192.0.2.1', '192.167.255.255',
  '192.168.0.1', '192.169.0.0', '100.63.255.255', '100.64.0.0', '100.100.100.200', '100.127.255.255',
  '100.128.0.0', '198.17.255.255', '198.18.0.0', '198.19.255.255', '198.20.0.0', '198.51.100.1',
  '203.0.113.1', '223.255.255.255', '224.0.0.0', '239.255.255.255', '240.0.0.0', '255.255.255.255',
  '1.1.1.1', '8.8.8.8', '93.184.216.34',
];

const IPV6 = [
  '::', '::1', '::2', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:0:7f00:1', '::ffff:0:127.0.0.1',
  '::ffff:8.8.8.8', '::ffff:a9fe:a9fe', '::ffff:6440:1', '::127.0.0.1', '::7f00:1', '::8.8.8.8',
  '0:0:0:0:0:ffff:a9fe:a9fe', '::ffff:0:0', '::1:ffff:0:0', '::ffff:1:0', 'fe80::1', 'FE80::1',
  'fe80::1%eth0', 'febf:ffff::1', 'fec0::1', 'fc00::1', 'fd00:ec2::254', 'fdff::1', 'fbff::1',
  'ff00::', 'ff02::1', '64:ff9b::a9fe:a9fe', '64:ff9b::a00:1', '2002:a9fe:a9fe::', '2001::1',
  // NAT64: 64:ff9b::/96 (blocked iff the embedded IPv4 is) and 64:ff9b:1::/48 (all blocked)
  '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::169.254.169.254', '64:ff9b::ac10:1',
  '64:ff9b::c0a8:101', '64:ff9b::6464:64c8', '64:ff9b::', '64:ff9b::e000:1', '64:ff9b::ffff:ffff',
  '64:ff9b::808:808', '64:ff9b::8.8.8.8', '64:ff9b::5db8:d822', '0064:ff9b:0000:0000:0000:0000:0a00:0001',
  '64:ff9b:1::', '64:ff9b:1::808:808', '64:ff9b:1:a9fe:a9:fe00::', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff',
  '64:ff9b:2::7f00:1', '64:ff9b:0:0:1::7f00:1', '65:ff9b::7f00:1',
  '2001:db8::1', '2001:4860:4860::8888', '2606:4700:4700::1111', '1:2:3:4:5:6:7:8',
  // malformed: every one of these must fail closed identically
  '1:2:3:4:5:6:7:8:9', '::1:::', ':::', '::g', '1::2::3', '::ffff:1.2.3', '::ffff:256.0.0.1',
  '12345::', '1:2:3:4:5:6:7', '',
];

const RAW_HOSTNAMES = [
  '', 'localhost', 'LOCALHOST', 'localhost.', 'foo.localhost', 'ip6-localhost', 'ip6-loopback',
  'IP6-LOOPBACK', 'example.com', 'example.com.', 'xn--nxasmq6b', '169.254.169.254.nip.io',
  // raw obfuscated IPv4 (NOT canonicalised: both must return the same answer)
  '0177.0.0.1', '2130706433', '0x7f000001', '127.1', '127.0.0.1.', '0x7f.0.0.1', '256.0.0.1',
  '1.2.3', '01.02.03.04', '127.000.000.001', '1.2.3.4.5',
  // bracket oddities
  '[::1', '::1]', '[::])', '[]', '[[::1]]',
  ...IPV4,
  ...IPV6.map((a) => `[${a}]`),
  ...IPV6,
];

const URLS = [
  'http://0177.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0x7f.1/', 'http://127.1/',
  'http://127.0.0.1./', 'http://0/', 'http://017700000001/', 'http://0x7f.0x0.0x0.0x1/',
  'http://1681915905/', 'http://0144.0100.0.1/', 'http://0x64400001/', 'http://100.64.1/',
  'http://１２７.０.０.１/', 'http://ⓛocalhost/', 'http://LOCALHOST./',
  'http://user:pass@127.0.0.1/', 'http://evil.com@169.254.169.254/', 'http://169.254.169.254#@evil.com/',
  'http://[::ffff:127.0.0.1]/', 'http://[::ffff:0:127.0.0.1]/', 'http://[::127.0.0.1]/',
  'http://[0:0:0:0:0:ffff:7f00:1]/', 'http://[::ffff:100.64.0.1]/', 'http://[FE80::1]/',
  'http://[64:ff9b::169.254.169.254]/', 'http://[64:ff9b::127.0.0.1]/', 'http://[64:ff9b:1::10.0.0.1]/',
  'http://[64:ff9b::8.8.8.8]/', 'http://bücher.example/', 'http://xn--bcher-kva.example/',
  'https://api.example.com:8443/path?q=1',
];

const CANONICAL_HOSTNAMES = URLS.map((u) => new URL(u).hostname);
const HOSTNAME_CORPUS = [...new Set([...RAW_HOSTNAMES, ...CANONICAL_HOSTNAMES])];

type Addr = { address: string; family: number };
const RESOLVED_CORPUS: Addr[][] = [
  ...IPV4.map((address) => [{ address, family: 4 }]),
  ...IPV6.map((address) => [{ address, family: 6 }]),
  // family/address mismatches and unknown families
  [{ address: '127.0.0.1', family: 6 }],
  [{ address: '::1', family: 4 }],
  [{ address: '1.1.1.1', family: 0 }],
  [{ address: '1.1.1.1', family: 46 }],
  [{ address: '', family: 4 }],
  [{ address: 'not-an-ip', family: 4 }],
  [{ address: '0177.0.0.1', family: 4 }],
  // multi-answer sets: one bad address poisons the set
  [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }],
  [{ address: '10.0.0.1', family: 4 }, { address: '93.184.216.34', family: 4 }],
  [{ address: '93.184.216.34', family: 4 }, { address: '2001:4860:4860::8888', family: 6 }],
  [{ address: '93.184.216.34', family: 4 }, { address: 'fe80::1', family: 6 }],
  [{ address: '93.184.216.34', family: 4 }, { address: '1.1.1.1', family: 7 }],
  [],
];

function hostnameDiffs(inputs: string[]): Decision[] {
  const diffs: Decision[] = [];
  for (const h of inputs) {
    const s = outcome(() => staged.isBlockedHost(h));
    const t = outcome(() => inTree.isBlockedHost(h));
    if (s !== t) diffs.push({ input: `isBlockedHost(${JSON.stringify(h)})`, staged: s, inTree: t });
  }
  return diffs;
}

function resolvedDiffs(inputs: Addr[][]): Decision[] {
  const diffs: Decision[] = [];
  for (const set of inputs) {
    const s = outcome(() => staged.validateResolvedAddresses(set));
    const t = outcome(() => inTree.validateResolvedAddresses(set));
    if (s !== t) diffs.push({ input: `validateResolvedAddresses(${JSON.stringify(set)})`, staged: s, inTree: t });
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parity: export surface', () => {
  it('staged exports are a subset of in-tree exports; only the leaderboard helpers are dropped', () => {
    const stagedKeys = Object.keys(staged).sort();
    const inTreeKeys = Object.keys(inTree).sort();
    expect(stagedKeys.every((k) => inTreeKeys.includes(k))).toBe(true);
    expect(inTreeKeys.filter((k) => !stagedKeys.includes(k))).toEqual(['LEADERBOARD_POLICY', 'leaderboardFetch']);
    expect(Object.keys(stagedIndex).sort()).toEqual(stagedKeys);
  });

  it('constants are identical', () => {
    expect([...staged.DEFAULT_PROTOCOLS]).toEqual([...inTree.DEFAULT_PROTOCOLS]);
    expect(staged.MAX_REDIRECTS).toBe(inTree.MAX_REDIRECTS);
  });
});

describe('parity: deterministic corpus', () => {
  it('corpus is non-trivial and exercises both outcomes', () => {
    expect(HOSTNAME_CORPUS.length).toBeGreaterThan(150);
    const decisions = HOSTNAME_CORPUS.map((h) => staged.isBlockedHost(h));
    expect(decisions).toContain(true);
    expect(decisions).toContain(false);
  });

  it('URL canonicalisation produced the forms we expect to test', () => {
    expect(CANONICAL_HOSTNAMES).toContain('127.0.0.1');
    expect(CANONICAL_HOSTNAMES).toContain('100.64.0.1');
    expect(CANONICAL_HOSTNAMES).toContain('[::ffff:7f00:1]');
    expect(CANONICAL_HOSTNAMES).toContain('[64:ff9b::a9fe:a9fe]');
    expect(CANONICAL_HOSTNAMES).toContain('[64:ff9b::7f00:1]');
    expect(CANONICAL_HOSTNAMES).toContain('[64:ff9b:1::a00:1]');
    expect(CANONICAL_HOSTNAMES).toContain('xn--bcher-kva.example');
    expect(CANONICAL_HOSTNAMES).toContain('localhost');
  });

  it('isBlockedHost decisions match, except DECLARED_DIVERGENCES', () => {
    const declared = DECLARED_DIVERGENCES.filter((d) => d.input.startsWith('isBlockedHost('));
    expect(hostnameDiffs(HOSTNAME_CORPUS)).toEqual(declared);
  });

  it('validateResolvedAddresses outcomes (including error messages) match, except DECLARED_DIVERGENCES', () => {
    const declared = DECLARED_DIVERGENCES.filter((d) => d.input.startsWith('validateResolvedAddresses('));
    expect(resolvedDiffs(RESOLVED_CORPUS)).toEqual(declared);
  });

  it('the declared divergence set is empty (staged and in-tree block the same addresses)', () => {
    expect(DECLARED_DIVERGENCES).toEqual([]);
  });
});

describe('parity: property-based', () => {
  const hextet = fc.oneof(
    fc.constantFrom(0, 1, 0xffff, 0x64, 0xff9b, 0x2002, 0xfe80, 0xfebf, 0xfec0, 0xfc00, 0xfdff, 0xff00),
    fc.integer({ min: 0, max: 0xffff }),
  );

  it('every IPv4 address (as dotted quad) gets the same decision', () => {
    const octet = fc.integer({ min: 0, max: 255 });
    fc.assert(fc.property(fc.tuple(octet, octet, octet, octet), (octets) => {
      const ip = octets.join('.');
      expect(staged.isBlockedHost(ip)).toBe(inTree.isBlockedHost(ip));
      expect(outcome(() => staged.validateResolvedAddresses([{ address: ip, family: 4 }])))
        .toBe(outcome(() => inTree.validateResolvedAddresses([{ address: ip, family: 4 }])));
    }), { numRuns: 3000 });
  });

  it('random IPv6 (full and URL-canonical forms) gets the same decision', () => {
    fc.assert(fc.property(fc.array(hextet, { minLength: 8, maxLength: 8 }), (groups) => {
      const full = groups.map((g) => g.toString(16)).join(':');
      const canonical = new URL(`http://[${full}]/`).hostname;
      for (const h of [full, `[${full}]`, canonical]) {
        expect(staged.isBlockedHost(h)).toBe(inTree.isBlockedHost(h));
      }
      const bare = canonical.slice(1, -1);
      expect(outcome(() => staged.validateResolvedAddresses([{ address: bare, family: 6 }])))
        .toBe(outcome(() => inTree.validateResolvedAddresses([{ address: bare, family: 6 }])));
    }), { numRuns: 3000 });
  });

  it('NAT64 addresses with a random embedded IPv4 get the same decision', () => {
    const octet = fc.integer({ min: 0, max: 255 });
    fc.assert(fc.property(fc.tuple(octet, octet, octet, octet), fc.constantFrom('64:ff9b::', '64:ff9b:1::'), (v4, prefix) => {
      const hi = ((v4[0] << 8) | v4[1]).toString(16);
      const lo = ((v4[2] << 8) | v4[3]).toString(16);
      for (const addr of [`${prefix}${hi}:${lo}`, `${prefix}${v4.join('.')}`]) {
        expect(staged.isBlockedHost(`[${addr}]`)).toBe(inTree.isBlockedHost(`[${addr}]`));
        expect(outcome(() => staged.validateResolvedAddresses([{ address: addr, family: 6 }])))
          .toBe(outcome(() => inTree.validateResolvedAddresses([{ address: addr, family: 6 }])));
      }
    }), { numRuns: 2000 });
  });

  it('arbitrary strings get the same isBlockedHost decision', () => {
    fc.assert(fc.property(fc.string({ maxLength: 48 }), (s) => {
      expect(staged.isBlockedHost(s)).toBe(inTree.isBlockedHost(s));
    }), { numRuns: 3000 });
  });
});

// The staged module sends its requests through the internal pinned
// `transport` (connection pinning, staged only); the in-tree module still
// calls the global fetch. Each run stubs its own module's seam with the same
// response queue, so the comparison covers every decision but the socket.
describe('parity: hardenedFetch end-to-end (stubbed DNS + fetch / transport)', () => {
  type Scenario = {
    name: string;
    url: string;
    policy: staged.FetchPolicy;
    dns: Addr[];
    responses: () => Response[];
  };
  const PUBLIC: Addr[] = [{ address: '93.184.216.34', family: 4 }];
  const base: staged.FetchPolicy = { timeoutMs: 5_000, maxBytes: 64 };
  const scenarios: Scenario[] = [
    { name: 'success', url: 'https://example.com/', policy: base, dns: PUBLIC, responses: () => [new Response('ok')] },
    { name: 'protocol', url: 'ftp://example.com/', policy: base, dns: PUBLIC, responses: () => [] },
    { name: 'literal block', url: 'http://0x7f.1/', policy: base, dns: PUBLIC, responses: () => [] },
    { name: 'cgnat literal', url: 'http://100.100.100.200/', policy: base, dns: PUBLIC, responses: () => [] },
    { name: 'dns private', url: 'https://example.com/', policy: base, dns: [{ address: '::ffff:0:a00:1', family: 6 }], responses: () => [] },
    { name: 'dns empty', url: 'https://example.com/', policy: base, dns: [], responses: () => [] },
    { name: 'allowlist miss', url: 'https://example.com/', policy: { ...base, allowedHosts: new Set(['a.example']) }, dns: PUBLIC, responses: () => [] },
    {
      name: 'redirect to metadata', url: 'https://example.com/', policy: base, dns: PUBLIC,
      responses: () => [new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })],
    },
    {
      name: 'relative redirect then ok', url: 'https://example.com/a', policy: base, dns: PUBLIC,
      responses: () => [new Response(null, { status: 307, headers: { location: '../b' } }), new Response('b')],
    },
    {
      name: 'redirect cap', url: 'https://example.com/', policy: { ...base, maxRedirects: 1 }, dns: PUBLIC,
      responses: () => [0, 1, 2].map(() => new Response(null, { status: 302, headers: { location: '/x' } })),
    },
    { name: 'size cap', url: 'https://example.com/', policy: base, dns: PUBLIC, responses: () => [new Response('x'.repeat(65))] },
    { name: 'http error', url: 'https://example.com/', policy: base, dns: PUBLIC, responses: () => [new Response('no', { status: 403 })] },
    { name: 'nat64 literal', url: 'http://[64:ff9b::7f00:1]/', policy: base, dns: PUBLIC, responses: () => [] },
    { name: 'dns64 metadata', url: 'https://example.com/', policy: base, dns: [{ address: '64:ff9b::a9fe:a9fe', family: 6 }], responses: () => [] },
    { name: 'dns64 public', url: 'https://example.com/', policy: base, dns: [{ address: '64:ff9b::808:808', family: 6 }], responses: () => [new Response('ok')] },
    // Invalid policies: both modules must throw the same TypeError before any fetch.
    { name: 'policy maxBytes NaN', url: 'https://example.com/', policy: { ...base, maxBytes: NaN }, dns: PUBLIC, responses: () => [new Response('x'.repeat(65))] },
    {
      name: 'policy maxBytes string', url: 'https://example.com/', policy: { ...base, maxBytes: '1kb' as unknown as number },
      dns: PUBLIC, responses: () => [new Response('x'.repeat(65))],
    },
    {
      name: 'policy maxRedirects NaN', url: 'https://example.com/', policy: { ...base, maxRedirects: NaN }, dns: PUBLIC,
      responses: () => [0, 1, 2].map(() => new Response(null, { status: 302, headers: { location: '/x' } })),
    },
    { name: 'policy timeoutMs 2^31', url: 'https://example.com/', policy: { ...base, timeoutMs: 2 ** 31 }, dns: PUBLIC, responses: () => [new Response('ok')] },
    {
      name: 'policy allowedHosts null', url: 'https://example.com/', policy: { ...base, allowedHosts: null as unknown as Set<string> },
      dns: PUBLIC, responses: () => [new Response('ok')],
    },
    // A body that never ends must hit the same whole-call deadline.
    {
      name: 'never-ending body', url: 'https://example.com/', policy: { ...base, timeoutMs: 50 }, dns: PUBLIC,
      responses: () => [new Response(new ReadableStream<Uint8Array>({ start() { /* never enqueues */ } }))],
    },
  ];

  for (const sc of scenarios) {
    it(`same outcome: ${sc.name}`, async () => {
      const run = async (
        impl: typeof staged.hardenedFetch,
        seam: 'transport' | 'fetch',
      ): Promise<{ result: string; fetched: unknown[] }> => {
        lookup.mockReset();
        lookup.mockResolvedValue(sc.dns as never);
        const queue = sc.responses();
        const next = async (): Promise<Response> => {
          const response = queue.shift();
          if (!response) throw new Error('test: unexpected extra fetch');
          return response;
        };
        const spy = seam === 'transport'
          ? vi.spyOn(transport, 'request').mockImplementation(next)
          : vi.spyOn(globalThis, 'fetch').mockImplementation(next);
        const result = await asyncOutcome(() => impl(sc.url, sc.policy));
        const fetched = spy.mock.calls.map((c) => c[0]);
        spy.mockRestore();
        return { result, fetched };
      };
      const a = await run(staged.hardenedFetch, 'transport');
      const b = await run(inTree.hardenedFetch, 'fetch');
      expect(a).toEqual(b);
    });
  }
});
