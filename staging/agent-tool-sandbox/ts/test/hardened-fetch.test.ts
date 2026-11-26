/**
 * hardenedFetch behaviour: success path, redirects, policy options, errors,
 * plus pinned KNOWN GAPS (current behaviour that is not a guarantee; see
 * README "Not covered"). A fix for a gap should flip its pinned test on
 * purpose.
 *
 * Network-free: DNS via vi.mock, fetch via vi.spyOn.
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

const POLICY: FetchPolicy = { timeoutMs: 5_000, maxBytes: 1024 };
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const lookup = vi.mocked(dnsModule.lookup);

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

beforeEach(() => {
  lookup.mockResolvedValue(PUBLIC as never);
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
  it('returns the decoded body and calls fetch with redirect: manual and a signal', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('héllo', { status: 200 }));
    await expect(hardenedFetch('https://example.com/a?b=1', POLICY)).resolves.toBe('héllo');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://example.com/a?b=1');
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts a body of exactly maxBytes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('x'.repeat(16), { status: 200 }));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxBytes: 16 })).resolves.toBe('x'.repeat(16));
  });

  it('rejects maxBytes + 1', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('x'.repeat(17), { status: 200 }));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxBytes: 16 }))
      .rejects.toThrow('Response exceeds 16 bytes');
  });
});

describe('redirects', () => {
  it('follows a relative redirect and re-resolves DNS for the new hop', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
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
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(redirect('https://internal.example/'));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow(/blocked range/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('caps hops at maxRedirects', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => redirect('https://example.com/loop'));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxRedirects: 2 }))
      .rejects.toThrow('Too many redirects (>2)');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('defaults to MAX_REDIRECTS hops', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => redirect('https://example.com/loop'));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow(`Too many redirects (>${MAX_REDIRECTS})`);
    expect(fetchSpy).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it('maxRedirects: 0 refuses the first redirect', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => redirect('https://example.com/x'));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxRedirects: 0 }))
      .rejects.toThrow('Too many redirects (>0)');
  });

  it('rejects a 3xx with no Location header', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 301 }));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow('Redirect with no Location header (status 301)');
  });

  it("protocols: ['https'] blocks an https-to-http downgrade redirect", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => redirect('http://example.com/'));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, protocols: ['https'] }))
      .rejects.toThrow(/Protocol rejected: http:/);
  });

  it('rejects a redirect to a non-http(s) scheme', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => redirect('file:///etc/passwd'));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow(/Protocol rejected: file:/);
  });

  it('time budget spans hops: a slow first hop exhausts it before the second', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(redirect('https://example.com/2')), 60)),
    );
    await expect(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 30 }))
      .rejects.toThrow('Fetch timeout: exceeded 30ms budget');
  });
});

describe('allowedHosts', () => {
  const policy: FetchPolicy = { ...POLICY, allowedHosts: new Set(['api.example.com']) };

  it('rejects an off-list host before DNS', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(hardenedFetch('https://other.example.com/', policy)).rejects.toThrow('Host not in allowlist: "other.example.com"');
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows a listed host (hostname is lowercased by the URL parser)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok', { status: 200 }));
    await expect(hardenedFetch('https://API.Example.COM/', policy)).resolves.toBe('ok');
  });

  it('is an exact match: a trailing-dot FQDN is not on the list', async () => {
    await expect(hardenedFetch('https://api.example.com./', policy)).rejects.toThrow('Host not in allowlist');
  });

  it('applies to redirect hops', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => redirect('https://evil.example/'));
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('nope', { status: 500 }));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow('HTTP 500 from example.com');
  });

  it('propagates non-abort fetch errors unchanged', async () => {
    const boom = new TypeError('fetch failed');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(boom);
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toBe(boom);
  });

  it('rejects a zero time budget before doing anything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 0 })).rejects.toThrow('Fetch timeout');
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// KNOWN GAPS: pinned current behaviour, not guarantees. See README.
// ---------------------------------------------------------------------------

describe('KNOWN GAPS (pinned)', () => {
  it('NAT64 64:ff9b::/96 with an embedded private IPv4 is NOT blocked', () => {
    // 64:ff9b::a9fe:a9fe embeds 169.254.169.254; 64:ff9b::a00:1 embeds 10.0.0.1.
    expect(isBlockedHost('[64:ff9b::a9fe:a9fe]')).toBe(false);
    expect(() => validateResolvedAddresses([{ address: '64:ff9b::a00:1', family: 6 }])).not.toThrow();
  });

  it('6to4 2002::/16 with an embedded private IPv4 is NOT blocked', () => {
    expect(isBlockedHost('[2002:a9fe:a9fe::1]')).toBe(false);
  });

  it('deprecated site-local fec0::/10 is NOT blocked', () => {
    expect(isBlockedHost('[fec0::1]')).toBe(false);
  });

  it('localhost. (trailing dot) and *.localhost pass the literal check and rely on DNS', () => {
    expect(isBlockedHost('localhost.')).toBe(false);
    expect(isBlockedHost('foo.localhost')).toBe(false);
  });

  it('DNS rebinding window: fetch() receives the hostname URL and resolves it again itself', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok', { status: 200 }));
    await hardenedFetch('https://rebind.example/', POLICY);
    // Validation used lookup(); the connection is made by fetch() from the
    // hostname, not the validated address, so a second, different DNS answer
    // is never checked.
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://rebind.example/');
  });

  it('the time budget does not cover the body read', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
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
    await expect(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 30 })).resolves.toBe('late');
  });

  it('the default protocol list allows an https-to-http downgrade redirect', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirect('http://example.com/plain'))
      .mockResolvedValueOnce(new Response('plaintext', { status: 200 }));
    await expect(hardenedFetch('https://example.com/', POLICY)).resolves.toBe('plaintext');
  });
});
