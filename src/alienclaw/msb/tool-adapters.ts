/**
 * tool-adapters.ts
 * Registers OpenClaw tool functions as Martian tool adapters.
 *
 * Call wireToolAdapters() once during bootstrap AFTER registry.load().
 *
 * Each adapter:
 *   1. Accepts a flat Record<string,unknown> from the Martian executor
 *   2. Delegates to the correct OpenClaw tool implementation
 *   3. Returns output matching the .msb OUTPUT CONTRACT
 *
 * File paths are scoped to ALIENCLAW_HOME/workspace/ for safety.
 *
 * SSRF DEFENSE (url_fetch):
 *   Martian-driven URLs are HOSTILE INPUT. The url_fetch adapter is the
 *   tool-execution-side outbound-fetch site — the sibling of the
 *   governance-side fetch sites hardened in PR #46 (leaderboard.ts,
 *   sync/client.ts). This file is intentionally disjoint from those, so the
 *   guard is reproduced here as a self-contained helper rather than imported,
 *   keeping the two hardening efforts independent and independently mergeable.
 *
 *   PR #46 established: HTTPS pin + host allowlist + redirect:'error'.
 *   The tool path adds, on top of that pattern, an explicit IP-LITERAL BLOCK
 *   so that loopback (127.0.0.0/8, ::1), link-local + cloud metadata
 *   (169.254.0.0/16 incl. 169.254.169.254), RFC1918 (10/8, 172.16/12,
 *   192.168/16), and other non-routable/internal ranges can never be reached —
 *   even by a literal address, an obfuscated literal (decimal/hex/short-form,
 *   which Node's URL parser canonicalises), or an IPv4-mapped IPv6 literal.
 */

import * as fsPromises  from 'node:fs/promises';
import * as path from 'node:path';

import { registerToolAdapter } from './martian-executor.js';
import type { ToolFn }         from './martian-executor.js';
import { PATHS, MAX_FILE_READ_BYTES } from '../constants.js';

const OUTPUT_DIR = PATHS.output;

// ---------------------------------------------------------------------------
// Path safety guard
// ---------------------------------------------------------------------------

