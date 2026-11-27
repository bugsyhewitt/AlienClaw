/**
 * Property-based tests of hardenedFetch: connection pinning and policy validation.
 *
 *   3. Pinning: for generated multi-answer `resolve` results (public and blocked IPv4
 *      and IPv6 in many spellings, non-canonical and mislabelled entries, empty
 *      answers), hardenedFetch either refuses before any socket connect (when an
 *      answer is refused) or offers the socket only the validated answer, and Node
 *      dials from exactly that list; `resolve` runs exactly once per hop, across
 *      generated redirect chains too. Verdicts come from the independent reference in
 *      test/reference-blocklist.ts.
 *   4. Policy validation: generated FetchPolicy objects with wrong types, NaN, +-0,
 *      negative, fractional and huge values are refused with a TypeError naming the
 *      first bad field (in checking order), before any DNS, resolve, transport or socket
 *      call. Valid ones are accepted and their limits are in force, and each field is
 *      read once (a getter that turns invalid on its second read changes nothing).
 *
 * Network-free: node:dns/promises is mocked to throw, `resolve` is a fake in every
 * test, and net.Socket.prototype.connect is wrapped by the test/pinning.test.ts
 * instruments (copied here, see captureDials and viaLoopback) so that nothing but
 * loopback is ever dialled. Deterministic: every fc.assert has a fixed seed.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import * as http from 'node:http';
import * as net from 'node:net';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => { throw new Error('test: unexpected real DNS lookup'); }),
}));

import * as dnsModule from 'node:dns/promises';
import { hardenedFetch, type FetchPolicy, type ResolvedAddress } from '../src/index.js';
import { transport } from '../src/pinned-request.js';
import {
  HAVE_POLICY, V4_MAX, V6_MAX, loadReference, parseTableV6, v4Text, v6Spellings, type Range, type Reference,
} from './reference-blocklist.js';

const SEED = 0x91ed_c0de;
const POLICY: FetchPolicy = { timeoutMs: 5_000, maxBytes: 64 * 1024 };
const lookup = vi.mocked(dnsModule.lookup);

afterEach(() => {
  vi.restoreAllMocks();
  lookup.mockClear();
});

// ---------------------------------------------------------------------------
// Instruments (from test/pinning.test.ts; same refusal rules)
// ---------------------------------------------------------------------------

const realConnect = net.Socket.prototype.connect as (this: net.Socket, ...args: unknown[]) => net.Socket;

function connectOptions(args: unknown[]): net.TcpNetConnectOpts | undefined {
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  return typeof first === 'object' && first !== null ? (first as net.TcpNetConnectOpts) : undefined;
}

function refuse(socket: net.Socket, why: string): net.Socket {
  process.nextTick(() => socket.destroy(new Error(why)));
  return socket;
}

type Target = { host: string; address: string; family: number };

interface Capture {
  /** net.Socket#connect calls. */
  connects: number;
  /** IP-literal connects (Node skips `lookup` for them), refused before dialling. */
  literals: string[];
  /** What the transport's pinned lookup offered each hostname socket. */
  offered: Array<{ host: string; list: Array<{ address: string; family: number }> }>;
  /** Node's own 'lookup' report of every address it was about to try. */
  dialled: Target[];
}

/**
 * socketTargets() of test/pinning.test.ts, widened to every address Node would try.
 * Node's lookupAndConnectMultiple (lib/net.js) emits 'lookup' once per address the
 * lookup returned, in order, in one synchronous loop that returns as soon as the
 * socket stops connecting, and dials only after that loop. So the socket is destroyed
 * at the 'lookup' event of the LAST offered address: every candidate is recorded and
 * none is dialled. A literal or unpinned connect is refused, as there.
 */
function captureDials(): Capture {
  const cap: Capture = { connects: 0, literals: [], offered: [], dialled: [] };
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    cap.connects++;
    const opts = connectOptions(args);
    if (!opts) return refuse(this, 'test: unparsed connect refused');
    const host = String(opts.host);
    if (net.isIP(host) !== 0) {
      cap.literals.push(host);
      return refuse(this, 'test: literal connect intercepted');
    }
    const pinned = opts.lookup;
    if (typeof pinned !== 'function') return refuse(this, 'test: unpinned hostname connect refused');
    let offered = 0;
    let events = 0;
    opts.lookup = (hostname, options, callback) => {
      pinned(hostname, options, (err, address, family) => {
        const list = err ? [] : Array.isArray(address)
          ? address.map((a) => ({ address: a.address, family: a.family }))
          : [{ address, family: family ?? 0 }];
        cap.offered.push({ host: hostname, list });
        offered = list.length;
        callback(err, address, family);
      });
    };
    this.on('lookup', (err: Error | null, address: string, family: string | number | null, lookupHost: string) => {
      if (err) return;
      cap.dialled.push({ host: lookupHost, address, family: Number(family) });
      if (++events >= offered) this.destroy(new Error('test: connect intercepted'));
    });
    return realConnect.apply(this, args);
  } as never);
  return cap;
}

