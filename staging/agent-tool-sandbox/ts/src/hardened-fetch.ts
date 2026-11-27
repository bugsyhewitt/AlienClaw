/**
 * hardened-fetch.ts
 * SSRF-hardened fetch: one validating code path for outbound HTTP(S) requests.
 *
 * Staged copy of AlienClaw's src/alienclaw/net/hardened-fetch.ts. See
 * PROVENANCE.json for the source commit and blob, and README.md for the
 * threat model. The address classifiers (isBlockedHost,
 * validateResolvedAddresses and their helpers) are verbatim except for the
 * staged-only 2026-11-26 additions (6to4, Teredo, fec0::/10, Azure
 * WireServer); the AlienClaw-specific LEADERBOARD_POLICY / leaderboardFetch
 * wrapper was removed, and connection pinning (staged only, 2026-11-26)
 * replaced the fetch() call with the node:http / node:https transport in
 * pinned-request.ts. validateUrl also refuses port 0 (staged only).
 *
 * What the code does:
 *   - Parses the URL with WHATWG `new URL()` (which canonicalises decimal,
 *     octal, hex and short-form IPv4 and IPv6 literals), enforces a protocol
 *     allowlist (default https + http), rejects blocked IP literals and
 *     localhost tokens, and applies an optional exact-hostname allowlist.
 *   - Resolves the hostname ONCE per hop, via dns.promises.lookup({ all: true })
 *     or the policy's `resolve` hook, and rejects the request if ANY answer
 *     is in a blocked range (or is not a canonical IP string).
 *   - Pins the connection to that validated answer: the socket's `lookup`
 *     returns only those addresses, so a DNS-rebinding second answer is never
 *     asked for. Host header, TLS SNI and the certificate check keep the name.
 *   - Blocks loopback, RFC1918, link-local (169.254.x.x incl. cloud metadata),
 *     the Azure WireServer address 168.63.129.16,
 *     CGNAT 100.64.0.0/10, benchmarking, IETF 192.0.0.0/24, multicast,
 *     reserved, IPv6 ULA / link-local / site-local fec0::/10 / multicast /
 *     unspecified, the whole
 *     IPv4-mapped and IPv4-translated IPv6 space (::ffff:a.b.c.d, ::ffff:0:a.b.c.d),
 *     NAT64 64:ff9b::/96 when the embedded IPv4 is blocked, the whole
 *     local-use NAT64 prefix 64:ff9b:1::/48, and the whole 6to4 2002::/16 and
 *     Teredo 2001:0::/32 prefixes.
 *   - Refuses port 0 (node:http would read it as the default port).
 *   - Follows redirects manually, re-running every check on each hop; caps
 *     hops at maxRedirects (default MAX_REDIRECTS).
 *   - Validates the policy before any I/O: limits must be bounded integers,
 *     omitted optional fields get the defaults, anything else is a TypeError.
 *   - Enforces a response size cap and ONE time budget that covers DNS,
 *     connect, headers and the full body read across every hop.
 *
 * What it does NOT do (see README "Not covered"):
 *   - It does not judge the resolver: whatever the resolver answers is what
 *     gets validated and pinned. An attacker who controls DNS can still pick
 *     any PUBLIC address, which is not SSRF.
 *   - It does not use a proxy (proxy env vars are ignored, see pinned-request.ts).
 *   - getaddrinfo cannot be cancelled: a lookup that outlives the budget is
 *     abandoned (the call still fails at the deadline) and finishes in the
 *     background.
 */

import * as dns  from 'node:dns/promises';
import { isIP } from 'node:net';
import { transport, type PinnedAddress } from './pinned-request.js';

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
  /**
   * Optional resolver (custom DNS, or a fake one in tests). Called once per
   * hop with the URL's hostname (an IPv6 literal without its brackets); its
   * answer gets exactly the checks a DNS answer gets, and the connection may
   * use only those addresses. A throw or a malformed answer fails the call.
   * Default: dns.promises.lookup(hostname, { all: true }).
   */
  resolve?:      Resolver;
}