function assertInsideBoundary(filePath: string, boundary: string): string {
  const resolved = path.resolve(boundary, filePath);
  const sep      = path.sep;
  if (!resolved.startsWith(boundary + sep) && resolved !== boundary) {
    throw new Error(
      `Path traversal rejected: "${filePath}" resolves outside boundary "${boundary}"`
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// SSRF guard for url_fetch (tool-execution-side outbound fetch)
//
// Ported pattern from PR #46 (assertPinnedUrl + allowlist + redirect:'error'),
// extended with an IP-literal block. Self-contained on purpose — see file
// header. Every export here is a pure, side-effect-free predicate/assertion so
// the security boundary can be unit-tested directly.
// ---------------------------------------------------------------------------

/**
 * Hosts the url_fetch tool is permitted to reach. Exact-hostname membership
 * (Set lookup, not suffix match) — `api.alienclaw-net.attacker.com` does NOT
 * match `api.alienclaw.net`. Kept identical in spirit to PR #46's
 * ALLOWED_LEADERBOARD_HOSTS; tool fetches have no reason to reach anything
 * other than the AlienClaw API surface.
 */
export const ALLOWED_FETCH_HOSTS: ReadonlySet<string> = new Set([
  'api.alienclaw.net',
]);

/**
 * Hostnames that are never IP literals but always denote a local/internal
 * endpoint. Blocked unconditionally so `https://localhost/...` cannot be used
 * to pivot to a service on the loopback interface.
 */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
]);

/**
 * Parse a strict dotted-quad IPv4 string into its four octets, or return
 * undefined if `s` is not a canonical dotted-quad. Node's URL parser
 * canonicalises decimal (2130706433), hex (0x7f.0.0.1) and short-form (127.1)
 * literals into dotted-quad form before we ever see them, so testing the
 * canonical hostname is sufficient to catch those obfuscations.
 */
function parseIpv4Octets(s: string): [number, number, number, number] | undefined {
  const parts = s.split('.');
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    // Reject empty, non-numeric, or out-of-range parts.
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number(part);
    if (n < 0 || n > 255) return undefined;
    octets.push(n);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

/**
 * True if a dotted-quad IPv4 falls in any non-routable / internal / dangerous
 * range that must never be reachable via a tool fetch.
 */
function isBlockedIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  // 0.0.0.0/8        — "this" network / unspecified (0.0.0.0 routes to localhost on many stacks)
  if (a === 0) return true;
  // 10.0.0.0/8       — RFC1918 private
  if (a === 10) return true;
  // 127.0.0.0/8      — loopback (127.0.0.1 and the whole /8)
  if (a === 127) return true;
  // 169.254.0.0/16   — link-local INCLUDING 169.254.169.254 cloud metadata
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12    — RFC1918 private (172.16 .. 172.31)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24     — IETF protocol assignments
  if (a === 192 && b === 0 && octets[2] === 0) return true;
  // 192.168.0.0/16   — RFC1918 private
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10    — carrier-grade NAT (RFC6598)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 198.18.0.0/15    — benchmarking (RFC2544)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4      — multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4      — reserved / future use (includes 255.255.255.255 broadcast)
  if (a >= 240) return true;
  return false;
}

/**
 * Parse a single IPv6 hextet (1-4 hex digits) or return undefined.
 * Declared before expandIpv6 for readability; hoisting makes order irrelevant.
 */
function hextet(s: string): number | undefined {
  if (!/^[0-9a-f]{1,4}$/.test(s)) return undefined;
  return parseInt(s, 16);
}

/**
 * Expand a (possibly `::`-compressed) IPv6 address string into exactly 8
 * 16-bit groups. Returns undefined if the string is not a syntactically valid
 * IPv6 address. Handles an embedded trailing dotted-quad (e.g. ::ffff:1.2.3.4).
 */
function expandIpv6(addr: string): number[] | undefined {
  if (addr.length === 0) return undefined;

  // Split off an embedded IPv4 tail, if present, and convert to two hextets.
  let head = addr;
  let tailGroups: number[] = [];
  const lastColon = addr.lastIndexOf(':');
  const maybeV4 = lastColon >= 0 ? addr.slice(lastColon + 1) : '';
  if (maybeV4.includes('.')) {
    const v4 = parseIpv4Octets(maybeV4);
    if (!v4) return undefined;
    tailGroups = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    head = addr.slice(0, lastColon + 1); // keep trailing colon for split logic
  }

  const doubleColon = head.indexOf('::');
  let groups: Array<number | undefined>;

  if (doubleColon >= 0) {
    // Compressed form: at most one '::'.
    if (head.indexOf('::', doubleColon + 1) >= 0) return undefined;
    const before = head.slice(0, doubleColon).split(':').filter((p) => p !== '');
    const after  = head.slice(doubleColon + 2).split(':').filter((p) => p !== '');
    const beforeG = before.map(hextet);
    const afterG  = after.map(hextet);
    if (beforeG.includes(undefined) || afterG.includes(undefined)) return undefined;
    const fillCount = 8 - (beforeG.length + afterG.length + tailGroups.length);
    if (fillCount < 0) return undefined;
    groups = [...beforeG, ...new Array<number>(fillCount).fill(0), ...afterG, ...tailGroups];
  } else {
    const parts = head.split(':').filter((p) => p !== '');
    const g = parts.map(hextet);
    if (g.includes(undefined)) return undefined;
    groups = [...g, ...tailGroups];
  }

  if (groups.length !== 8) return undefined;
  const resolved: number[] = [];
  for (const n of groups) {
    if (n === undefined || n < 0 || n > 0xffff) return undefined;
    resolved.push(n);
  }
  return resolved;
}

/**
 * True if a bracket-stripped IPv6 hostname denotes a loopback / link-local /
 * unique-local / unspecified address, or embeds a blocked IPv4 (IPv4-mapped or
 * IPv4-compatible). Node canonicalises `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`,
 * so we decode embedded IPv4 from the trailing hextets rather than relying on
 * dotted notation surviving. Fails closed on anything unparseable.
 */
function isBlockedIpv6(hostNoBrackets: string): boolean {
  const lower = hostNoBrackets.toLowerCase();

  // Strip a zone id (e.g. fe80::1%eth0) before classification.
  const addr = lower.split('%')[0]!;

  // Unspecified (::) and loopback (::1).
  if (addr === '::' || addr === '::1') return true;

  // Expand to full hextet groups so prefix checks are reliable.
  const groups = expandIpv6(addr);
  if (!groups) {
    // Unparseable as IPv6 — fail closed.
    return true;
  }

  const g0 = groups[0]!;

  // ::ffff:a.b.c.d / ::ffff:0:a.b.c.d  — IPv4-mapped / -translated. The mapped
  // space is blocked wholesale: a mapped literal must never escape the guard,
  // regardless of the embedded address.
  const isV4Mapped =
    groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
    groups[3] === 0 && groups[4] === 0 &&
    (groups[5] === 0xffff || (groups[5] === 0 && groups[6] !== 0));
  if (isV4Mapped) return true;

  // ::/64-ish all-zero prefix — IPv4-compatible (deprecated) / unspecified-adjacent
  // / loopback-adjacent addresses collapse to leading-zero groups. Treat as internal.
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
      groups[4] === 0 && groups[5] === 0) {
    return true;
  }

  // fe80::/10 — link-local.
  if (g0 >= 0xfe80 && g0 <= 0xfebf) return true;
  // fc00::/7  — unique local (fc00:: .. fdff::).
  if (g0 >= 0xfc00 && g0 <= 0xfdff) return true;
  // ff00::/8  — multicast.
  if ((g0 & 0xff00) === 0xff00) return true;

  return false;
}

