/**
 * Property-based tests of the address and host-name classifiers (isBlockedHost,
 * validateResolvedAddresses) against an independent reference built from
 * policy/blocklist.v1.json (test/reference-blocklist.ts: its own parsing, its own BigInt
 * CIDR arithmetic, the README's matching rules and profiles, the `ts` column).
 *
 *   1. Block-list semantics: generated IPv4 and IPv6 addresses, biased toward every
 *      table CIDR's boundaries (first, last, +-1), drawn inside each range, embedded
 *      forms (IPv4-compatible, -mapped, -translated, NAT64, 6to4, Teredo and near
 *      misses), and uniform random. Every textual IPv6 spelling of one address
 *      (canonical, expanded, zero-padded, every '::' placement, embedded dotted quad,
 *      mixed case, zone ID) must get the reference's verdict.
 *   2. Host spellings: names and IPv4 literals spelled the ways WHATWG URL normalises to
 *      one host (case, full-width letters, digits and dots, ideographic full stops,
 *      soft hyphens, percent-encoding, IDNA labels, hex / octal / short IPv4 forms,
 *      trailing dots). Classification follows the normalised host, and hardenedFetch
 *      refuses a blocked spelling before it resolves anything.
 *
 * Deterministic: every fc.assert has a fixed seed (SEED + n). Network-free:
 * node:dns/promises is mocked to throw and the transport seam is stubbed.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => { throw new Error('test: unexpected real DNS lookup'); }),
}));

import { hardenedFetch, isBlockedHost, validateResolvedAddresses, type ResolvedAddress } from '../src/index.js';
import { transport } from '../src/pinned-request.js';
import {
  HAVE_POLICY, V4_MAX, V6_MAX, addressArbitraries, loadReference, mixCase, parseTableV4, parseTableV6,
  v4Text, v6Canonical, v6Spellings, type Reference,
} from './reference-blocklist.js';

const SEED = 0x5afe_f37c;
const BLOCKED_RANGE = 'SSRF rejected: a resolved address is in a blocked range';

afterEach(() => { vi.restoreAllMocks(); });

/** 'blocked' / 'allowed' / the unexpected error's message, for one validateResolvedAddresses call. */
function verdict(addresses: ResolvedAddress[]): string {
  try {
    validateResolvedAddresses(addresses);
    return 'allowed';
  } catch (err) {
    return (err as Error).message === BLOCKED_RANGE ? 'blocked' : (err as Error).message;
  }
}
const asVerdict = (blocked: boolean): string => (blocked ? 'blocked' : 'allowed');

