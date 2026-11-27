/**
 * hardened-fetch.ts
 * Single, unified SSRF-safe fetch for all AlienClaw network call sites.
 *
 * Security model (2026 bypass corpus):
 *   - Resolves DNS once via dns.promises.lookup({ all: true }) — validates EVERY
 *     resolved address before making a connection.
 *   - Rejects loopback, RFC1918, link-local (169.254.x.x incl. cloud metadata),
 *     ULA, unspecified, multicast, and reserved ranges — in both IPv4 and IPv6,
 *     including IPv4-mapped IPv6 in hex form (::ffff:a9fe:a9fe).
 *   - Blocks NAT64 64:ff9b::/96 when the embedded IPv4 is blocked, and the
 *     whole local-use NAT64 prefix 64:ff9b:1::/48.
 *   - Re-validates every redirect hop; caps redirects at MAX_REDIRECTS.
 *   - Enforces protocol allowlist (https, http only).
 *   - Validates the FetchPolicy up front: every limit must be a bounded
 *     integer, omitted optional fields get the defaults, and anything else
 *     throws TypeError instead of silently removing a limit.
 *   - Enforces per-caller response size cap and ONE time budget that covers
 *     DNS, connect, headers and the full body read across every hop.
 *   - URL is NOT rewritten to the resolved IP (which would break TLS SNI).
 *     Instead, the same resolver is used for both validation and connection
 *     (Node's built-in DNS stack), making resolver-inconsistency attacks impossible.
 *
 * Consumers:
 *   - src/alienclaw/msb/tool-adapters.ts (urlFetchAdapter, httpGetAdapter)
 *   - src/alienclaw/governance/common/leaderboard.ts (hardenedFetch, submitFromFile)
 *   - src/alienclaw/governance/common/sync/client.ts
 */

import * as dns  from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';

// ---------------------------------------------------------------------------
// Policy types
// ---------------------------------------------------------------------------

export interface FetchPolicy {
  /**
   * Maximum milliseconds for the entire call: DNS, connect, headers and the
   * full body read, across every redirect hop. Integer, 1 to 2_147_483_647.
   */
  timeoutMs:    number;
  /** Maximum bytes in the response body. Integer, 0 to 268_435_456 (256 MiB). */
  maxBytes:     number;
  /**
   * Allowed URL protocols (without colon). Default: ['https', 'http'].
   * Explicit allowlist — anything not listed is rejected.
   */
  protocols?:   string[];
  /**
   * Optional hostname allowlist. If provided, only these exact hostnames
   * are permitted (post-DNS-validation). If omitted, any non-blocked host is allowed.
   */
  allowedHosts?: Set<string>;
  /** Maximum number of redirect hops to follow. Integer, 0 to 20. Default: 5. */
  maxRedirects?: number;
}

export const DEFAULT_PROTOCOLS = ['https', 'http'] as const;
export const MAX_REDIRECTS      = 5;

// Policy bounds (enforced by checkPolicy).
/** The largest delay Node's setTimeout honours; above it Node fires after 1 ms. */
const TIMEOUT_MS_CEILING    = 2_147_483_647;
/** The body is buffered and decoded into one string (V8 caps strings near 2^29 chars). */
const MAX_BYTES_CEILING     = 256 * 1024 * 1024;
/** The WHATWG Fetch standard's own redirect limit. */
const MAX_REDIRECTS_CEILING = 20;

// ---------------------------------------------------------------------------
// IP-address blocking (mirrors isBlockedHost from tool-adapters.ts)
// ---------------------------------------------------------------------------

function parseIpv4Octets(s: string): [number, number, number, number] | undefined {
  const parts = s.split('.');
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number(part);
    if (n < 0 || n > 255) return undefined;
    octets.push(n);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function isBlockedIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0)   return true;  // 0.0.0.0/8 "this" network
  if (a === 10)  return true;  // 10.0.0.0/8 RFC1918
  if (a === 127) return true;  // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;  // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 0 && octets[2] === 0) return true;  // 192.0.0.0/24 IETF
  if (a === 192 && b === 168) return true;  // 192.168.0.0/16 RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;  // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true;  // 198.18.0.0/15 benchmarking
  if (a >= 224 && a <= 239) return true;  // 224.0.0.0/4 multicast
  if (a >= 240) return true;  // 240.0.0.0/4 reserved
  return false;
}

function hextet(s: string): number | undefined {
  if (!/^[0-9a-f]{1,4}$/.test(s)) return undefined;
  return parseInt(s, 16);
}