type Seen = { host: string; pinned: string[] };

/** viaLoopback() of test/pinning.test.ts: records the pinned list, then dials 127.0.0.1 instead. */
function viaLoopback(): Seen[] {
  const seen: Seen[] = [];
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    const opts = connectOptions(args);
    if (!opts) return refuse(this, 'test: unparsed connect refused');
    const host = String(opts.host);
    if (net.isIP(host) !== 0) {
      return host === '127.0.0.1' ? realConnect.apply(this, args) : refuse(this, 'test: non-loopback connect refused');
    }
    const pinned = opts.lookup;
    if (typeof pinned !== 'function') return refuse(this, 'test: unpinned hostname connect refused');
    const record: Seen = { host, pinned: [] };
    seen.push(record);
    opts.lookup = (hostname, options, callback) => {
      pinned(hostname, options, (err, address, family) => {
        if (err) { callback(err, address, family); return; }
        record.pinned = Array.isArray(address) ? address.map((a) => a.address) : [address];
        // Test-only redirect: the local listener stands in for the pinned address.
        if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
        else callback(null, '127.0.0.1', 4);
      });
    };
    return realConnect.apply(this, args);
  } as never);
  return seen;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** One resolver answer entry and whether the reference (plus net.isIP) lets it through. */
interface Entry { readonly entry: ResolvedAddress; readonly ok: boolean }

const REFUSED = /^SSRF rejected: (a resolved address is (in a blocked range|not a canonical IPv[46] address)|DNS returned no addresses)$/;

function answerArbitraries(ref: Reference) {
  const edges = (family: 4 | 6, max: bigint): bigint[] => ref.ranges.filter((r: Range) => r.family === family)
    .flatMap((r) => [r.first - 1n, r.first, r.last, r.last + 1n]).map((v) => (v < 0n ? 0n : v > max ? max : v));
  const v4 = fc.oneof(fc.constantFrom(...edges(4, V4_MAX)), fc.bigInt({ min: 0n, max: V4_MAX }));
  const v6 = fc.oneof(
    fc.constantFrom(...edges(6, V6_MAX)),
    fc.tuple(fc.constantFrom(...['::ffff:0:0', '64:ff9b::', '::'].map(parseTableV6)), v4).map(([p, a]) => p | a),
    fc.bigInt({ min: 0n, max: V6_MAX }),
  );
  const v4Entry = v4.map((v): Entry => ({ entry: { address: v4Text(v), family: 4 }, ok: !ref.v4(v) }));
  const v6Entry = fc.tuple(v6, fc.nat()).map(([v, k]): Entry => {
    const spellings = v6Spellings(v);
    return { entry: { address: spellings[k % spellings.length]!, family: 6 }, ok: !ref.v6(v) };
  });
  // Refused whatever the address: a leading-zero octet (net.isIP rejects it; the
  // classifier reads it as decimal), and a family label that does not fit the text.
  const nonCanonical = fc.tuple(v4, fc.nat({ max: 3 })).map(([v, i]): Entry => {
    const octets = v4Text(v).split('.');
    octets[i] = `0${octets[i]}`;
    return { entry: { address: octets.join('.'), family: 4 }, ok: false };
  });
  const mislabelled = fc.oneof(
    v4Entry.map((e): Entry => ({ entry: { address: e.entry.address, family: 6 }, ok: false })),
    v6Entry.map((e): Entry => ({ entry: { address: e.entry.address, family: 4 }, ok: false })),
  );
  const anyEntry = fc.oneof(
    { arbitrary: v4Entry, weight: 4 }, { arbitrary: v6Entry, weight: 4 },
    { arbitrary: nonCanonical, weight: 1 }, { arbitrary: mislabelled, weight: 1 },
  );
  const okEntry = fc.oneof(v4Entry, v6Entry).filter((e) => e.ok);
  // Half the answers are all-public, so the connect side is exercised as often as the refusal.
  const answer = fc.oneof(
    fc.array(okEntry, { minLength: 1, maxLength: 6 }),
    fc.array(anyEntry, { minLength: 0, maxLength: 6 }),
  );
  return { answer, okV4: v4Entry.filter((e) => e.ok) };
}

