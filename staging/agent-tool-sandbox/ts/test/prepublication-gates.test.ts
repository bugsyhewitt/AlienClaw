/**
 * Pre-publication gates (2026-11-26): what an error message may reveal, the
 * RFC 6761 localhost names before DNS, and the declared Node range.
 *
 *   PR-03 (docs/salvage/PINNING-SECURITY-REVIEW.md): a refusal must not name
 *     the address a hostname resolved to. In an agent tool the error text goes
 *     back to the model, so a prompt-injected page could map internal DNS by
 *     asking for http://db.corp/ and reading the refusal. The address stays
 *     available to a logging caller as the non-enumerable `blockedAddress`.
 *   G7 (OSS-LIB-EXTRACTION-PLAN.md §4): `localhost.`, `*.localhost` and
 *     `*.localhost.` are refused before DNS, and a URL that appears in an error
 *     message has its userinfo, query and fragment redacted.
 *   PR-07: package.json `engines.node` is the plan's runtime floor, >=22.
 *
 * PR-04 (the NODE_TLS_REJECT_UNAUTHORIZED=0 opt-out) is tested in
 * test/pinning.test.ts, next to the other certificate tests.
 *
 * Network-free: DNS via vi.mock and the transport stubbed behind a throwing
 * guard, except in the credential tests, which run the real transport (it
 * refuses a URL with credentials before it opens a socket) under a
 * net.Socket#connect tripwire that fails the test on any connect attempt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as net from 'node:net';
import { inspect } from 'node:util';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as dnsModule from 'node:dns/promises';
import {
  hardenedFetch,
  isBlockedHost,
  validateResolvedAddresses,
  type FetchPolicy,
  type ResolvedAddress,
} from '../src/index.js';
import { pinnedRequest, transport } from '../src/pinned-request.js';

const POLICY: FetchPolicy = { timeoutMs: 5_000, maxBytes: 1024 };
const PUBLIC: ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }];
const lookup = vi.mocked(dnsModule.lookup);

type Detailed = Error & { blockedAddress?: unknown; addressFamily?: unknown };

function thrown(fn: () => unknown): Detailed {
  try {
    fn();
  } catch (err) {
    return err as Detailed;
  }
  throw new Error('test: expected a throw');
}

async function rejection(p: Promise<unknown>): Promise<Detailed> {
  try {
    await p;
  } catch (err) {
    return err as Detailed;
  }
  throw new Error('test: expected a rejection');
}

/** Everything a careless caller might hand back to a model: message, stack, inspect, JSON. */
function renderings(err: Error): string[] {
  return [err.message, String(err), err.stack ?? '', inspect(err), JSON.stringify(err)];
}

function guardTransport(): void {
  vi.spyOn(transport, 'request').mockImplementation(async () => {
    throw new Error('test: unexpected real request');
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  lookup.mockReset();
});

// ---------------------------------------------------------------------------
// PR-03: refusals do not name the resolved address
// ---------------------------------------------------------------------------

describe('PR-03: a refusal does not reveal the address a name resolved to', () => {
  const BLOCKED_RANGE = 'SSRF rejected: a resolved address is in a blocked range';

  const CASES: Array<[string, ResolvedAddress[], string, string, number]> = [
    ['blocked IPv4', [{ address: '10.1.2.3', family: 4 }], BLOCKED_RANGE, '10.1.2.3', 4],
    ['blocked IPv6 (AWS IMDS)', [{ address: 'fd00:ec2::254', family: 6 }], BLOCKED_RANGE, 'fd00:ec2::254', 6],
    ['IPv4-mapped IPv6', [{ address: '::ffff:192.168.7.9', family: 6 }], BLOCKED_RANGE, '::ffff:192.168.7.9', 6],
    ['an unparseable family-4 entry', [{ address: '0177.0.0.1', family: 4 }], BLOCKED_RANGE, '0177.0.0.1', 4],
    ['one internal address after a public one', [...PUBLIC, { address: '172.20.0.5', family: 4 }], BLOCKED_RANGE, '172.20.0.5', 4],
    ['an unknown family', [{ address: '10.9.8.7', family: 0 }],
      'SSRF rejected: unknown address family 0 for a resolved address', '10.9.8.7', 0],
  ];

  for (const [label, answer, message, address, family] of CASES) {
    it(`validateResolvedAddresses, ${label}: generic message, detail on the error object`, () => {
      const err = thrown(() => validateResolvedAddresses(answer));
      expect(err.constructor).toBe(Error);  // the error class is unchanged
      expect(err.message).toBe(message);
      for (const text of renderings(err)) expect(text).not.toContain(address);
      expect(err.blockedAddress).toBe(address);
      expect(err.addressFamily).toBe(family);
    });
  }

  it('the detail properties are non-enumerable (inspect and JSON.stringify skip them)', () => {
    const err = thrown(() => validateResolvedAddresses([{ address: '169.254.169.254', family: 4 }]));
    expect(Object.keys(err)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(err, 'blockedAddress')).toMatchObject({ enumerable: false, writable: false });
    expect(Object.getOwnPropertyDescriptor(err, 'addressFamily')).toMatchObject({ enumerable: false, writable: false });
  });

  it('hardenedFetch: an internal DNS answer is refused without naming it; no request', async () => {
    guardTransport();
    lookup.mockResolvedValue([{ address: '10.20.30.40', family: 4 }] as never);
    const err = await rejection(hardenedFetch('http://vault.corp.example/v1/secret', POLICY));
    expect(err.constructor).toBe(Error);
    expect(err.message).toBe(BLOCKED_RANGE);
    for (const text of renderings(err)) expect(text).not.toContain('10.20.30.40');
    expect(err.blockedAddress).toBe('10.20.30.40');
    expect(err.addressFamily).toBe(4);
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('hardenedFetch: a non-canonical resolve-hook answer is refused without naming it', async () => {
    guardTransport();
    const err = await rejection(hardenedFetch('http://db.corp.example/', {
      ...POLICY, resolve: () => [{ address: '012.0.0.1', family: 4 }],
    }));
    expect(err.message).toBe('SSRF rejected: a resolved address is not a canonical IPv4 address');
    for (const text of renderings(err)) expect(text).not.toContain('012.0.0.1');
    expect(err.blockedAddress).toBe('012.0.0.1');
    expect(err.addressFamily).toBe(4);
  });

  it('hardenedFetch: a redirect hop that resolves internally is refused the same way', async () => {
    lookup.mockImplementation((async (host: string) =>
      host === 'internal.corp.example' ? [{ address: '192.168.50.1', family: 4 }] : PUBLIC) as never);
    vi.spyOn(transport, 'request').mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: 'http://internal.corp.example/' } }));
    const err = await rejection(hardenedFetch('https://public.example/', POLICY));
    expect(err.message).toBe(BLOCKED_RANGE);
    expect(err.blockedAddress).toBe('192.168.50.1');
  });

  it('an IP-literal refusal still names the literal: the caller wrote it, nothing is disclosed', async () => {
    guardTransport();
    await expect(hardenedFetch('http://10.0.0.1/', POLICY)).rejects.toThrow('SSRF rejected: hostname "10.0.0.1" is blocked');
  });
});