function expandIpv6(addr: string): number[] | undefined {
  if (addr.length === 0) return undefined;
  let head = addr;
  let tailGroups: number[] = [];
  const lastColon = addr.lastIndexOf(':');
  const maybeV4 = lastColon >= 0 ? addr.slice(lastColon + 1) : '';
  if (maybeV4.includes('.')) {
    const v4 = parseIpv4Octets(maybeV4);
    if (!v4) return undefined;
    tailGroups = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    head = addr.slice(0, lastColon + 1);
  }
  const doubleColon = head.indexOf('::');
  let groups: Array<number | undefined>;
  if (doubleColon >= 0) {
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

function isBlockedIpv6(hostNoBrackets: string): boolean {
  const lower = hostNoBrackets.toLowerCase();
  const addr = lower.split('%')[0]!;
  if (addr === '::' || addr === '::1') return true;
  const groups = expandIpv6(addr);
  if (!groups) return true;  // unparseable → fail closed
  const g0 = groups[0]!;
  // IPv4-mapped / IPv4-translated (::ffff:a.b.c.d / ::ffff:0:a.b.c.d).
  // The mapping marker `::ffff:` sits at one of two positions:
  //   • legacy 3-group-suffix form (::ffff:a.b.c.d → groups[0..4]=0,
  //     groups[5]=0xffff, groups[6..7]=a,b)
  //   • RFC 6145 / RFC 6052 4-group-suffix translated form
  //     (::ffff:0:a.b.c.d → groups[0..3]=0, groups[4]=0xffff,
  //     groups[5]=0, groups[6..7]=a,b)
  // The previous check required groups[0..4] === 0 and accepted only the
  // 3-group suffix; the 4-group form slipped through to fetch() and reached
  // loopback / RFC1918 / cloud-metadata (PKT-1079 / PKT-1236 defect 1).
  //
  // Both clauses require groups[0..3] === 0 so we never over-block legitimate
  // global-unicast addresses like `::1:ffff:0:0` that happen to contain
  // `ffff` at group position 5 (out of the mapped space).
  const isV4Mapped =
    groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
    ((groups[4] === 0 && groups[5] === 0xffff) ||
     (groups[4] === 0xffff && groups[5] === 0));
  if (isV4Mapped) return true;
  // All-zero prefix (unspecified/loopback-adjacent/IPv4-compatible)
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
      groups[4] === 0 && groups[5] === 0) return true;
  // NAT64. A translator turns these into IPv4 connections, so on a host with
  // NAT64 (for example an IPv6-only cloud subnet with DNS64) they reach the
  // embedded IPv4 address.
  //   • 64:ff9b::/96, the RFC 6052 well-known prefix: the IPv4 is the last
  //     32 bits. Blocked exactly when that IPv4 is blocked, so the DNS64
  //     answers for public IPv4-only hosts stay reachable on IPv6-only networks.
  //   • 64:ff9b:1::/48, the RFC 8215 local-use prefix: blocked whole. IANA
  //     lists it as not globally reachable, and the operator chooses the
  //     embedding length inside it, so the IPv4 cannot be located reliably.
  if (g0 === 0x64 && groups[1] === 0xff9b) {
    if (groups[2] === 0x0001) return true;
    if (groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
      const hi = groups[6]!;
      const lo = groups[7]!;
      if (isBlockedIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff])) return true;
    }
  }
  if (g0 >= 0xfe80 && g0 <= 0xfebf) return true;  // fe80::/10 link-local
  if (g0 >= 0xfc00 && g0 <= 0xfdff) return true;  // fc00::/7 ULA
  if ((g0 & 0xff00) === 0xff00) return true;        // ff00::/8 multicast
  return false;
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

/**
 * Exported for unit testing.
 * True if `hostname` (as produced by new URL(...).hostname) is a blocked address.
 * Resolving DNS is NOT done here — this only classifies already-resolved addresses
 * or literal IPs. For DNS-resolved addresses, validateResolvedAddresses() is used.
 */
export function isBlockedHost(hostname: string): boolean {
  if (hostname.length === 0) return true;
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.startsWith('[') && lower.endsWith(']')) return isBlockedIpv6(lower.slice(1, -1));
  if (lower.includes(':')) return isBlockedIpv6(lower);
  const v4 = parseIpv4Octets(lower);
  if (v4) return isBlockedIpv4(v4);
  return false;
}

/**
 * Validate every address returned by DNS resolution.
 * Exported for unit testing with a stubbed resolver.
 */
/** Address entry as returned by `dns.lookup(hostname, { all: true })`. */
export interface ResolvedAddress { address: string; family: number; }