/**
 * True if `hostname` (as produced by `new URL(...).hostname`) is a literal IP
 * address — or a hostname token — that points at a non-routable / internal /
 * loopback / link-local / metadata endpoint and must be refused.
 *
 * Exported for direct unit testing of the SSRF boundary.
 */
export function isBlockedHost(hostname: string): boolean {
  if (hostname.length === 0) return true;

  const lower = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lower)) return true;

  // Bracketed → IPv6 literal.
  if (lower.startsWith('[') && lower.endsWith(']')) {
    return isBlockedIpv6(lower.slice(1, -1));
  }

  // Bare-colon (unbracketed) IPv6 can still arrive in some inputs.
  if (lower.includes(':')) {
    return isBlockedIpv6(lower);
  }

  // Dotted-quad IPv4 literal (covers decimal/hex/short-form after URL canonicalisation).
  const v4 = parseIpv4Octets(lower);
  if (v4) return isBlockedIpv4(v4);

  // A non-literal hostname (e.g. api.alienclaw.net). Not an IP — the allowlist
  // is the gate for these; this predicate only blocks the dangerous literals
  // and explicit local tokens above.
  return false;
}

/**
 * Assert that `rawUrl` is safe for the url_fetch tool to retrieve.
 * Order of checks (each independently sufficient to reject):
 *   1. Parseable URL                    → else reject malformed
 *   2. https: only                      → no http:, file:, gopher:, etc.
 *   3. hostname not an internal/IP-literal target (SSRF block)
 *   4. hostname on the explicit allowlist
 * Throws on any failure; returns the parsed URL on success.
 *
 * Exported for direct unit testing of the SSRF boundary.
 */
