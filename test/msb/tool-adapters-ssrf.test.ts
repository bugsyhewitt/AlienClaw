/**
 * SSRF hardening tests for the url_fetch tool adapter.
 *
 * The url_fetch adapter is the tool-execution-side outbound-fetch site — the
 * sibling of the governance fetch sites hardened in PR #46. Martian-driven
 * URLs are hostile input. These tests pin the security boundary:
 *
 *   1. assertSafeFetchUrl / isBlockedHost  — the pure guard primitives:
 *      private/loopback/link-local/metadata IP literals (incl. obfuscated and
 *      IPv4-mapped IPv6 forms) are blocked; off-allowlist + non-https rejected;
 *      the one allowed https host passes.
 *   2. urlFetchAdapter (via getToolAdapter) — adapter-level behavior: the guard
 *      runs before any fetch, the allowed host is canonicalised through, and a
 *      wired fetch fn is always invoked with redirect:'error'.
 *
 * Ship gate: private-IP and disallowed-host URLs rejected; allowed https host
 * passes; vitest green.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  assertSafeFetchUrl,
  isBlockedHost,
  ALLOWED_FETCH_HOSTS,
  wireToolAdapters,
} from '../../src/alienclaw/msb/tool-adapters.js';
import {
  getToolAdapter,
  type ToolFn,
} from '../../src/alienclaw/msb/martian-executor.js';

// ── ALLOWED_FETCH_HOSTS ─────────────────────────────────────────────────────

describe('ALLOWED_FETCH_HOSTS', () => {
  it('contains the AlienClaw API host and is a Set', () => {
    expect(ALLOWED_FETCH_HOSTS.has('api.alienclaw.net')).toBe(true);
  });

  it('does NOT contain look-alike / suffix-attack hosts', () => {
    expect(ALLOWED_FETCH_HOSTS.has('api.alienclaw-net.attacker.com')).toBe(false);
    expect(ALLOWED_FETCH_HOSTS.has('alienclaw.net')).toBe(false);
    expect(ALLOWED_FETCH_HOSTS.has('evil.api.alienclaw.net')).toBe(false);
  });
});

// ── isBlockedHost — IPv4 literals ───────────────────────────────────────────

describe('isBlockedHost — IPv4 private / loopback / link-local / metadata', () => {
  const blocked = [
    ['loopback 127.0.0.1', '127.0.0.1'],
    ['loopback /8 edge', '127.255.255.255'],
    ['cloud metadata', '169.254.169.254'],
    ['link-local /16', '169.254.0.1'],
    ['RFC1918 10/8', '10.0.0.5'],
    ['RFC1918 10/8 edge', '10.255.255.255'],
    ['RFC1918 172.16/12 low', '172.16.0.1'],
    ['RFC1918 172.16/12 high', '172.31.255.255'],
    ['IETF proto-assignments 192.0.0/24 low',  '192.0.0.1'],
    ['IETF proto-assignments 192.0.0/24 high', '192.0.0.255'],
    ['RFC1918 192.168/16', '192.168.1.1'],
    ['unspecified 0.0.0.0', '0.0.0.0'],
    ['0/8', '0.10.20.30'],
    ['CGNAT 100.64/10', '100.64.0.1'],
    ['CGNAT 100.64/10 high', '100.127.255.255'],
    ['benchmark 198.18/15', '198.18.0.1'],
    ['benchmark 198.19', '198.19.0.1'],
    ['multicast 224/4', '224.0.0.1'],
    ['multicast 239', '239.255.255.255'],
    ['reserved 240/4', '240.0.0.1'],
    ['broadcast', '255.255.255.255'],
  ] as const;

  for (const [label, host] of blocked) {
    it(`blocks ${label} (${host})`, () => {
      expect(isBlockedHost(host)).toBe(true);
    });
  }

  it('does NOT block a public IPv4 literal (allowlist handles those separately)', () => {
    expect(isBlockedHost('8.8.8.8')).toBe(false);
    expect(isBlockedHost('1.1.1.1')).toBe(false);
    expect(isBlockedHost('172.15.0.1')).toBe(false); // just below 172.16/12
    expect(isBlockedHost('172.32.0.1')).toBe(false); // just above 172.16/12
    expect(isBlockedHost('100.63.0.1')).toBe(false); // just below CGNAT
    expect(isBlockedHost('100.128.0.1')).toBe(false); // just above CGNAT
  });
});

// ── isBlockedHost — IPv6 literals (URL hostnames arrive bracketed) ──────────

describe('isBlockedHost — IPv6 private / loopback / link-local / mapped', () => {
  const blocked = [
    ['loopback ::1', '[::1]'],
    ['unspecified ::', '[::]'],
    ['link-local fe80::/10', '[fe80::1]'],
    ['link-local fe80 high', '[febf::1]'],
    ['unique-local fc00::/7', '[fc00::1]'],
    ['unique-local fd00', '[fd00::1]'],
    ['multicast ff00::/8', '[ff02::1]'],
    // IPv4-mapped IPv6 — Node canonicalises ::ffff:127.0.0.1 to ::ffff:7f00:1
    ['v4-mapped loopback', '[::ffff:127.0.0.1]'],
    ['v4-mapped metadata', '[::ffff:169.254.169.254]'],
    ['v4-mapped private', '[::ffff:10.0.0.1]'],
    // v4-mapped of a PUBLIC address is still blocked (mapped space refused wholesale)
    ['v4-mapped public still blocked', '[::ffff:8.8.8.8]'],
  ] as const;

  for (const [label, host] of blocked) {
    it(`blocks ${label} ${host}`, () => {
      expect(isBlockedHost(host)).toBe(true);
    });
  }

  it('blocks bracket-stripped/zone-id forms and fails closed on garbage', () => {
    expect(isBlockedHost('[fe80::1%25eth0]')).toBe(true); // zone id
    expect(isBlockedHost('[:::::]')).toBe(true);          // malformed IPv6 → fail closed
    expect(isBlockedHost('[gggg::1]')).toBe(true);        // non-hex → fail closed
  });

  it('does NOT block a public/global-unicast IPv6 literal', () => {
    expect(isBlockedHost('[2606:4700:4700::1111]')).toBe(false); // Cloudflare DNS
    expect(isBlockedHost('[2001:4860:4860::8888]')).toBe(false); // Google DNS
  });
});

// ── isBlockedHost — IPv6 non-compressed (full 8-hextet) form ────────────────

describe('isBlockedHost — IPv6 non-compressed (full 8-hextet) form', () => {
  it('blocks non-compressed loopback [0:0:0:0:0:0:0:1]', () => {
    expect(isBlockedHost('[0:0:0:0:0:0:0:1]')).toBe(true);
  });

  it('blocks non-compressed unique-local [fc00:0:0:0:0:0:0:1]', () => {
    expect(isBlockedHost('[fc00:0:0:0:0:0:0:1]')).toBe(true);
  });

  it('blocks non-compressed link-local [fe80:0:0:0:0:0:0:1]', () => {
    expect(isBlockedHost('[fe80:0:0:0:0:0:0:1]')).toBe(true);
  });

  it('does NOT block non-compressed global unicast [2606:4700:4700:0:0:0:0:1111]', () => {
    expect(isBlockedHost('[2606:4700:4700:0:0:0:0:1111]')).toBe(false);
  });

  it('fails closed on invalid hextet in non-compressed form [gggg:0:0:0:0:0:0:1]', () => {
    expect(isBlockedHost('[gggg:0:0:0:0:0:0:1]')).toBe(true);
  });
});

// ── isBlockedHost — explicit local hostnames + DNS names ────────────────────

describe('isBlockedHost — hostname tokens', () => {
  it('blocks localhost and ip6 aliases', () => {
    expect(isBlockedHost('localhost')).toBe(true);
    expect(isBlockedHost('LOCALHOST')).toBe(true); // case-insensitive
    expect(isBlockedHost('ip6-localhost')).toBe(true);
    expect(isBlockedHost('ip6-loopback')).toBe(true);
  });

  it('blocks an empty hostname (fail closed)', () => {
    expect(isBlockedHost('')).toBe(true);
  });

  it('does NOT block ordinary DNS names (allowlist is their gate)', () => {
    expect(isBlockedHost('api.alienclaw.net')).toBe(false);
    expect(isBlockedHost('example.com')).toBe(false);
  });
});

// ── assertSafeFetchUrl — full guard ─────────────────────────────────────────

describe('assertSafeFetchUrl', () => {
  it('accepts the canonical allowed https host', () => {
    expect(() => assertSafeFetchUrl('https://api.alienclaw.net/v1/health')).not.toThrow();
    const u = assertSafeFetchUrl('https://api.alienclaw.net/v1/genomes/top?martian_type=x&n=1');
    expect(u.hostname).toBe('api.alienclaw.net');
  });

  it('rejects non-https schemes', () => {
    expect(() => assertSafeFetchUrl('http://api.alienclaw.net/x')).toThrow(/non-https/);
    expect(() => assertSafeFetchUrl('ftp://api.alienclaw.net/x')).toThrow(/non-https/);
    expect(() => assertSafeFetchUrl('file:///etc/passwd')).toThrow(/non-https/);
    expect(() => assertSafeFetchUrl('gopher://api.alienclaw.net/x')).toThrow(/non-https/);
  });

  it('rejects malformed URLs', () => {
    expect(() => assertSafeFetchUrl('not a url')).toThrow(/malformed/);
    expect(() => assertSafeFetchUrl('')).toThrow(/malformed/);
  });

  it('rejects off-allowlist public hosts even over https', () => {
    expect(() => assertSafeFetchUrl('https://example.com/x')).toThrow(/off-allowlist/);
    expect(() => assertSafeFetchUrl('https://8.8.8.8/x')).toThrow(/off-allowlist/);
  });

  it('rejects the suffix-attack host (set lookup, not suffix match)', () => {
    expect(() => assertSafeFetchUrl('https://api.alienclaw-net.attacker.com/x'))
      .toThrow(/off-allowlist host: "api\.alienclaw-net\.attacker\.com"/);
  });

  // ── The ship-gate SSRF requirement: private-IP URLs rejected ──────────────
  it('rejects loopback, metadata, and RFC1918 IP-literal URLs with the SSRF message', () => {
    for (const url of [
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.5/x',
      'https://192.168.1.1/x',
      'https://172.16.0.1/x',
    ]) {
      expect(() => assertSafeFetchUrl(url)).toThrow(/private\/loopback\/link-local\/metadata/);
    }
  });

  it('rejects obfuscated loopback literals (decimal / hex / short-form)', () => {
    // Node's URL parser canonicalises all of these to 127.0.0.1.
    expect(() => assertSafeFetchUrl('https://2130706433/x')).toThrow(/private\/loopback/);
    expect(() => assertSafeFetchUrl('https://0x7f.0.0.1/x')).toThrow(/private\/loopback/);
    expect(() => assertSafeFetchUrl('https://127.1/x')).toThrow(/private\/loopback/);
  });

  it('rejects IPv4-mapped IPv6 loopback/metadata literals', () => {
    expect(() => assertSafeFetchUrl('https://[::ffff:127.0.0.1]/x')).toThrow(/private\/loopback/);
    expect(() => assertSafeFetchUrl('https://[::ffff:169.254.169.254]/x')).toThrow(/private\/loopback/);
    expect(() => assertSafeFetchUrl('https://[::1]/x')).toThrow(/private\/loopback/);
  });

  it('rejects localhost', () => {
    expect(() => assertSafeFetchUrl('https://localhost/x')).toThrow(/private\/loopback/);
    expect(() => assertSafeFetchUrl('https://localhost:8443/x')).toThrow(/private\/loopback/);
  });

  it('enforces the SSRF (IP) block BEFORE the allowlist check', () => {
    // A private IP is off-allowlist too, but the more specific SSRF message
    // must win — proving the IP block is the earlier gate.
    let msg = '';
    try { assertSafeFetchUrl('https://127.0.0.1/x'); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/private\/loopback\/link-local\/metadata/);
    expect(msg).not.toMatch(/off-allowlist/);
  });

  it('returns a parsed URL for an allowed host', () => {
    const u = assertSafeFetchUrl('https://api.alienclaw.net/a/b?c=d');
    expect(u).toBeInstanceOf(URL);
    expect(u.protocol).toBe('https:');
    expect(u.pathname).toBe('/a/b');
  });
});

// ── urlFetchAdapter (adapter-level, via the registry) ───────────────────────

describe('urlFetchAdapter via getToolAdapter', () => {
  let adapter: ToolFn;

  beforeEach(() => {
    wireToolAdapters(); // idempotent
    const a = getToolAdapter('url_fetch');
    if (!a) throw new Error('url_fetch adapter not registered');
    adapter = a;
  });

  it('rejects a private-IP URL before doing any fetch', async () => {
    await expect(adapter({ url: 'https://169.254.169.254/latest/meta-data/' }))
      .rejects.toThrow(/private\/loopback\/link-local\/metadata/);
  });

  it('rejects an off-allowlist host', async () => {
    await expect(adapter({ url: 'https://example.com/x' }))
      .rejects.toThrow(/off-allowlist/);
  });

  it('rejects a non-https URL', async () => {
    await expect(adapter({ url: 'http://api.alienclaw.net/x' }))
      .rejects.toThrow(/non-https/);
  });

  it('rejects a missing/empty url input', async () => {
    await expect(adapter({})).rejects.toThrow(/malformed|non-https/);
  });

  it('passes an allowed https host through and returns the canonicalised URL', async () => {
    // No OpenClaw fetch fn is wired in v0.1, so the adapter takes the stub path.
    // The key guarantee: an allowed URL is NOT rejected, and the returned url is
    // the canonicalised form produced by the guard (proving the guard ran).
    const out = (await adapter({ url: 'https://api.alienclaw.net/v1/health' })) as {
      url: string;
      statusCode: number;
      _stub?: boolean;
    };
    expect(out.url).toBe('https://api.alienclaw.net/v1/health');
    expect(out.statusCode).toBe(0);
    expect(out._stub).toBe(true);
  });

  it('does not leak a private-IP target into any output on rejection', async () => {
    // Belt-and-suspenders: rejection must throw, never return a result object.
    let result: unknown;
    let threw = false;
    try {
      result = await adapter({ url: 'https://10.1.2.3/secret' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(result).toBeUndefined();
  });
});

// ── redirect:'error' contract (transport-side) ──────────────────────────────
//
// In v0.1 the OpenClaw fetch fn is not yet wired (the adapter returns a stub),
// so we cannot observe the call from the public surface. We assert the contract
// at the source level: the url_fetch adapter must forward redirect:'error' to
// whatever fetch fn it delegates to, mirroring PR #46's hardenedFetch /
// NetworkAPIClient. This guards against a future wiring change silently dropping
// the redirect guard.

describe("redirect:'error' contract", () => {
  it('the adapter source forwards redirect:\'error\' to the delegated fetch fn', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const here = fileURLToPath(import.meta.url);
    const src = readFileSync(
      here.replace(/test\/msb\/tool-adapters-ssrf\.test\.ts$/, 'src/alienclaw/msb/tool-adapters.ts'),
      'utf8',
    );
    // The wired branch must hand redirect:'error' to the fetch fn.
    expect(src).toMatch(/_webFetchFn\(\s*\{[^}]*redirect:\s*'error'/s);
  });
});