// ---------------------------------------------------------------------------
// G7: RFC 6761 localhost names are refused before DNS
// ---------------------------------------------------------------------------

describe('G7: localhost., *.localhost and *.localhost. are blocked before DNS', () => {
  const BLOCKED = [
    'localhost.', 'LOCALHOST.', 'localhost..', 'foo.localhost', 'FOO.LocalHost', 'foo.localhost.',
    'a.b.c.localhost', 'xn--bcher-kva.localhost', 'ip6-localhost.', 'ip6-loopback.',
  ];
  const NOT_BLOCKED = [
    'localhost.public.example', 'localhost.example.com.', 'notlocalhost', 'mylocalhost.', 'localhostx',
    'localhost-x.example', 'foo.localhost.example', 'example.com.', 'localdomain', 'local',
  ];

  for (const h of BLOCKED) {
    it(`isBlockedHost(${JSON.stringify(h)}) is true`, () => expect(isBlockedHost(h)).toBe(true));
  }
  for (const h of NOT_BLOCKED) {
    it(`isBlockedHost(${JSON.stringify(h)}) is false (an ordinary name, left to DNS)`, () =>
      expect(isBlockedHost(h)).toBe(false));
  }

  const URLS: Array<[string, string]> = [
    ['http://localhost./', 'localhost.'],
    ['http://LOCALHOST./admin', 'localhost.'],
    ['http://foo.localhost/', 'foo.localhost'],
    ['http://foo.localhost.:8080/x', 'foo.localhost.'],
    ['http://Api.Dev.LocalHost/', 'api.dev.localhost'],
    ['http://ⓕoo.ⓛocalhost/', 'foo.localhost'],  // IDNA mapping happens in new URL()
  ];
  for (const [url, hostname] of URLS) {
    it(`hardenedFetch(${JSON.stringify(url)}) is refused before DNS, even if DNS would answer a public address`, async () => {
      guardTransport();
      lookup.mockResolvedValue(PUBLIC as never);
      await expect(hardenedFetch(url, POLICY)).rejects.toThrow(`SSRF rejected: hostname "${hostname}" is blocked`);
      expect(lookup).not.toHaveBeenCalled();
      expect(transport.request).not.toHaveBeenCalled();
    });
  }

  it('a redirect to a *.localhost name is refused at that hop, before its DNS lookup', async () => {
    lookup.mockResolvedValue(PUBLIC as never);
    const spy = vi.spyOn(transport, 'request').mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: 'http://evil.localhost/' } }));
    await expect(hardenedFetch('https://public.example/', POLICY)).rejects.toThrow('SSRF rejected: hostname "evil.localhost" is blocked');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a public name with a localhost label elsewhere is still fetched', async () => {
    lookup.mockResolvedValue(PUBLIC as never);
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok'));
    await expect(hardenedFetch('http://localhost.public.example/', POLICY)).resolves.toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// G7: URLs in error messages are redacted