describe.skipIf(!HAVE_POLICY)('property: block-list semantics match policy/blocklist.v1.json', () => {
  // Built in beforeAll, which does not run when the suite is skipped (no policy/ folder).
  let ref!: Reference;
  let v4Value!: fc.Arbitrary<bigint>;
  let v6Value!: fc.Arbitrary<bigint>;
  beforeAll(() => {
    ref = loadReference('ts');
    ({ v4Value, v6Value } = addressArbitraries(ref));
  });

  it('the reference reads the table it claims to (sanity)', () => {
    expect(ref.profile).toBe('per-language');
    // Spot values whose verdict DIFFERENCES.md / the README state outright.
    const v4 = (t: string): boolean => ref.v4(parseTableV4(t));
    const v6 = (t: string): boolean => ref.v6(parseTableV6(t));
    expect([v4('127.0.0.1'), v4('100.64.0.0'), v4('100.127.255.255'), v4('100.128.0.0'), v4('168.63.129.16')])
      .toEqual([true, true, true, false, true]);
    expect([v4('192.0.0.9'), v4('192.0.2.1'), v4('8.8.8.8')]).toEqual([true, false, false]);  // TS column: g1, g2
    expect([v6('::1'), v6('::ffff:808:808'), v6('64:ff9b::808:808'), v6('64:ff9b::a00:1')]).toEqual([true, true, false, true]);
    expect([v6('2001:1::1'), v6('2001:1::3'), v6('2001:3::1'), v6('2001::1'), v6('2001:db8::1')])
      .toEqual([false, false, false, true, false]);  // Teredo whole, its /23 neighbours open in TS (g8, g9)
  });

  it('IPv4: isBlockedHost and validateResolvedAddresses give the reference verdict', () => {
    fc.assert(fc.property(v4Value, (v) => {
      const text = v4Text(v);
      const expected = ref.v4(v);
      const where = `${text} (${ref.describe(4, v)})`;
      expect(isBlockedHost(text), where).toBe(expected);
      expect(verdict([{ address: text, family: 4 }]), where).toBe(asVerdict(expected));
    }), { seed: SEED, numRuns: 6_000 });
  });

  it('IPv6: every spelling of one address gets the reference verdict (and WHATWG agrees they are one address)', () => {
    const caseMask = fc.array(fc.boolean(), { minLength: 1, maxLength: 7 });
    const zone = fc.constantFrom('eth0', 'lo', '1', 'EN0', 'wlp2s0');
    fc.assert(fc.property(v6Value, caseMask, zone, (v, mask, z) => {
      const expected = ref.v6(v);
      const canonical = v6Canonical(v);
      const want = asVerdict(expected);
      // Collected, not asserted one by one: a few hundred checks per run, and a
      // failure should list every spelling that disagreed.
      const wrong: string[] = [];
      for (const spelling of v6Spellings(v)) {
        for (const s of [spelling, mixCase(spelling, mask), spelling.toUpperCase()]) {
          const host = new URL(`http://[${s}]/`).hostname;
          if (host !== `[${canonical}]`) wrong.push(`WHATWG reads ${s} as ${host}`);
          if (isBlockedHost(`[${s}]`) !== expected) wrong.push(`isBlockedHost([${s}])`);
          if (isBlockedHost(s) !== expected) wrong.push(`isBlockedHost(${s})`);
          if (verdict([{ address: s, family: 6 }]) !== want) wrong.push(`validateResolvedAddresses(${s})`);
        }
      }
      // Zone IDs are ignored for the match (policy/README.md rule 4).
      for (const s of [`${canonical}%${z}`, `[${canonical}%${z}]`]) {
        if (isBlockedHost(s) !== expected) wrong.push(`isBlockedHost(${s})`);
      }
      if (verdict([{ address: `${canonical}%${z}`, family: 6 }]) !== want) wrong.push(`validateResolvedAddresses(${canonical}%${z})`);
      expect(wrong, `${canonical} (${ref.describe(6, v)}) should be ${want}`).toEqual([]);
    }), {
      seed: SEED + 1,
      numRuns: 1_200,
      // Hand-picked edges: each matcher prefix's boundary, the odd ::/8 shapes (g12),
      // 6to4 / Teredo first addresses, and the IPv6 exemptions inside Teredo's /23.
      examples: [
        '::ffff:0:0', '::ffff:ffff:ffff', '::fffe:ffff:ffff', '::1:0:0:0', '64:ff9b::', '64:ff9b::ffff:ffff',
        '64:ff9b::1:0:0', '64:ff9b:0:0:1::', '64:ff9b:1::', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff', '64:ff9b:2::',
        '::1:ffff:0:0', '::ffff:0:0:7f00:1', '::1:7f00:1', '2002::', '2001::', '2001:0:ffff:ffff:ffff:ffff:ffff:ffff',
        '2001:1::1', '2001:1::2', '2001:1::3', '2001:4:112::', '2001:4:113::', 'fec0::', 'feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      ].map((t) => [parseTableV6(t), [true], 'eth0'] as [bigint, boolean[], string]),
    });
  });

  it('a multi-address answer is refused exactly when one address is blocked, naming the first one', () => {
    const entry = fc.oneof(
      v4Value.map((v) => ({ address: v4Text(v), family: 4, blocked: ref.v4(v) })),
      fc.tuple(v6Value, fc.nat()).map(([v, pick]) => {
        const spellings = v6Spellings(v);
        return { address: spellings[pick % spellings.length]!, family: 6, blocked: ref.v6(v) };
      }),
    );
    fc.assert(fc.property(fc.array(entry, { maxLength: 6 }), (entries) => {
      const answer = entries.map(({ address, family }) => ({ address, family }));
      const firstBlocked = entries.find((e) => e.blocked);
      let thrown: (Error & { blockedAddress?: string; addressFamily?: number }) | undefined;
      try { validateResolvedAddresses(answer); } catch (err) { thrown = err as typeof thrown; }
      if (entries.length === 0) {
        expect(thrown?.message).toBe('SSRF rejected: DNS returned no addresses');
      } else if (firstBlocked === undefined) {
        expect(thrown).toBeUndefined();
      } else {
        expect(thrown?.message).toBe(BLOCKED_RANGE);
        expect(thrown?.blockedAddress).toBe(firstBlocked.address);
        expect(thrown?.addressFamily).toBe(firstBlocked.family);
      }
    }), { seed: SEED + 2, numRuns: 2_000 });
  });

  it('a family label that does not match the address, or is not 4 or 6, is always refused', () => {
    const v4String = v4Value.map(v4Text);
    const v6String = fc.tuple(v6Value, fc.nat()).map(([v, pick]) => {
      const spellings = v6Spellings(v);
      return spellings[pick % spellings.length]!;
    });
    fc.assert(fc.property(v4String, v6String, (a4, a6) => {
      expect(verdict([{ address: a4, family: 6 }]), `${a4} as family 6`).toBe('blocked');
      expect(verdict([{ address: a6, family: 4 }]), `${a6} as family 4`).toBe('blocked');
    }), { seed: SEED + 3, numRuns: 1_000 });
    const badFamily = fc.oneof(
      fc.integer().filter((f) => f !== 4 && f !== 6),
      fc.constantFrom(Number.NaN, 4.5, -4, Infinity, -0),
    );
    fc.assert(fc.property(fc.oneof(v4String, v6String), badFamily, (address, family) => {
      expect(verdict([{ address, family }])).toBe(`SSRF rejected: unknown address family ${family} for a resolved address`);
    }), { seed: SEED + 4, numRuns: 500 });
  });
});

// ---------------------------------------------------------------------------
// 2. Host spellings
// ---------------------------------------------------------------------------

const FULLWIDTH_OFFSET = 0xff01 - 0x21;  // U+FF01..U+FF5E are U+0021..U+007E
const fullwidth = (c: string): string => String.fromCharCode(c.charCodeAt(0) + FULLWIDTH_OFFSET);
/** The four dots UTS 46 maps to '.': ASCII, full-width, ideographic, half-width ideographic. */
const DOTS = ['.', '\uff0e', '\u3002', '\uff61'] as const;
const SOFT_HYPHEN = '\u00ad';  // UTS 46 "ignored": removed by IDNA mapping
const UNICODE_LETTERS = ['é', 'ü', 'ñ', 'ö'] as const;

/** How one character of a host is written; the choice is consumed cyclically. */
type CharStyle = 'plain' | 'upper' | 'fullwidth' | 'fullwidth-upper' | 'percent' | 'soft-hyphen';
const charStyle = fc.constantFrom<CharStyle>('plain', 'plain', 'plain', 'upper', 'fullwidth', 'fullwidth-upper', 'percent', 'soft-hyphen');

/** A spelling of `host` (lower-case ASCII, digits, '-', '.', and a few accented letters). */
function respell(host: string, styles: readonly CharStyle[], dots: readonly number[]): string {
  let out = '';
  let dotIndex = 0;
  for (let i = 0; i < host.length; i++) {
    const c = host[i]!;
    const style = styles.length === 0 ? 'plain' : styles[i % styles.length]!;
    if (c === '.') {
      out += DOTS[dots.length === 0 ? 0 : dots[dotIndex++ % dots.length]!]!;
      continue;
    }
    const ascii = c.charCodeAt(0) < 0x80;
    switch (style) {
      case 'upper': out += c.toUpperCase(); break;
      case 'fullwidth': out += ascii ? fullwidth(c) : c; break;
      case 'fullwidth-upper': out += ascii ? fullwidth(c.toUpperCase()) : c.toUpperCase(); break;
      case 'percent': out += ascii ? `%${c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}` : c; break;
      case 'soft-hyphen': out += `${SOFT_HYPHEN}${c}`; break;
      default: out += c;
    }
  }
  return out;
}

describe.skipIf(!HAVE_POLICY)('property: host spellings WHATWG normalises to one host classify alike', () => {
  let ref!: Reference;
  let v4Edges!: fc.Arbitrary<bigint>;
  beforeAll(() => {
    ref = loadReference('ts');
    ({ v4Edges } = addressArbitraries(ref));
  });

  // Labels start with a letter, so no name is read as an IPv4 number, and never with
  // 'xn--', so every generated label is valid input to IDNA.
  const asciiLabel = fc.stringMatching(/^[a-z][a-z0-9-]{0,9}$/).filter((l) => !l.startsWith('xn--'));
  const unicodeLabel = fc.tuple(asciiLabel, fc.constantFrom(...UNICODE_LETTERS), fc.nat())
    .map(([l, u, at]) => { const i = 1 + (at % l.length); return `${l.slice(0, i)}${u}${l.slice(i)}`; });
  const label = fc.oneof({ arbitrary: asciiLabel, weight: 4 }, { arbitrary: unicodeLabel, weight: 1 });
  const TOKENS = ['localhost', 'ip6-localhost', 'ip6-loopback'] as const;
  const token = fc.constantFrom(...TOKENS);
  const baseName = fc.oneof(
    token,
    fc.tuple(fc.array(label, { minLength: 1, maxLength: 3 }), token).map(([ls, t]) => [...ls, t].join('.')),
    fc.tuple(label, token, fc.nat({ max: 5 })).map(([l, t, k]) =>
      [`${t}${l}`, `${l}${t}`, `${t}.${l}`, `${t}-${l}`, `${l}-${t}`, `${l}.${t}.${l}`][k]!),
    fc.array(label, { minLength: 1, maxLength: 4 }).map((ls) => ls.join('.')),
  );
  const spelledName = fc.record({
    base: baseName,
    trailing: fc.nat({ max: 3 }),
    styles: fc.array(charStyle, { minLength: 1, maxLength: 9 }),
    dots: fc.array(fc.nat({ max: 3 }), { minLength: 1, maxLength: 4 }),
    mask: fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
  });

  it('names: the WHATWG host of every spelling gets the reference verdict, trailing dots and case included', () => {
    fc.assert(fc.property(spelledName, ({ base, trailing, styles, dots, mask }) => {
      const asciiTrailing = '.'.repeat(trailing);
      const host = new URL(`http://${base}${asciiTrailing}/`).hostname;
      const spelling = respell(`${base}${asciiTrailing}`, styles, dots);
      // Sanity: the generator only produces spellings WHATWG reads as this same host.
      expect(new URL(`http://${spelling}/`).hostname, `${JSON.stringify(spelling)} -> ${host}`).toBe(host);
      const expected = ref.name(host);
      expect(isBlockedHost(host), host).toBe(expected);
      // isBlockedHost does two normalisations itself: case, and trailing dots on names.
      expect(isBlockedHost(mixCase(host, mask)), host).toBe(expected);
      expect(isBlockedHost(host.replace(/\.+$/, '')), host).toBe(expected);
      // Without trailing dots the verdict is the same (the policy ignores them).
      expect(ref.name(host.replace(/\.+$/, ''))).toBe(expected);
    }), {
      seed: SEED + 10,
      numRuns: 3_000,
      examples: [
        [{ base: 'localhost', trailing: 1, styles: ['fullwidth'], dots: [1], mask: [true] }],
        [{ base: 'a.localhost', trailing: 3, styles: ['soft-hyphen', 'percent'], dots: [2, 3], mask: [false, true] }],
        [{ base: 'localhost.a', trailing: 0, styles: ['upper'], dots: [1], mask: [true] }],
        [{ base: 'x.ip6-localhost', trailing: 0, styles: ['plain'], dots: [0], mask: [false] }],
        [{ base: 'büh.localhost', trailing: 1, styles: ['fullwidth-upper'], dots: [3], mask: [true] }],
      ],
    });
  });

  /** One IPv4 address written as 1-4 parts, each decimal, octal or hex, maybe with a trailing dot. */
  const ipv4Spelling = () => fc.record({
    v: fc.oneof(v4Edges, fc.bigInt({ min: 0n, max: V4_MAX })),
    parts: fc.integer({ min: 1, max: 4 }),
    radix: fc.array(fc.constantFrom(10, 8, 16), { minLength: 4, maxLength: 4 }),
    upperX: fc.boolean(),
    trailingDot: fc.boolean(),
    styles: fc.array(charStyle, { minLength: 1, maxLength: 5 }),
    dots: fc.array(fc.nat({ max: 3 }), { minLength: 1, maxLength: 4 }),
  });
  const writeIpv4 = ({ v, parts, radix, upperX, trailingDot }: { v: bigint; parts: number; radix: number[]; upperX: boolean; trailingDot: boolean }): string => {
    const nums: bigint[] = [];
    for (let i = 0; i < parts - 1; i++) nums.push((v >> BigInt(8 * (3 - i))) & 0xffn);
    nums.push(v & ((1n << BigInt(8 * (5 - parts))) - 1n));
    const text = nums.map((n, i) => {
      if (radix[i] === 16) return `0${upperX ? 'X' : 'x'}${n.toString(16)}`;
      if (radix[i] === 8) return `0${n.toString(8)}`;
      return n.toString(10);
    }).join('.');
    return trailingDot ? `${text}.` : text;
  };

  it('IPv4 literals: decimal, octal, hex, short and full-width forms classify as their dotted quad', () => {
    fc.assert(fc.property(ipv4Spelling(), (spec) => {
      const dotted = v4Text(spec.v);
      const spelling = respell(writeIpv4(spec), spec.styles, spec.dots);
      const host = new URL(`http://${spelling}/`).hostname;
      expect(host, `${JSON.stringify(spelling)} is ${dotted} to WHATWG`).toBe(dotted);
      expect(isBlockedHost(host), `${spelling} = ${dotted}`).toBe(ref.v4(spec.v));
    }), { seed: SEED + 11, numRuns: 3_000 });
  });

  it('hardenedFetch: a blocked spelling is refused before any resolve; an allowed one resolves its WHATWG host once', async () => {
    const PUBLIC: ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }];
    const sentinel = new Error('test: transport reached');
    const spelledHost = fc.oneof(
      spelledName.map(({ base, trailing, styles, dots }) => respell(`${base}${'.'.repeat(trailing)}`, styles, dots)),
      ipv4Spelling().map((spec) => respell(writeIpv4(spec), spec.styles, spec.dots)),
      fc.tuple(fc.bigInt({ min: 0n, max: V6_MAX }), fc.constantFrom(...[
        '::1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '64:ff9b::808:808', 'fe80::1', '2606:4700::1111', 'fd00:ec2::254',
      ].map(parseTableV6)), fc.boolean(), fc.nat())
        .map(([random, fixed, useFixed, pick]) => {
          const spellings = v6Spellings(useFixed ? fixed : random);
          return `[${spellings[pick % spellings.length]!}]`;
        }),
    );
    expect(ref.v4(parseTableV4(PUBLIC[0]!.address))).toBe(false);
    await fc.assert(fc.asyncProperty(spelledHost, async (spelling) => {
      const host = new URL(`http://${spelling}/`).hostname;
      const bare = host.startsWith('[') ? host.slice(1, -1) : host;
      const expected = host.startsWith('[')
        ? ref.v6(parseTableV6(bare))
        : /^[0-9.]+$/.test(host) ? ref.v4(parseTableV4(host)) : ref.name(host);
      const resolve = vi.fn(async (_hostname: string) => PUBLIC);
      const request = vi.spyOn(transport, 'request').mockRejectedValue(sentinel);
      const outcome = await hardenedFetch(`http://${spelling}/`, { timeoutMs: 5_000, maxBytes: 1024, resolve })
        .then(() => 'resolved', (err: Error) => err);
      if (expected) {
        expect(outcome).toBeInstanceOf(Error);
        expect((outcome as Error).message).toBe(`SSRF rejected: hostname "${host}" is blocked`);
        expect(resolve).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
      } else {
        expect(outcome).toBe(sentinel);
        expect(resolve.mock.calls).toEqual([[bare]]);
        expect(request).toHaveBeenCalledTimes(1);
      }
      request.mockRestore();
    }), { seed: SEED + 12, numRuns: 400 });
  });
});
