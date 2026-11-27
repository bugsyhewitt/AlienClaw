/**
 * hardenedFetch behaviour: success path, redirects, policy options, errors,
 * plus pinned KNOWN GAPS (current behaviour that is not a guarantee; see
 * README "Not covered"). A fix for a gap should flip its pinned test on
 * purpose. The NAT64, body-read, DNS-rebinding, 6to4, site-local and
 * localhost-name gaps were fixed on 2026-11-26 and their pinned tests
 * flipped into "fixed gaps" below;
 * test/hardening.test.ts has the full regression set for the first two and
 * for policy validation, test/pinning.test.ts for connection pinning.
 *
 * Network-free: DNS via vi.mock, the HTTP transport via vi.spyOn on the
 * internal `transport` seam (these tests stubbed globalThis.fetch until
 * connection pinning replaced fetch(); test/pinning.test.ts drives the real
 * transport).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as dnsModule from 'node:dns/promises';
import {
  DEFAULT_PROTOCOLS,
  MAX_REDIRECTS,
  hardenedFetch,
  isBlockedHost,
  validateResolvedAddresses,
  type FetchPolicy,
} from '../src/index.js';
import { transport } from '../src/pinned-request.js';

const POLICY: FetchPolicy = { timeoutMs: 5_000, maxBytes: 1024 };
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const lookup = vi.mocked(dnsModule.lookup);

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

beforeEach(() => {
  lookup.mockResolvedValue(PUBLIC as never);
  // Guard: no test may reach the real transport (and so the network).
  // Tests that expect a request re-stub it (vi.spyOn reuses this spy).
  vi.spyOn(transport, 'request').mockImplementation(async () => {
    throw new Error('test: unexpected real request');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  lookup.mockReset();
});

describe('defaults', () => {
  it('exports the documented defaults', () => {
    expect([...DEFAULT_PROTOCOLS]).toEqual(['https', 'http']);
    expect(MAX_REDIRECTS).toBe(5);
  });
});

describe('success path', () => {
  it('returns the decoded body and calls the transport with the validated addresses and a signal', async () => {
    const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response('héllo', { status: 200 }));
    await expect(hardenedFetch('https://example.com/a?b=1', POLICY)).resolves.toBe('héllo');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://example.com/a?b=1');
    expect(init.addresses).toEqual(PUBLIC);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts a body of exactly maxBytes', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response('x'.repeat(16), { status: 200 }));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxBytes: 16 })).resolves.toBe('x'.repeat(16));
  });

  it('rejects maxBytes + 1', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response('x'.repeat(17), { status: 200 }));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxBytes: 16 }))
      .rejects.toThrow('Response exceeds 16 bytes');
  });
});

describe('redirects', () => {
  it('follows a relative redirect and re-resolves DNS for the new hop', async () => {
    const fetchSpy = vi.spyOn(transport, 'request')
      .mockResolvedValueOnce(redirect('/next'))
      .mockResolvedValueOnce(new Response('done', { status: 200 }));
    await expect(hardenedFetch('https://example.com/start', POLICY)).resolves.toBe('done');
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual(['https://example.com/start', 'https://example.com/next']);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('re-validates DNS on each hop (second hop resolves private)', async () => {
    lookup
      .mockResolvedValueOnce(PUBLIC as never)
      .mockResolvedValueOnce([{ address: '10.1.2.3', family: 4 }] as never);
    const fetchSpy = vi.spyOn(transport, 'request').mockResolvedValueOnce(redirect('https://internal.example/'));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow(/blocked range/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('caps hops at maxRedirects', async () => {
    const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => redirect('https://example.com/loop'));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxRedirects: 2 }))
      .rejects.toThrow('Too many redirects (>2)');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('defaults to MAX_REDIRECTS hops', async () => {
    const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => redirect('https://example.com/loop'));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow(`Too many redirects (>${MAX_REDIRECTS})`);
    expect(fetchSpy).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it('maxRedirects: 0 refuses the first redirect', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => redirect('https://example.com/x'));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxRedirects: 0 }))
      .rejects.toThrow('Too many redirects (>0)');
  });

  it('rejects a 3xx with no Location header', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response(null, { status: 301 }));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow('Redirect with no Location header (status 301)');
  });

  it("protocols: ['https'] blocks an https-to-http downgrade redirect", async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => redirect('http://example.com/'));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, protocols: ['https'] }))
      .rejects.toThrow(/Protocol rejected: http:/);
  });

  it('rejects a redirect to a non-http(s) scheme', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => redirect('file:///etc/passwd'));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow(/Protocol rejected: file:/);
  });

  it('time budget spans hops: a slow first hop exhausts it before the second', async () => {
    vi.spyOn(transport, 'request').mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(redirect('https://example.com/2')), 60)),
    );
    await expect(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 30 }))
      .rejects.toThrow('Fetch timeout: exceeded 30ms budget');
  });
});

describe('allowedHosts', () => {
  const policy: FetchPolicy = { ...POLICY, allowedHosts: new Set(['api.example.com']) };

  it('rejects an off-list host before DNS', async () => {
    const fetchSpy = vi.spyOn(transport, 'request');
    await expect(hardenedFetch('https://other.example.com/', policy)).rejects.toThrow('Host not in allowlist: "other.example.com"');
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows a listed host (hostname is lowercased by the URL parser)', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok', { status: 200 }));
    await expect(hardenedFetch('https://API.Example.COM/', policy)).resolves.toBe('ok');
  });

  it('is an exact match: a trailing-dot FQDN is not on the list', async () => {
    await expect(hardenedFetch('https://api.example.com./', policy)).rejects.toThrow('Host not in allowlist');
  });

  it('applies to redirect hops', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => redirect('https://evil.example/'));
    await expect(hardenedFetch('https://api.example.com/', policy)).rejects.toThrow('Host not in allowlist: "evil.example"');
  });

  it('still runs the block list and DNS check for listed hosts', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(hardenedFetch('https://api.example.com/', policy)).rejects.toThrow(/blocked range/);
  });
});

describe('errors', () => {
  it('rejects an unparseable URL', async () => {
    await expect(hardenedFetch('not a url', POLICY)).rejects.toThrow('Invalid URL: not a url');
  });

  it('wraps DNS failures', async () => {
    lookup.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(hardenedFetch('https://nx.example/', POLICY))
      .rejects.toThrow('DNS resolution failed for "nx.example": getaddrinfo ENOTFOUND');
  });

  it('rejects an empty DNS answer', async () => {
    lookup.mockResolvedValue([] as never);
    await expect(hardenedFetch('https://empty.example/', POLICY)).rejects.toThrow('DNS returned no addresses');
  });

  it('rejects non-2xx final responses', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response('nope', { status: 500 }));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow('HTTP 500 from example.com');
  });

  it('propagates non-abort fetch errors unchanged', async () => {
    const boom = new TypeError('fetch failed');
    vi.spyOn(transport, 'request').mockRejectedValue(boom);
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toBe(boom);
  });

  it('rejects a zero time budget as an invalid policy before doing anything', async () => {
    const fetchSpy = vi.spyOn(transport, 'request');
    await expect(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 0 }))
      .rejects.toThrow(/^Invalid FetchPolicy: timeoutMs must be an integer from 1 to 2147483647 \(got 0\)$/);
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fixed gaps: these were pinned under KNOWN GAPS until 2026-11-26.
// ---------------------------------------------------------------------------

describe('fixed gaps (formerly pinned)', () => {
  it('NAT64 64:ff9b::/96 with an embedded private IPv4 is blocked', () => {
    // 64:ff9b::a9fe:a9fe embeds 169.254.169.254; 64:ff9b::a00:1 embeds 10.0.0.1.
    expect(isBlockedHost('[64:ff9b::a9fe:a9fe]')).toBe(true);
    expect(() => validateResolvedAddresses([{ address: '64:ff9b::a00:1', family: 6 }])).toThrow(/blocked range/);
  });

  it('the time budget covers the body read', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode('late'));
            controller.close();
          }, 80);
        },
      }),
      { status: 200 },
    ));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 30 }))
      .rejects.toThrow('Fetch timeout: exceeded 30ms budget');
  });

  it('DNS rebinding window closed: DNS is asked once and the transport gets that validated answer', async () => {
    // Was "fetch() receives the hostname URL and resolves it again itself".
    // The transport now pins its socket to `addresses`; test/pinning.test.ts
    // asserts the real socket target.
    lookup.mockResolvedValueOnce(PUBLIC as never).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok', { status: 200 }));
    await expect(hardenedFetch('https://rebind.example/', POLICY)).resolves.toBe('ok');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://rebind.example/');
    expect(fetchSpy.mock.calls[0]![1].addresses).toEqual(PUBLIC);
  });

  it('an IPv6-literal URL is resolved without its brackets (was a guaranteed DNS failure)', async () => {
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response('v6', { status: 200 }));
    lookup.mockResolvedValue([{ address: '2001:4860:4860::8888', family: 6 }] as never);
    await expect(hardenedFetch('https://[2001:4860:4860::8888]/', POLICY)).resolves.toBe('v6');
    expect(lookup).toHaveBeenCalledWith('2001:4860:4860::8888', { all: true });
  });

  // Pinned as NOT blocked until 2026-11-26; test/corpus-gaps.test.ts has the full set.
  it('6to4 2002::/16 with an embedded private IPv4 is blocked (the whole /16 is)', () => {
    expect(isBlockedHost('[2002:a9fe:a9fe::1]')).toBe(true);
  });

  it('deprecated site-local fec0::/10 is blocked', () => {
    expect(isBlockedHost('[fec0::1]')).toBe(true);
  });

  // Pinned as "pass the literal check and rely on DNS" until 2026-11-26 (gate G7);
  // test/prepublication-gates.test.ts has the full set.
  it('localhost. (trailing dot) and *.localhost are blocked by the literal check, before DNS', () => {
    expect(isBlockedHost('localhost.')).toBe(true);
    expect(isBlockedHost('foo.localhost')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// KNOWN GAPS: pinned current behaviour, not guarantees. See README.
// ---------------------------------------------------------------------------

describe('KNOWN GAPS (pinned)', () => {
  // SR-14 (docs/salvage/SANDBOX-SECURITY-REVIEW.md): there is no port policy beyond
  // port 0 and the Fetch bad-port list, as README "Not covered" says.
  it('no port policy: a public host on a service port (6379, 9200) is fetched', async () => {
    const spy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok', { status: 200 }));
    await expect(hardenedFetch('http://example.com:6379/', POLICY)).resolves.toBe('ok');
    await expect(hardenedFetch('http://example.com:9200/', POLICY)).resolves.toBe('ok');
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['http://example.com:6379/', 'http://example.com:9200/']);
  });

  it('the default protocol list allows an https-to-http downgrade redirect', async () => {
    vi.spyOn(transport, 'request')
      .mockResolvedValueOnce(redirect('http://example.com/plain'))
      .mockResolvedValueOnce(new Response('plaintext', { status: 200 }));
    await expect(hardenedFetch('https://example.com/', POLICY)).resolves.toBe('plaintext');
  });
});