/** A FetchPolicy `resolve` hook: the addresses `hostname` resolves to. */
export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]> | readonly ResolvedAddress[];

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
// IP-address blocking
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
  // Azure WireServer: a PUBLIC address the host fabric answers inside every VM
  // (goal state, extension configuration), so no range rule catches it.
  if (a === 168 && b === 63 && octets[2] === 129 && octets[3] === 16) return true;
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
  // The other IPv4-embedding transition prefixes, blocked whole (staged only,
  // 2026-11-26; the Python twin blocks them whole too). Since the pinned
  // transport strips IPv6-literal brackets, these literals really dial.
  //   • 2002::/16 6to4 (RFC 3056, deprecated by RFC 7526): a host or relay with
  //     6to4 tunnels to the IPv4 in bits 16-47. Whole /16, public embeds too:
  //     no agent tool needs 6to4, and decoding would inherit the IPv4 table.
  //   • 2001:0::/32 Teredo (RFC 4380): the client IPv4 is obfuscated and the
  //     server IPv4 is whatever the attacker picks, so no embedded check holds.
  if (g0 === 0x2002) return true;
  if (g0 === 0x2001 && groups[1] === 0) return true;
  if (g0 >= 0xfec0 && g0 <= 0xfeff) return true;  // fec0::/10 site-local (deprecated, RFC 3879)
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
  readonly resolve:      Resolver | undefined;
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
  const resolve = p.resolve;
  if (resolve !== undefined && typeof resolve !== 'function') {
    throw new TypeError(
      `Invalid FetchPolicy: resolve must be a function (got ${describeValue(resolve)})`,
    );
  }
  return {
    timeoutMs,
    maxBytes,
    maxRedirects,
    protocols: (protocols as string[] | undefined) ?? [...DEFAULT_PROTOCOLS],
    allowedHosts: allowedHosts as Set<string> | undefined,
    resolve: resolve as Resolver | undefined,
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

  // WHATWG keeps port 0 ('http://h:0/' and ':00' alike), and node:http reads 0
  // as "use the default", so the transport would dial 80 or 443. Nothing listens
  // on 0. (A port above 65535 already fails new URL().) Staged only, 2026-11-26.
  if (parsed.port !== '') {
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Port rejected: ${parsed.port} is not a port from 1 to 65535`);
    }
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

/** A resolve hook's answer as plain {address, family} copies; anything else throws. */
function checkAnswer(answer: unknown): ResolvedAddress[] {
  if (!Array.isArray(answer)) {
    throw new Error(`resolve hook returned ${describeValue(answer)}, not an array of addresses`);
  }
  return answer.map((entry: unknown) => {
    const { address, family } = (typeof entry === 'object' && entry !== null ? entry : {}) as
      { address?: unknown; family?: unknown };
    if (typeof address !== 'string' || typeof family !== 'number') {
      throw new Error('resolve hook returned an entry without a string address and a numeric family');
    }
    return { address, family };
  });
}

/**
 * Resolve `hostname` once and validate every answer. The returned list is
 * the pin: the transport's socket may connect only to these addresses.
 */
async function resolveAndValidate(hostname: string, resolve: Resolver | undefined): Promise<PinnedAddress[]> {
  // URL.hostname keeps the brackets of an IPv6 literal; resolvers want the bare address.
  const name = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  let addresses: ResolvedAddress[];
  try {
    addresses = resolve === undefined
      ? await dns.lookup(name, { all: true })
      : checkAnswer(await resolve(name));
  } catch (err) {
    throw new Error(`DNS resolution failed for "${hostname}": ${(err as Error).message}`);
  }
  validateResolvedAddresses(addresses);
  // The socket connects to the address string itself, so it must be the
  // canonical form the classifier read. A resolve hook could answer
  // '012.0.0.1' (family 4): 12.0.0.1 to parseIpv4Octets, octal 10.0.0.1 to
  // inet_aton. net.isIP rejects every non-canonical spelling.
  for (const { address, family } of addresses) {
    if (isIP(address) !== family) {
      throw new Error(`SSRF rejected: resolved address ${address} is not a canonical IPv${family} address`);
    }
  }
  return addresses.map(({ address, family }) => ({ address, family }));
}

// ---------------------------------------------------------------------------
// Core hardened fetch
// ---------------------------------------------------------------------------

/**
 * True if `err` is the deadline abort: the deadline's own reason, or an error
 * whose cause chain reaches that reason or an AbortError (DOMException or Error
 * named so). The chain matters for the pinned transport: a body broken by the
 * abort surfaces as TypeError('terminated', { cause: <Node AbortError> }).
 * Ported from in-tree d18c5c5d, which checks only `err` and `err.cause`.
 */
function isDeadlineError(err: unknown, deadline: Error): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && typeof e === 'object' && e !== null; depth++) {
    if (e === deadline) return true;
    const { name, cause } = e as { name?: unknown; cause?: unknown };
    if (name === 'AbortError' || cause === deadline) return true;
    e = cause;
  }
  return e === deadline;
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
  // read, across every redirect hop. The signal goes to the transport (so
  // node:http destroys the socket), and every await below also races
  // `expired`, so a lookup or a body stream that ignores the signal cannot
  // outlive the budget.
  const controller = new AbortController();
  const { signal } = controller;
  // The deadline aborts with its own reason, so the errors the deadline causes
  // can be told apart from errors that merely settle after it: `expired` and
  // signal.throwIfAborted() reject with it, and so does the pinned transport
  // for an aborted request (it rejects with signal.reason).
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

      // 2. Resolve once and validate every returned address: this is the pin
      const addresses = await beforeDeadline(resolveAndValidate(parsed.hostname, p.resolve));

      // 3. Perform the request under the shared deadline. The transport's
      //    socket connects only to `addresses` and never follows redirects.
      const response = await beforeDeadline(transport.request(currentUrl, { signal, addresses }));

      // 4. Handle redirects (3xx)
      if (response.status >= 300 && response.status < 400) {
        // The redirect body is never read; release its connection now.
        response.body?.cancel().catch(() => { /* already closed */ });
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

      if (response.status < 200 || response.status > 299) {
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
    // reason, or an error whose cause chain reaches it or an AbortError raised
    // by the abort. Anything else (an SSRF rejection, an HTTP status, the size
    // cap) that settled as the deadline fired is reported as itself
    // (2026-11-26 review: `if (signal.aborted)` alone turned those into timeouts).
    if (signal.aborted && isDeadlineError(err, deadline)) throw deadline;
    throw err;
  } finally {
    clearTimeout(timer);
    // Release anything still tied to the signal, such as an unread redirect
    // body. After a timeout the signal is already aborted and this is a no-op.
    controller.abort();
  }
}
