/**
 * SSRF bypass corpus, ported from AlienClaw test/ssrf-vectors.test.ts.
 *
 * Network-free: node:dns/promises is replaced by vi.mock, and the internal
 * HTTP `transport` seam (globalThis.fetch until connection pinning replaced
 * it) is stubbed in every test that gets past URL validation, with a
 * throwing guard in beforeEach for the rest.
 *
 * Port changes vs the in-tree file:
 *   - '[::])' typo fixed to '[::]' (the typo passed only because unparseable
 *     IPv6 fails closed).
 *   - The four "canonicalised obfuscated IPv4" cases asserted the literal
 *     '127.0.0.1' four times; they now run the obfuscated form through
 *     new URL() first, which is what hardenedFetch does.
 *   - The resolver construction test uses example.com instead of the
 *     AlienClaw API host.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as dnsModule from 'node:dns/promises';
import {
  isBlockedHost,
  validateResolvedAddresses,
  hardenedFetch,
  type FetchPolicy,
  type ResolvedAddress,
} from '../src/index.js';
import { transport } from '../src/pinned-request.js';

const POLICY: FetchPolicy = {
  timeoutMs: 5_000,
  maxBytes:  64 * 1024,
  protocols: ['https', 'http'],
};

const lookup = vi.mocked(dnsModule.lookup);

function dnsAnswers(addrs: ResolvedAddress[]): void {
  lookup.mockResolvedValue(addrs as never);
}

function expectBlocked(hostname: string): void {
  expect(isBlockedHost(hostname)).toBe(true);
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}

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

// ---------------------------------------------------------------------------
// isBlockedHost: literal-address corpus
// ---------------------------------------------------------------------------

describe('isBlockedHost: IPv6 literals', () => {
  it('rejects loopback ::1', () => expectBlocked('[::1]'));
  it('rejects link-local fe80::1', () => expectBlocked('[fe80::1]'));
  it('rejects ULA fc00::1', () => expectBlocked('[fc00::1]'));
  it('rejects unspecified ::', () => expectBlocked('[::]'));
  it('rejects IPv4-mapped hex form of 169.254.169.254 (::ffff:a9fe:a9fe)', () =>
    expectBlocked('[::ffff:a9fe:a9fe]'));
  it('rejects IPv4-mapped ::ffff:127.0.0.1', () => expectBlocked('[::ffff:127.0.0.1]'));
  it('rejects fd00::/8 ULA (fdaa::1)', () => expectBlocked('[fdaa::1]'));
  it('rejects AWS IMDS IPv6 endpoint fd00:ec2::254 (ULA)', () => expectBlocked('[fd00:ec2::254]'));
  it('rejects multicast ff02::1', () => expectBlocked('[ff02::1]'));
  it('rejects unbracketed IPv6 (::1)', () => expectBlocked('::1'));
  it('fails closed on unparseable IPv6 ([::1:::])', () => expectBlocked('[::1:::]'));
});

describe('isBlockedHost: IPv4-translated 4-group suffix (PKT-1079 corpus gap)', () => {
  it('rejects ::ffff:0:0:1 (IPv4-translated 0.0.0.1)', () => expectBlocked('[::ffff:0:0:1]'));
  it('rejects ::ffff:0:7f00:1 (IPv4-translated 127.0.0.1)', () => expectBlocked('[::ffff:0:7f00:1]'));
  it('rejects ::ffff:0:a9fe:a9fe (IPv4-translated 169.254.169.254)', () =>
    expectBlocked('[::ffff:0:a9fe:a9fe]'));
  it('rejects ::ffff:0:a00:1 (IPv4-translated 10.0.0.1)', () => expectBlocked('[::ffff:0:a00:1]'));
  it('rejects ::ffff:0:c0a8:101 (IPv4-translated 192.168.1.1)', () =>
    expectBlocked('[::ffff:0:c0a8:101]'));
  it('rejects ::ffff:0:ffff:ffff (IPv4-translated 255.255.255.255)', () =>
    expectBlocked('[::ffff:0:ffff:ffff]'));
  it('rejects dotted ::ffff:0:127.0.0.1 form', () => expectBlocked('[::ffff:0:127.0.0.1]'));
  it('rejects the URL-canonicalised form of [::ffff:0:127.0.0.1]', () => {
    expect(hostOf('http://[::ffff:0:127.0.0.1]/')).toBe('[::ffff:0:7f00:1]');
    expectBlocked(hostOf('http://[::ffff:0:127.0.0.1]/'));
  });
});

describe('isBlockedHost: mapped/translated checks must not over-block (PKT-1079 safety)', () => {
  it('accepts Google DNS 2001:4860:4860::8888', () =>
    expect(isBlockedHost('[2001:4860:4860::8888]')).toBe(false));
  it('accepts ::1:ffff:0:0 (ffff at pos 5, groups[4]=1)', () =>
    expect(isBlockedHost('[::1:ffff:0:0]')).toBe(false));
  it('accepts Cloudflare DNS 2606:4700:4700::1111', () =>
    expect(isBlockedHost('[2606:4700:4700::1111]')).toBe(false));
});

describe('isBlockedHost: IPv4 literals', () => {
  it('rejects loopback 127.0.0.1', () => expectBlocked('127.0.0.1'));
  it('rejects RFC1918 10.0.0.1', () => expectBlocked('10.0.0.1'));
  it('rejects RFC1918 172.16.0.1', () => expectBlocked('172.16.0.1'));
  it('rejects RFC1918 192.168.1.1', () => expectBlocked('192.168.1.1'));
  it('rejects cloud metadata 169.254.169.254', () => expectBlocked('169.254.169.254'));
  it('rejects CGNAT 100.64.0.1', () => expectBlocked('100.64.0.1'));
  it('rejects 0.0.0.0', () => expectBlocked('0.0.0.0'));
  it('rejects benchmarking 198.18.0.1', () => expectBlocked('198.18.0.1'));
  it('rejects IETF 192.0.0.1', () => expectBlocked('192.0.0.1'));
  it('rejects multicast 224.0.0.1', () => expectBlocked('224.0.0.1'));
  it('rejects broadcast 255.255.255.255', () => expectBlocked('255.255.255.255'));
  it('accepts public 93.184.216.34', () => expect(isBlockedHost('93.184.216.34')).toBe(false));
});

describe('isBlockedHost: hostname tokens', () => {
  it('rejects localhost', () => expectBlocked('localhost'));
  it('rejects LOCALHOST (case-insensitive)', () => expectBlocked('LOCALHOST'));
  it('rejects ip6-localhost', () => expectBlocked('ip6-localhost'));
  it('rejects ip6-loopback', () => expectBlocked('ip6-loopback'));
  it('rejects empty string', () => expectBlocked(''));
  it('leaves ordinary DNS names to the post-DNS check', () =>
    expect(isBlockedHost('example.com')).toBe(false));
});

// ---------------------------------------------------------------------------
// Obfuscated IPv4 through the WHATWG URL parser (what hardenedFetch sees)
// ---------------------------------------------------------------------------

describe('isBlockedHost: obfuscated IPv4 after new URL() canonicalisation', () => {
  const cases: Array<[string, string]> = [
    ['http://0177.0.0.1/', 'octal'],
    ['http://2130706433/', 'decimal'],
    ['http://0x7f000001/', 'hex'],
    ['http://0x7f.1/', 'hex short-form'],
    ['http://127.1/', 'short-form'],
    ['http://017700000001/', 'octal 32-bit'],
    ['http://0x7f.0x0.0x0.0x1/', 'dotted hex'],
    ['http://127.0.0.1./', 'trailing dot'],
    ['http://１２７.０.０.１/', 'fullwidth digits (IDNA mapping)'],
  ];
  for (const [url, label] of cases) {
    it(`rejects ${label}: ${url}`, () => {
      expect(hostOf(url)).toBe('127.0.0.1');
      expectBlocked(hostOf(url));
    });
  }
  it('rejects http://0/ (canonicalises to 0.0.0.0)', () => {
    expect(hostOf('http://0/')).toBe('0.0.0.0');
    expectBlocked(hostOf('http://0/'));
  });
  it('rejects IDNA-mapped localhost (U+24DB circled l)', () => {
    expect(hostOf('http://ⓛocalhost/')).toBe('localhost');
    expectBlocked(hostOf('http://ⓛocalhost/'));
  });
  it('userinfo does not hide the real host', () => {
    expectBlocked(hostOf('http://evil.com@169.254.169.254/'));
    expectBlocked(hostOf('http://user:pass@127.0.0.1/'));
    expectBlocked(hostOf('http://169.254.169.254#@evil.com/'));
  });
  it('raw (un-canonicalised) obfuscated forms are NOT classified: callers must pass URL.hostname', () => {
    // Documents the input contract: isBlockedHost expects WHATWG-canonical
    // hostnames. hardenedFetch always canonicalises first.
    expect(isBlockedHost('0177.0.0.1')).toBe(false);
    expect(isBlockedHost('2130706433')).toBe(false);
    expect(isBlockedHost('0x7f000001')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateResolvedAddresses
// ---------------------------------------------------------------------------

describe('validateResolvedAddresses', () => {
  it('rejects IPv4 10.0.0.1', () =>
    expect(() => validateResolvedAddresses([{ address: '10.0.0.1', family: 4 }])).toThrow('blocked range'));
  it('rejects IPv4 127.0.0.1', () =>
    expect(() => validateResolvedAddresses([{ address: '127.0.0.1', family: 4 }])).toThrow('blocked range'));
  it('rejects IPv4 169.254.169.254', () =>
    expect(() => validateResolvedAddresses([{ address: '169.254.169.254', family: 4 }])).toThrow('blocked range'));
  it('rejects IPv6 ::1', () =>
    expect(() => validateResolvedAddresses([{ address: '::1', family: 6 }])).toThrow('blocked range'));
  it('rejects IPv6 fe80::1', () =>
    expect(() => validateResolvedAddresses([{ address: 'fe80::1', family: 6 }])).toThrow('blocked range'));
  it('rejects IPv6 ::ffff:a9fe:a9fe', () =>
    expect(() => validateResolvedAddresses([{ address: '::ffff:a9fe:a9fe', family: 6 }])).toThrow('blocked range'));
  it('rejects IPv6 ::ffff:0:a9fe:a9fe (PKT-1079)', () =>
    expect(() => validateResolvedAddresses([{ address: '::ffff:0:a9fe:a9fe', family: 6 }])).toThrow('blocked range'));
  it('rejects IPv6 ::ffff:0:7f00:1 (PKT-1079)', () =>
    expect(() => validateResolvedAddresses([{ address: '::ffff:0:7f00:1', family: 6 }])).toThrow('blocked range'));
  it('rejects a mixed answer where only one address is private', () =>
    expect(() => validateResolvedAddresses([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])).toThrow('blocked range'));
  it('rejects an unparseable family-4 address (fail closed)', () =>
    expect(() => validateResolvedAddresses([{ address: 'not-an-ip', family: 4 }])).toThrow('blocked range'));
  it('rejects an unknown address family', () =>
    expect(() => validateResolvedAddresses([{ address: '1.1.1.1', family: 0 }])).toThrow('unknown address family'));
  it('rejects empty address list', () =>
    expect(() => validateResolvedAddresses([])).toThrow('no addresses'));
  it('accepts public 1.1.1.1', () =>
    expect(() => validateResolvedAddresses([{ address: '1.1.1.1', family: 4 }])).not.toThrow());
  it('accepts public 2001:4860:4860::8888', () =>
    expect(() => validateResolvedAddresses([{ address: '2001:4860:4860::8888', family: 6 }])).not.toThrow());
});

// ---------------------------------------------------------------------------
// hardenedFetch: rejection corpus (stubbed fetch + DNS)
// ---------------------------------------------------------------------------

describe('hardenedFetch: protocol allowlist', () => {
  for (const url of ['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/', 'data:text/plain,hello']) {
    it(`rejects ${url}`, async () => {
      const fetchSpy = vi.spyOn(transport, 'request');
      await expect(hardenedFetch(url, POLICY)).rejects.toThrow(/Protocol rejected/);
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }
});

describe('hardenedFetch: blocked literal hostnames (rejected before DNS)', () => {
  const urls = [
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:0:127.0.0.1]/',
    'http://[::ffff:0:a9fe:a9fe]/',
    'http://localhost/',
    'http://0177.0.0.1/',
    'http://2130706433/',
    'http://169.254.169.254/latest/meta-data/',
  ];
  for (const url of urls) {
    it(`rejects ${url}`, async () => {
      const fetchSpy = vi.spyOn(transport, 'request');
      await expect(hardenedFetch(url, POLICY)).rejects.toThrow(/SSRF rejected.*is blocked/);
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }
});

describe('hardenedFetch: hostname resolves to private IP (stubbed DNS)', () => {
  it('rejects hostname that DNS resolves to 10.0.0.1', async () => {
    dnsAnswers([{ address: '10.0.0.1', family: 4 }]);
    const fetchSpy = vi.spyOn(transport, 'request');
    await expect(hardenedFetch('https://totally-legit-host.example/', POLICY))
      .rejects.toThrow(/SSRF rejected.*blocked range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects hostname that DNS resolves to an IPv4-mapped loopback', async () => {
    dnsAnswers([{ address: '::ffff:127.0.0.1', family: 6 }]);
    await expect(hardenedFetch('https://rebind.example/', POLICY))
      .rejects.toThrow(/SSRF rejected.*blocked range/i);
  });
});

describe('hardenedFetch: 302 redirect to blocked address (stubbed fetch + DNS)', () => {
  beforeEach(() => {
    dnsAnswers([{ address: '93.184.216.34', family: 4 }]);
  });
  it('rejects 302 redirect to 169.254.169.254 (cloud metadata)', async () => {
    const fetchSpy = vi.spyOn(transport, 'request').mockImplementation(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    }));
    await expect(hardenedFetch('https://example.com/', POLICY)).rejects.toThrow(/SSRF rejected|blocked/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('hardenedFetch: response size cap (stubbed)', () => {
  it('rejects response that exceeds maxBytes', async () => {
    dnsAnswers([{ address: '93.184.216.34', family: 4 }]);
    vi.spyOn(transport, 'request').mockImplementation(async () =>
      new Response(new Uint8Array(120).fill(65), { status: 200 }));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, maxBytes: 100 }))
      .rejects.toThrow(/exceeds.*bytes/i);
  });
});

describe('hardenedFetch: timeout', () => {
  it('rejects when the request exceeds the time budget', async () => {
    dnsAnswers([{ address: '93.184.216.34', family: 4 }]);
    vi.spyOn(transport, 'request').mockImplementation((_url, opts) =>
      new Promise((_resolve, reject) => {
        const signal = opts.signal;
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }));
    await expect(hardenedFetch('https://example.com/', { ...POLICY, timeoutMs: 50 }))
      .rejects.toThrow(/timeout/i);
  });
});

describe('resolver construction', () => {
  it('hardenedFetch validates through dns.promises.lookup with { all: true }', async () => {
    dnsAnswers([{ address: '93.184.216.34', family: 4 }]);
    vi.spyOn(transport, 'request').mockImplementation(async () => new Response('ok', { status: 200 }));
    await expect(hardenedFetch('https://example.com/', POLICY)).resolves.toBe('ok');
    expect(lookup).toHaveBeenCalledWith('example.com', { all: true });
  });
});