export function validateResolvedAddresses(addresses: ResolvedAddress[]): void {
  for (const { address, family } of addresses) {
    if (family === 4) {
      const octets = parseIpv4Octets(address);
      if (!octets || isBlockedIpv4(octets)) {
        throw new Error(`SSRF rejected: resolved address ${address} is in a blocked range`);
      }
    } else if (family === 6) {
      if (isBlockedIpv6(address)) {
        throw new Error(`SSRF rejected: resolved IPv6 address ${address} is in a blocked range`);
      }
    } else {
      throw new Error(`SSRF rejected: unknown address family ${family} for ${address}`);
    }
  }
  if (addresses.length === 0) {
    throw new Error('SSRF rejected: DNS returned no addresses');
  }
}

// ---------------------------------------------------------------------------
// Policy validation
// ---------------------------------------------------------------------------

/** A FetchPolicy after checkPolicy: bounded integer limits, defaults filled in. */
interface CheckedPolicy {
  readonly timeoutMs:    number;
  readonly maxBytes:     number;
  readonly maxRedirects: number;
  readonly protocols:    readonly string[];
  readonly allowedHosts: Set<string> | undefined;
}

/** A short description of a rejected value for an error message (objects are not echoed). */
function describeValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}...` : v);
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object' || typeof v === 'function' || typeof v === 'symbol') return typeof v;
  return String(v);
}

function boundedInt(field: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new TypeError(
      `Invalid FetchPolicy: ${field} must be an integer from ${min} to ${max} (got ${describeValue(v)})`,
    );
  }
  return v;
}

/**
 * Validate a caller's policy once, at the top of hardenedFetch, and fail
 * closed. Without this, NaN / undefined / string limits compared false
 * against every running total, so a policy built from JSON or env vars
 * silently lost its size cap or its redirect cap. Each field is read once.
 */
function checkPolicy(policy: unknown): CheckedPolicy {
  if (typeof policy !== 'object' || policy === null) {
    throw new TypeError(`Invalid FetchPolicy: expected an object (got ${describeValue(policy)})`);
  }
  const p = policy as { [K in keyof FetchPolicy]?: unknown };
  const timeoutMs = boundedInt('timeoutMs', p.timeoutMs, 1, TIMEOUT_MS_CEILING);
  const maxBytes  = boundedInt('maxBytes', p.maxBytes, 0, MAX_BYTES_CEILING);
  const rawRedirects = p.maxRedirects;
  const maxRedirects = rawRedirects === undefined
    ? MAX_REDIRECTS
    : boundedInt('maxRedirects', rawRedirects, 0, MAX_REDIRECTS_CEILING);
  const protocols = p.protocols;
  if (protocols !== undefined &&
      !(Array.isArray(protocols) && protocols.every((x: unknown) => typeof x === 'string'))) {
    throw new TypeError(
      `Invalid FetchPolicy: protocols must be an array of strings (got ${describeValue(protocols)})`,
    );
  }
  const allowedHosts = p.allowedHosts;
  if (allowedHosts !== undefined && !(allowedHosts instanceof Set)) {
    throw new TypeError(
      `Invalid FetchPolicy: allowedHosts must be a Set of hostnames (got ${describeValue(allowedHosts)})`,
    );
  }
  return {
    timeoutMs,
    maxBytes,
    maxRedirects,
    protocols: (protocols as string[] | undefined) ?? [...DEFAULT_PROTOCOLS],
    allowedHosts: allowedHosts as Set<string> | undefined,
  };
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

function validateUrl(urlStr: string, policy: CheckedPolicy): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }

  const allowedProtocols = policy.protocols;
  // URL.protocol includes the colon (e.g. 'https:')
  const proto = parsed.protocol.replace(/:$/, '');
  if (!allowedProtocols.includes(proto)) {
    throw new Error(`Protocol rejected: ${parsed.protocol} — only ${allowedProtocols.join(', ')} allowed`);
  }

  // Reject if hostname is a known-blocked literal (IP literal or localhost token)
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`SSRF rejected: hostname "${parsed.hostname}" is blocked`);
  }

  // Check allowedHosts if provided
  if (policy.allowedHosts && !policy.allowedHosts.has(parsed.hostname)) {
    throw new Error(`Host not in allowlist: "${parsed.hostname}"`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// DNS resolution and validation
// ---------------------------------------------------------------------------

async function resolveAndValidate(hostname: string): Promise<void> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`DNS resolution failed for "${hostname}": ${(err as Error).message}`);
  }
  validateResolvedAddresses(addresses);
}

// ---------------------------------------------------------------------------
// Core hardened fetch
// ---------------------------------------------------------------------------

/**
 * True if `err` is the deadline abort: the deadline's own reason, an error whose
 * cause is that reason, or an AbortError (DOMException or Error named so).
 */
function isDeadlineError(err: unknown, deadline: Error): boolean {
  if (err === deadline) return true;
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; cause?: unknown };
  return e.cause === deadline || e.name === 'AbortError';
}

/**
 * Perform a URL fetch with full SSRF protection and resource limits.
 *
 * @param url     The URL to fetch (string or URL object).
 * @param policy  Per-caller security policy (timeouts, size caps, allowlists).
 * @returns       The response body as a string.
 * @throws        TypeError ("Invalid FetchPolicy: ...") before any I/O if the
 *                policy is malformed; Error on any SSRF violation, timeout,
 *                size cap, or HTTP error.
 */
export async function hardenedFetch(url: string, policy: FetchPolicy): Promise<string> {
  const p = checkPolicy(policy);

  // One deadline for the whole call: DNS, connect, headers and the full body
  // read, across every redirect hop. The signal goes to fetch() (so undici
  // tears the socket down), and every await below also races `expired`, so a
  // lookup or a body stream that ignores the signal cannot outlive the budget.
  const controller = new AbortController();
  const { signal } = controller;
  // The deadline aborts with its own reason, so the errors the deadline causes
  // can be told apart from errors that merely settle after it: `expired` and
  // signal.throwIfAborted() reject with it, and so does undici for an aborted
  // fetch or body read (it rejects with signal.reason).
  const deadline = new Error(`Fetch timeout: exceeded ${p.timeoutMs}ms budget`);
  const timer = setTimeout(() => controller.abort(deadline), p.timeoutMs);
  const expired = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(deadline), { once: true });
  });
  expired.catch(() => { /* observed through the races below */ });
  const beforeDeadline = <T>(work: Promise<T>): Promise<T> => Promise.race([work, expired]);

  let currentUrl = url;
  let redirectsLeft = p.maxRedirects;

  try {
    for (;;) {
      signal.throwIfAborted();

      // 1. Validate URL (protocol, literal-IP check, host allowlist)
      const parsed = validateUrl(currentUrl, p);

      // 2. Resolve DNS and validate every returned address
      await beforeDeadline(resolveAndValidate(parsed.hostname));

      // 3. Perform the request under the shared deadline
      const response = await beforeDeadline(fetch(currentUrl, {
        signal,
        redirect: 'manual',  // handle redirects ourselves for re-validation
      }));

      // 4. Handle redirects (3xx)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect with no Location header (status ${response.status})`);
        }
        if (redirectsLeft <= 0) {
          throw new Error(`Too many redirects (>${p.maxRedirects})`);
        }
        // Resolve relative redirect URLs against current URL
        currentUrl = new URL(location, currentUrl).toString();
        redirectsLeft--;
        continue;  // re-validate the new URL from the top of the loop
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${parsed.hostname}`);
      }

      // 5. Stream response body with size cap, still under the deadline
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        for (;;) {
          const { done, value } = await beforeDeadline(reader.read());
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > p.maxBytes) {
            throw new Error(`Response exceeds ${p.maxBytes} bytes — rejecting`);
          }
          chunks.push(value);
        }
      } catch (err) {
        reader.cancel().catch(() => { /* the read already failed */ });
        throw err;
      }

      return new TextDecoder().decode(Buffer.concat(chunks));
    }
  } catch (err) {
    // Report a timeout only for an error that IS the deadline firing: its own
    // reason (or an error caused by it), or an AbortError raised by the abort.
    // Anything else (an SSRF rejection, an HTTP status, the size cap) that
    // settled as the deadline fired is reported as itself (2026-11-26 review:
    // `if (signal.aborted)` alone turned those into timeouts).
    if (signal.aborted && isDeadlineError(err, deadline)) throw deadline;
    throw err;
  } finally {
    clearTimeout(timer);
    // Release anything still tied to the signal, such as an unread redirect
    // body. After a timeout the signal is already aborted and this is a no-op.
    controller.abort();
  }
}

// ---------------------------------------------------------------------------
// Convenience: leaderboard-policy fetch (backward-compatible wrapper)
// ---------------------------------------------------------------------------

export const LEADERBOARD_POLICY: FetchPolicy = {
  timeoutMs:   10_000,
  maxBytes:    256 * 1024,  // 256 KB
  protocols:   ['https'],
  allowedHosts: new Set(['api.alienclaw.net']),
};

/** Backward-compatible wrapper used by leaderboard.ts. */
export async function leaderboardFetch(
  url: string,
  opts: { timeoutMs?: number; maxResponseBytes?: number } = {},
): Promise<string> {
  return hardenedFetch(url, {
    ...LEADERBOARD_POLICY,
    timeoutMs: opts.timeoutMs       ?? LEADERBOARD_POLICY.timeoutMs,
    maxBytes:  opts.maxResponseBytes ?? LEADERBOARD_POLICY.maxBytes,
  });
}
