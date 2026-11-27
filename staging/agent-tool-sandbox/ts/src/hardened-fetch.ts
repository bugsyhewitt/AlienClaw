/**
 * hardened-fetch.ts
 * SSRF-hardened fetch: one validating code path for outbound HTTP(S) requests.
 *
 * Staged copy of AlienClaw's src/alienclaw/net/hardened-fetch.ts. See
 * PROVENANCE.json for the source commit and blob, and README.md for the
 * threat model. The address classifiers (isBlockedHost,
 * validateResolvedAddresses and their helpers) are verbatim except for the
 * staged-only 2026-11-26 additions (6to4, Teredo, fec0::/10, Azure
 * WireServer) and the move of their ranges into data (below); the AlienClaw-specific LEADERBOARD_POLICY / leaderboardFetch
 * wrapper was removed, and connection pinning (staged only, 2026-11-26)
 * replaced the fetch() call with the node:http / node:https transport in
 * pinned-request.ts. validateUrl also refuses port 0, isBlockedHost also
 * blocks the RFC 6761 localhost names, a resolved-address refusal no longer
 * names the address, and URLs in error messages are redacted (all staged
 * only, 2026-11-26). The block list itself is data (staged only, 2026-11-26):
 * every range and name comes from the generated ./blocklist-data.ts, whose
 * source policy/blocklist.v1.json is shared with the Python package; the
 * address parsers and the fail-closed rules stay here.
 *
 * What the code does:
 *   - Parses the URL with WHATWG `new URL()` (which canonicalises decimal,
 *     octal, hex and short-form IPv4 and IPv6 literals), enforces a protocol
 *     allowlist (default https + http), rejects blocked IP literals and
 *     localhost names (`localhost`, `*.localhost`, trailing dots included),
 *     and applies an optional exact-hostname allowlist.
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
 *   - Keeps error messages safe to show a model: a refused DNS answer is not
 *     named (it is on the error's non-enumerable `blockedAddress`), and a URL
 *     in a message has its userinfo, query and fragment redacted.
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
import {
  IPV4_BLOCK, IPV4_EXEMPT, IPV6_BLOCK, IPV6_EMBEDDED, IPV6_EXEMPT, LOOPBACK_NAMES, LOOPBACK_SUFFIXES,
  type Ipv4Rule, type Ipv6Rule,
} from './blocklist-data.js';
import { transport, type PinnedAddress } from './pinned-request.js';
import { redactUrl } from './redact-url.js';

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

// The rules (ranges, exemptions, embedded-IPv4 matchers, names) are in
// ./blocklist-data.ts, generated from policy/blocklist.v1.json; see
// policy/README.md for how they combine. Python reads the same table.

function inIpv4Rules(value: number, rules: readonly Ipv4Rule[]): boolean {
  for (const [network, netmask] of rules) {
    if (((value & netmask) >>> 0) === network) return true;
  }
  return false;
}

function inIpv6Rules(value: bigint, rules: readonly Ipv6Rule[]): boolean {
  for (const [network, netmask] of rules) {
    if ((value & netmask) === network) return true;
  }
  return false;
}

/** An IPv4 address (unsigned 32-bit) is blocked when in a block rule and in no exempt rule. */
function isBlockedIpv4Value(value: number, block: readonly Ipv4Rule[]): boolean {
  return inIpv4Rules(value, block) && !inIpv4Rules(value, IPV4_EXEMPT);
}

function isBlockedIpv4(octets: [number, number, number, number]): boolean {
  const value = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  return isBlockedIpv4Value(value, IPV4_BLOCK);
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
  const groups = expandIpv6(addr);
  if (!groups) return true;  // unparseable → fail closed
  let value = 0n;
  for (const g of groups) value = (value << 16n) | BigInt(g);
  // Embedded-IPv4 matchers first: IPv4-mapped ::ffff:0:0/96 and the NAT64
  // well-known prefix 64:ff9b::/96. Each one blocks its whole prefix, judges
  // the embedded IPv4 (the last 32 bits) alone, or defers to the IPv6 rules.
  // A NAT64 translator turns 64:ff9b::/96 into IPv4 connections, so on a host
  // with NAT64 (an IPv6-only subnet with DNS64) it reaches the embedded IPv4;
  // the decode keeps DNS64 answers for public IPv4-only hosts reachable.
  for (const rule of IPV6_EMBEDDED) {
    if ((value & rule.netmask) === rule.network) {
      if (rule.mode === 'block') return true;
      if (rule.mode === 'decode') return isBlockedIpv4Value(Number(value & 0xffffffffn), rule.ipv4Block);
      break;  // 'ranges': the matcher prefixes do not overlap
    }
  }
  // Then the IPv6 ranges: ::/96 (unspecified, loopback, IPv4-compatible),
  // IPv4-translated, local-use NAT64 64:ff9b:1::/48, Teredo, 6to4, ULA,
  // link-local, site-local, multicast; see the generated table.
  return inIpv6Rules(value, IPV6_BLOCK) && !inIpv6Rules(value, IPV6_EXEMPT);
}