const accepted = (answer: readonly Entry[]): boolean => answer.length > 0 && answer.every((e) => e.ok);

// ---------------------------------------------------------------------------
// 3. Pinning
// ---------------------------------------------------------------------------

describe.skipIf(!HAVE_POLICY)('property: pinning dials only the validated answer, resolved once per hop', () => {
  let ref!: Reference;
  let arbs!: ReturnType<typeof answerArbitraries>;
  beforeAll(() => {
    ref = loadReference('ts');
    arbs = answerArbitraries(ref);
  });

  it('one hop: refused before any connect, or the socket is offered exactly the answer and dials from it', async () => {
    const target = fc.oneof(
      fc.constantFrom('a.example', 'rebind.example', 'xn--bcher-kva.example', 'h-1.test').map((host) => ({ host, literal: false })),
      // An IP-literal URL: still resolved once (its answer is validated), and Node dials the literal itself.
      arbs.okV4.map((e) => ({ host: e.entry.address, literal: true })),
    );
    await fc.assert(fc.asyncProperty(target, arbs.answer, async ({ host, literal }, answer) => {
      vi.restoreAllMocks();
      const cap = captureDials();
      const list = answer.map((e) => e.entry);
      const resolve = vi.fn(async (_hostname: string) => list.map((a) => ({ ...a })));
      const err = await hardenedFetch(`http://${host}/`, { ...POLICY, resolve })
        .then(() => new Error('test: resolved'), (e: Error) => e);
      expect(resolve.mock.calls).toEqual([[host]]);
      if (!accepted(answer)) {
        expect(err.message).toMatch(REFUSED);
        expect(cap.connects).toBe(0);
        expect(cap.offered).toEqual([]);
        return;
      }
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toBe('fetch failed');
      expect(cap.connects).toBe(1);
      if (literal) {
        expect(cap.literals).toEqual([host]);
        expect(cap.offered).toEqual([]);
        return;
      }
      expect((err.cause as Error | undefined)?.message).toBe('test: connect intercepted');
      expect(cap.offered).toEqual([{ host, list }]);
      expect(cap.dialled).toEqual(list.map(({ address, family }) => ({ host, address, family })));
    }), {
      seed: SEED,
      numRuns: 200,
      examples: [
        [{ host: 'a.example', literal: false }, [
          { entry: { address: '203.0.113.10', family: 4 }, ok: true },
          { entry: { address: '2606:4700::1111', family: 6 }, ok: true },
        ]],
        [{ host: 'a.example', literal: false }, [
          { entry: { address: '203.0.113.10', family: 4 }, ok: true },
          { entry: { address: '::FFFF:127.0.0.1', family: 6 }, ok: false },
        ]],
        [{ host: 'a.example', literal: false }, [{ entry: { address: '64:ff9b::169.254.169.254', family: 6 }, ok: false }]],
      ],
    });
  });

  describe('redirect chains', () => {
    type Hop = { host: string; answer: Entry[] };
    let port = 0;
    let hops: Hop[] = [];
    let requests: Array<[string | undefined, string | undefined]> = [];
    const server = http.createServer((req, res) => {
      requests.push([req.headers.host, req.url]);
      const i = Number(/^\/hop\/(\d+)$/.exec(req.url ?? '')?.[1] ?? -1);
      const next = hops[i + 1];
      if (i >= 0 && next !== undefined) {
        res.writeHead(302, { location: `http://${next.host}:${port}/hop/${i + 1}` });
        res.end();
      } else {
        res.end(`done ${i}`);
      }
    });
    beforeAll(async () => {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      port = (server.address() as net.AddressInfo).port;
    });
    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    });

    it('every hop resolves exactly once and is pinned to its own answer; the first refused hop stops the chain', async () => {
      const hop = fc.record({ host: fc.constantFrom('a.example', 'b.example', 'c.example'), answer: arbs.answer });
      await fc.assert(fc.asyncProperty(fc.array(hop, { minLength: 1, maxLength: 4 }), async (chain) => {
        vi.restoreAllMocks();
        hops = chain;
        requests = [];
        const seen = viaLoopback();
        const calls: string[] = [];
        // Answers by call index: an extra resolution would get no answer and fail loudly.
        const resolve = vi.fn(async (hostname: string) => {
          const h = chain[calls.length];
          calls.push(hostname);
          if (h === undefined) throw new Error('test: a hop resolved twice');
          return h.answer.map((e) => ({ ...e.entry }));
        });
        const outcome = await hardenedFetch(`http://${chain[0]!.host}:${port}/hop/0`, { ...POLICY, resolve })
          .then((body) => body, (e: Error) => e);
        const refusedAt = chain.findIndex((h) => !accepted(h.answer));
        const connected = refusedAt === -1 ? chain : chain.slice(0, refusedAt);
        const resolved = refusedAt === -1 ? chain : chain.slice(0, refusedAt + 1);
        expect(calls).toEqual(resolved.map((h) => h.host));
        expect(seen).toEqual(connected.map((h) => ({ host: h.host, pinned: h.answer.map((e) => e.entry.address) })));
        expect(requests).toEqual(connected.map((h, i) => [`${h.host}:${port}`, `/hop/${i}`]));
        if (refusedAt === -1) expect(outcome).toBe(`done ${chain.length - 1}`);
        else expect((outcome as Error).message).toMatch(REFUSED);
      }), { seed: SEED + 1, numRuns: 50 });
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Policy validation
// ---------------------------------------------------------------------------

const TIMEOUT_CEILING = 2_147_483_647;
const BYTES_CEILING = 256 * 1024 * 1024;
const REDIRECTS_CEILING = 20;
/** checkPolicy's order: the first bad field is the one named. */
const FIELDS = ['timeoutMs', 'maxBytes', 'maxRedirects', 'protocols', 'allowedHosts', 'resolve'] as const;
type Field = typeof FIELDS[number];

/** A field's value in a generated policy: absent, or present with a value that is valid or not. */
type FieldCase = { present: boolean; value: unknown; valid: boolean };

const PUBLIC: ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }];
const BODY = 'ok-body';

/** Values that are wrong for every field (each field has its own extra wrong values below). */
const WRONG_ANY = (): unknown[] => [
  null, Number.NaN, '', '1000', '1kb', true, false, 1000n, {}, Symbol('policy'), new Date(0), new Number(5), new String('https'),
];
const nonInteger = (max: number) => fc.double({ min: -max, max, noNaN: true }).filter((x) => !Number.isInteger(x));

function boundedIntCase(min: number, max: number, optional: boolean): fc.Arbitrary<FieldCase> {
  const valid = fc.oneof(fc.integer({ min, max }), fc.constantFrom(min, max), ...(min === 0 ? [fc.constant(-0)] : []));
  const invalid = fc.oneof(
    fc.constantFrom(...WRONG_ANY(), Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON, 2 ** 53, max + 1, min - 1, max + 0.5),
    ...(min > 0 ? [fc.constant(-0), fc.constant(0)] : []),
    fc.integer({ min: Number.MIN_SAFE_INTEGER, max: min - 1 }),
    fc.integer({ min: max + 1, max: Number.MAX_SAFE_INTEGER }),
    nonInteger(max * 2),
  );
  return fieldCase(valid, invalid, optional);
}

function fieldCase(valid: fc.Arbitrary<unknown>, invalid: fc.Arbitrary<unknown>, optional: boolean): fc.Arbitrary<FieldCase> {
  return fc.oneof(
    valid.map((value) => ({ present: true, value, valid: true })),
    invalid.map((value) => ({ present: true, value, valid: false })),
    // Omitted, or present as undefined: valid only for an optional field.
    fc.boolean().map((present) => ({ present, value: undefined, valid: optional })),
  );
}

const protocolName = fc.oneof(fc.constantFrom('http', 'https', 'HTTP', 'http:', 'ftp', 'file', ''), fc.string({ maxLength: 6 }));
const nonString = fc.constantFrom<unknown>(null, undefined, 1, true, {}, [], Symbol('p'), new String('http'));
const hostName = fc.oneof(fc.constantFrom('a.example', 'b.example', 'A.EXAMPLE', 'a.example.'), fc.string({ maxLength: 8 }));

const POLICY_CASE: { readonly [F in Field]: fc.Arbitrary<FieldCase> } = {
  timeoutMs: boundedIntCase(1, TIMEOUT_CEILING, false),
  maxBytes: boundedIntCase(0, BYTES_CEILING, false),
  maxRedirects: boundedIntCase(0, REDIRECTS_CEILING, true),
  protocols: fieldCase(
    fc.oneof(fc.constant(['https', 'http']), fc.array(protocolName, { maxLength: 4 }).map((names) => [...names, 'http']),
      fc.array(protocolName, { maxLength: 4 })),
    fc.oneof(
      fc.constantFrom<unknown>(...WRONG_ANY(), 'http', new Set(['http'])),
      fc.tuple(fc.array(protocolName, { maxLength: 3 }), nonString, fc.nat()).map(([names, bad, at]) => {
        const out: unknown[] = [...names];
        out.splice(at % (names.length + 1), 0, bad);
        return out;
      }),
    ),
    true,
  ),
  allowedHosts: fieldCase(
    fc.oneof(fc.array(hostName, { maxLength: 4 }).map((names) => new Set(names)),
      fc.array(hostName, { maxLength: 3 }).map((names) => new Set([...names, 'a.example']))),
    fc.oneof(
      fc.constantFrom<unknown>(...WRONG_ANY(), 'a.example', new Map([['a.example', true]]), new WeakSet()),
      fc.array(hostName, { maxLength: 3 }),
    ),
    true,
  ),
  resolve: fieldCase(
    fc.constant('resolve-hook'),  // replaced by the run's spy
    fc.constantFrom<unknown>(...WRONG_ANY(), 'dns.example', 42, [], { resolve: () => PUBLIC }),
    true,
  ),
};

const validPolicyCase = fc.record(Object.fromEntries(FIELDS.map((f) => [f, POLICY_CASE[f].filter((x) => x.valid)])) as
  { [F in Field]: fc.Arbitrary<FieldCase> });
/** Exactly one bad field, so that each field is the one named about equally often. */
const oneBadPolicyCase = fc.constantFrom(...FIELDS).chain((bad) => fc.record(Object.fromEntries(FIELDS.map((f) =>
  [f, POLICY_CASE[f].filter((x) => x.valid === (f !== bad))])) as { [F in Field]: fc.Arbitrary<FieldCase> }));
/** About 40% all-valid policies (a free mix of the six fields would be about 2%). */
const policyCase = fc.oneof(
  { arbitrary: validPolicyCase, weight: 2 },
  { arbitrary: oneBadPolicyCase, weight: 2 },
  { arbitrary: fc.record(POLICY_CASE), weight: 1 },
);

/** The policy object for one case; `resolve` stands for the run's resolve spy. */
function buildPolicy(c: { readonly [F in Field]: FieldCase }, resolve: unknown, extra: boolean): Record<string, unknown> {
  const policy: Record<string, unknown> = extra ? { note: 'ignored', timeout: 'also ignored' } : {};
  for (const f of FIELDS) {
    if (!c[f].present) continue;
    policy[f] = f === 'resolve' && c[f].valid && c[f].value !== undefined ? resolve : c[f].value;
  }
  return policy;
}

/** What a VALID policy must give for http://a.example/ with a one-chunk BODY response. */
function expectedOutcome(policy: Record<string, unknown>): string {
  const protocols = policy.protocols as string[] | undefined;
  if (protocols !== undefined && !protocols.includes('http')) {
    return `Protocol rejected: http: — only ${protocols.join(', ')} allowed`;
  }
  const hosts = policy.allowedHosts as Set<unknown> | undefined;
  if (hosts !== undefined && !hosts.has('a.example')) return 'Host not in allowlist: "a.example"';
  if (policy.resolve === undefined) return 'DNS resolution failed for "a.example": test: unexpected real DNS lookup';
  const maxBytes = policy.maxBytes as number;
  return BODY.length > maxBytes ? `Response exceeds ${maxBytes} bytes — rejecting` : BODY;
}

describe('property: FetchPolicy validation', () => {
  it('a bad field is a TypeError naming the first bad field, before any I/O; a valid policy is accepted and enforced', async () => {
    await fc.assert(fc.asyncProperty(policyCase, fc.boolean(), async (c, extra) => {
      vi.restoreAllMocks();
      lookup.mockClear();
      const resolve = vi.fn(async () => PUBLIC);
      const request = vi.spyOn(transport, 'request').mockImplementation(async () => new Response(BODY));
      const connect = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket) {
        return refuse(this, 'test: no socket in policy tests');
      } as never);
      const policy = buildPolicy(c, resolve, extra);
      const outcome = await hardenedFetch('http://a.example/', policy as unknown as FetchPolicy)
        .then((body) => body, (e: Error) => e);
      const firstBad = FIELDS.find((f) => !c[f].valid);
      if (firstBad !== undefined) {
        expect(outcome).toBeInstanceOf(TypeError);
        expect((outcome as Error).message.startsWith(`Invalid FetchPolicy: ${firstBad} must be `), (outcome as Error).message)
          .toBe(true);
        expect(lookup).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
      } else {
        const want = expectedOutcome(policy);
        expect(outcome instanceof Error ? outcome.message : outcome).toBe(want);
        expect(outcome).not.toBeInstanceOf(TypeError);
        expect(request).toHaveBeenCalledTimes(want === BODY || want.startsWith('Response exceeds') ? 1 : 0);
      }
      expect(connect).not.toHaveBeenCalled();
    }), {
      seed: SEED + 10,
      numRuns: 1_500,
      examples: [
        // The README's own examples of what used to slip through: maxBytes NaN / "1kb" / undefined, maxRedirects NaN.
        [{ ...validDefaults(), maxBytes: { present: true, value: Number.NaN, valid: false } }, false],
        [{ ...validDefaults(), maxBytes: { present: true, value: '1kb', valid: false } }, false],
        [{ ...validDefaults(), maxBytes: { present: false, value: undefined, valid: false } }, false],
        [{ ...validDefaults(), maxRedirects: { present: true, value: Number.NaN, valid: false } }, false],
        [{ ...validDefaults(), timeoutMs: { present: true, value: 2_147_483_648, valid: false } }, false],
      ],
    });
  });

  it('a policy that is not an object is a TypeError before any I/O', async () => {
    const notObject = fc.oneof(
      fc.constantFrom<unknown>(null, undefined, true, 0, Number.NaN, 'policy', 1n, Symbol('policy'), () => POLICY),
      fc.oneof(fc.integer(), fc.string()),
    );
    await fc.assert(fc.asyncProperty(notObject, async (policy) => {
      lookup.mockClear();
      const request = vi.spyOn(transport, 'request').mockRejectedValue(new Error('test: transport reached'));
      const outcome = await hardenedFetch('http://a.example/', policy as FetchPolicy).then(() => undefined, (e: Error) => e);
      expect(outcome).toBeInstanceOf(TypeError);
      expect(outcome?.message.startsWith('Invalid FetchPolicy: expected an object (got ')).toBe(true);
      expect(lookup).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    }), { seed: SEED + 11, numRuns: 200 });
  });

  it('each field is read once: a getter that turns invalid on its second read changes nothing', async () => {
    // A redirect hop too, so the protocols, allowedHosts and maxRedirects checks run twice.
    const respond = (): (() => Promise<Response>) => {
      let n = 0;
      return async () => (n++ === 0
        ? new Response(null, { status: 302, headers: { location: 'http://a.example/next' } })
        : new Response(BODY));
    };
    await fc.assert(fc.asyncProperty(validPolicyCase, async (c) => {
      vi.restoreAllMocks();
      const resolve = vi.fn(async () => PUBLIC);
      const plain = buildPolicy(c, resolve, false);
      const reads = new Map<PropertyKey, number>();
      const flipping = new Proxy(plain, {
        get(target, key, receiver) {
          const n = (reads.get(key) ?? 0) + 1;
          reads.set(key, n);
          return n === 1 ? Reflect.get(target, key, receiver) : Number.NaN;
        },
      });
      const run = async (policy: object): Promise<string> => {
        vi.spyOn(transport, 'request').mockImplementation(respond());
        return hardenedFetch('http://a.example/', policy as FetchPolicy).then((body) => body, (e: Error) => e.message);
      };
      const expected = await run(plain);
      expect(await run(flipping)).toBe(expected);
      for (const [key, n] of reads) expect(n, `policy.${String(key)} read ${n} times`).toBe(1);
    }), { seed: SEED + 12, numRuns: 300 });
  });
});

/** A case with every field valid and present (timeoutMs 5000, maxBytes 1024, rest omitted). */
function validDefaults(): { [F in Field]: FieldCase } {
  return {
    timeoutMs: { present: true, value: 5_000, valid: true },
    maxBytes: { present: true, value: 1_024, valid: true },
    maxRedirects: { present: false, value: undefined, valid: true },
    protocols: { present: false, value: undefined, valid: true },
    allowedHosts: { present: false, value: undefined, valid: true },
    resolve: { present: true, value: 'resolve-hook', valid: true },
  };
}