// ---------------------------------------------------------------------------

describe('G7: a URL in an error message has its userinfo, query and fragment redacted', () => {
  const SECRETS = ['s3cret', 'alice', 'tok123', 'frag456'];

  /** Fails the test if anything tries to open a socket. */
  function connectTripwire(): () => number {
    const spy = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket) {
      process.nextTick(() => this.destroy(new Error('test: connect attempted')));
      return this;
    } as never);
    return () => spy.mock.calls.length;
  }

  beforeEach(() => {
    lookup.mockResolvedValue(PUBLIC as never);
  });

  const INVALID: Array<[string, string]> = [
    ['http://alice:s3cret@[::1/x?token=tok123#frag456', 'Invalid URL: http://<redacted>@[::1/x?<redacted>'],
    ['http://alice:s3cret@example.com:99999/', 'Invalid URL: http://<redacted>@example.com:99999/'],
    // A password with '?' or '/' in it breaks the parse; the whole userinfo still goes.
    ['http://alice:s3c?ret@example.com:1/', 'Invalid URL: http://<redacted>@example.com:1/'],
    ['http://alice:s3/cret@example.com:99999/', 'Invalid URL: http://<redacted>@example.com:99999/'],
    ['http://exa mple.com/?token=tok123', 'Invalid URL: http://exa mple.com/?<redacted>'],
    ['http://exa mple.com/#frag456', 'Invalid URL: http://exa mple.com/#<redacted>'],
    ['not a url', 'Invalid URL: not a url'],
  ];
  for (const [input, message] of INVALID) {
    it(`Invalid URL ${JSON.stringify(input)}: the message is ${JSON.stringify(message)}`, async () => {
      guardTransport();
      const err = await rejection(hardenedFetch(input, POLICY));
      expect(err.constructor).toBe(Error);
      expect(err.message).toBe(message);
      for (const secret of SECRETS) expect(err.message).not.toContain(secret);
    });
  }

  it('credentials in the URL: the transport refuses with fetch()\'s TypeError, the URL redacted, no connect', async () => {
    const connects = connectTripwire();
    const err = await rejection(hardenedFetch('http://alice:s3cret@creds.example/p?token=tok123#frag456', POLICY));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe(
      'Request cannot be constructed from a URL that includes credentials: http://<redacted>@creds.example/p?<redacted>#<redacted>',
    );
    for (const text of renderings(err)) for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(connects()).toBe(0);
  });

  it('a username alone is redacted too', async () => {
    const connects = connectTripwire();
    const err = await rejection(hardenedFetch('https://alice@creds.example/', POLICY));
    expect(err.message).toBe('Request cannot be constructed from a URL that includes credentials: https://<redacted>@creds.example/');
    expect(connects()).toBe(0);
  });

  it('credentials in a redirect Location are redacted the same way', async () => {
    const connects = connectTripwire();
    vi.spyOn(transport, 'request').mockImplementationOnce(async () =>
      new Response(null, { status: 302, headers: { location: 'http://alice:s3cret@next.example/?token=tok123' } }));
    const err = await rejection(hardenedFetch('https://public.example/', POLICY));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe('Request cannot be constructed from a URL that includes credentials: http://<redacted>@next.example/?<redacted>');
    expect(connects()).toBe(0);
  });

  it('an unparseable redirect Location: a TypeError whose message and properties are redacted', async () => {
    // new URL() alone throws Node's TypeError('Invalid URL') with enumerable `input`
    // and `base` properties: the raw Location and the current URL, query included.
    vi.spyOn(transport, 'request').mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: 'http://alice:s3cret@[::1/?token=tok123' } }));
    const err = await rejection(hardenedFetch('https://public.example/start?session=frag456', POLICY));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe('Invalid redirect Location: http://<redacted>@[::1/?<redacted>');
    for (const text of renderings(err)) for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it('pinnedRequest: an unparseable URL is reported redacted', async () => {
    const err = await rejection(pinnedRequest('http://alice:s3cret@[::1/?token=tok123', {
      signal: new AbortController().signal, addresses: PUBLIC,
    }));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe('Failed to parse URL from http://<redacted>@[::1/?<redacted>');
    // Node's ERR_INVALID_URL is not kept as the cause: its `input` is the raw URL.
    for (const text of renderings(err)) for (const secret of SECRETS) expect(text).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
// PR-07: the declared Node range is the tested one
// ---------------------------------------------------------------------------

describe('PR-07: engines.node', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as
    { engines?: { node?: string } };

  it('is >=22, the extraction plan\'s runtime floor (Node 18 and 20 are end of life)', () => {
    expect(pkg.engines?.node).toBe('>=22');
  });

  it('this test run is inside that range', () => {
    expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(22);
  });
});