/**
 * True for a name of the local host: a LOOPBACK_NAMES token (`localhost`,
 * `ip6-localhost`, `ip6-loopback`), or a name ending in a LOOPBACK_SUFFIXES
 * entry (every name under `.localhost`, RFC 6761 §6.3), with any trailing dots
 * ignored (`localhost.`, `foo.localhost.`). Staged only, 2026-11-26 (gate G7):
 * before, only the bare tokens were caught and the rest relied on DNS
 * answering loopback. `lower` must already be lower case. The trailing dots are
 * counted by hand: a regex such as /\.+$/ is quadratic on a long run of dots.
 */
function isLocalhostName(lower: string): boolean {
  let end = lower.length;
  while (end > 0 && lower.charCodeAt(end - 1) === 0x2e) end--;
  const name = end === lower.length ? lower : lower.slice(0, end);
  return LOOPBACK_NAMES.has(name) || LOOPBACK_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Exported for unit testing.
 * True if `hostname` (as produced by new URL(...).hostname) is a blocked address
 * or a localhost name (see isLocalhostName).
 * Resolving DNS is NOT done here — this only classifies already-resolved addresses
 * or literal IPs. For DNS-resolved addresses, validateResolvedAddresses() is used.
 */
export function isBlockedHost(hostname: string): boolean {
  if (hostname.length === 0) return true;
  const lower = hostname.toLowerCase();
  if (isLocalhostName(lower)) return true;
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

/**
 * What a resolved-address refusal carries besides its message. It is still a
 * plain Error; these two properties are non-enumerable and read-only, so
 * util.inspect, JSON.stringify and loggers that copy own enumerable fields do
 * not print them. A caller that wants them in its own logs reads them by name.
 */
export interface AddressRejection extends Error {
  /** The resolved address that was refused. */
  readonly blockedAddress: string;
  /** Its address family as the resolver reported it. */
  readonly addressFamily: number;
}

const BLOCKED_RANGE = 'SSRF rejected: a resolved address is in a blocked range';

/**
 * A refusal of a resolved address whose message does not name the address
 * (pinning review PR-03, staged only, 2026-11-26). In an agent tool the error
 * text goes back to the model, so naming the address let a prompt-injected
 * page map internal DNS (ask for http://vault.corp/, read the refusal) without
 * a connection ever being made. The detail moves to AddressRejection's
 * properties. An IP-literal refusal still quotes the literal: the caller wrote it.
 */
function addressRejected(message: string, address: string, family: number): AddressRejection {
  const err = new Error(message);
  Object.defineProperties(err, {
    blockedAddress: { value: address, enumerable: false, writable: false, configurable: true },
    addressFamily:  { value: family,  enumerable: false, writable: false, configurable: true },
  });
  return err as AddressRejection;
}

export function validateResolvedAddresses(addresses: ResolvedAddress[]): void {
  for (const { address, family } of addresses) {
    if (family === 4) {
      const octets = parseIpv4Octets(address);
      if (!octets || isBlockedIpv4(octets)) {
        throw addressRejected(BLOCKED_RANGE, address, family);
      }
    } else if (family === 6) {
      if (isBlockedIpv6(address)) {
        throw addressRejected(BLOCKED_RANGE, address, family);
      }
    } else {
      throw addressRejected(`SSRF rejected: unknown address family ${family} for a resolved address`, address, family);
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
    // Redacted (gate G7, staged only): the input may carry a password or a token.
    throw new Error(`Invalid URL: ${redactUrl(urlStr)}`);
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
      throw addressRejected(`SSRF rejected: a resolved address is not a canonical IPv${family} address`, address, family);
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
        // Resolve relative redirect URLs against current URL. Node's own
        // TypeError for a bad Location carries the raw Location and the
        // current URL as enumerable `input` / `base` properties, so it is
        // replaced by one that names only the redacted Location (gate G7, staged only).
        let next: URL;
        try {
          next = new URL(location, currentUrl);
        } catch {
          throw new TypeError(`Invalid redirect Location: ${redactUrl(location)}`);
        }
        currentUrl = next.toString();
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