export function assertSafeFetchUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    throw new Error(`url_fetch: refusing malformed URL: ${(e as Error).message}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`url_fetch: refusing non-https URL: "${rawUrl}"`);
  }

  if (isBlockedHost(parsed.hostname)) {
    throw new Error(
      `url_fetch: refusing private/loopback/link-local/metadata host: "${parsed.hostname}"`
    );
  }

  if (!ALLOWED_FETCH_HOSTS.has(parsed.hostname)) {
    throw new Error(`url_fetch: refusing off-allowlist host: "${parsed.hostname}"`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// web_search
// Dynamic import of OpenClaw tool so this module compiles without hard dep.
// ---------------------------------------------------------------------------

let _webSearchFn: ((arg: unknown) => Promise<unknown>) | undefined;

const webSearchAdapter: ToolFn = async (input) => {
  const query = String(
    input['query'] ?? input['task'] ?? ''
  ).trim().slice(0, 500);

  if (!query) throw new Error('web_search: query is empty');

  // Resolve and cache the OpenClaw tool fn on first call
  // TODO v0.2: wire to globally-installed openclaw package tool exports
  if (!_webSearchFn) {
    _webSearchFn = undefined; // stub pending OpenClaw global install wiring
  }

  if (typeof _webSearchFn === 'function') {
    const results = await _webSearchFn({ query });
    return { query, results };
  }

  return {
    query,
    results: [],
    _stub: true,
    _note: 'web_search adapter pending OpenClaw v0.2 wiring',
  };
};

// ---------------------------------------------------------------------------
// url_fetch
//
// SSRF-hardened: every URL is run through assertSafeFetchUrl (https pin +
// IP-literal block + host allowlist) BEFORE it reaches the fetch fn, and the
// fetch fn is asked to fail on any redirect so a permitted host cannot bounce
// the request to an internal target. The injected fetch fn receives a
// `redirect: 'error'` hint alongside the (already-validated) url.
// ---------------------------------------------------------------------------

let _webFetchFn: ((arg: unknown) => Promise<unknown>) | undefined;

const urlFetchAdapter: ToolFn = async (input) => {
  const rawUrl = String(input['url'] ?? '');

  // Single choke point: throws on non-https, internal/IP-literal, or
  // off-allowlist hosts. Use the canonicalised URL string downstream.
  const safeUrl = assertSafeFetchUrl(rawUrl).toString();

  if (!_webFetchFn) {
    _webFetchFn = undefined; // TODO v0.2: wire to globally-installed openclaw package
  }

  if (typeof _webFetchFn === 'function') {
    // redirect:'error' — a permitted origin must not be able to 30x-redirect
    // the fetch toward an internal endpoint after the allowlist check passes.
    const content = await _webFetchFn({ url: safeUrl, redirect: 'error' });
    return { url: safeUrl, statusCode: 200, content: String(content ?? ''), contentType: 'text/html' };
  }

  return { url: safeUrl, statusCode: 0, content: '', _stub: true };
};

// ---------------------------------------------------------------------------
// file_read
// ---------------------------------------------------------------------------

const fileReadAdapter: ToolFn = async (input) => {
  const rawPath  = String(input['path'] ?? input['task'] ?? '');
  const resolved = assertInsideBoundary(rawPath, PATHS.workspace);

  let contents: string;
  try {
    contents = await fsPromises.readFile(resolved, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`file_read: not found: ${resolved}`);
    }
    throw err;
  }

  const sizeBytes = Buffer.byteLength(contents, 'utf-8');
  if (sizeBytes > MAX_FILE_READ_BYTES) {
    throw new Error(`file_read: file too large (${sizeBytes} bytes, limit ${MAX_FILE_READ_BYTES})`);
  }

  return { path: rawPath, content: contents, encoding: 'utf-8', sizeBytes };
};

// ---------------------------------------------------------------------------
// file_write
// ---------------------------------------------------------------------------

const fileWriteAdapter: ToolFn = async (input) => {
  const rawPath = String(input['path'] ?? '');
  const content = typeof input['content'] === 'string'
    ? input['content']
    : JSON.stringify(input['content'] ?? '');

  const resolved = assertInsideBoundary(rawPath, OUTPUT_DIR);
  await fsPromises.mkdir(path.dirname(resolved), { recursive: true });

  let created = false;
  try {
    // Atomic create-or-fail: 'wx' fails if file already exists
    await fsPromises.writeFile(resolved, content, { flag: 'wx', encoding: 'utf-8' });
    created = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    throw err;  // refuse to overwrite — fail explicitly
  }

  const sizeBytes = Buffer.byteLength(content, 'utf-8');
  return { path: rawPath, sizeBytes, created };
};

// ---------------------------------------------------------------------------
// Wire all adapters — call once from hierarchy-bootstrap.ts
// ---------------------------------------------------------------------------

let _wired = false;

export function wireToolAdapters(): void {
  if (_wired) return;
  registerToolAdapter('web_search', webSearchAdapter);
  registerToolAdapter('url_fetch',  urlFetchAdapter);
  registerToolAdapter('file_read',  fileReadAdapter);
  registerToolAdapter('file_write', fileWriteAdapter);
  _wired = true;
}
