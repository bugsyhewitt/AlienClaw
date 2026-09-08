/**
 * Derive the real client IP from the X-Forwarded-For header.
 *
 * Takes the entry at ALIENCLAW_XFF_HOPS (default 1) positions from the
 * RIGHT of the header. Never trusts the leftmost entry, which is trivially
 * spoofable by clients. Falls back to req.socket.remoteAddress on an absent
 * or malformed XFF header.
 *
 * ALIENCLAW_XFF_HOPS=1 means: trust exactly 1 proxy (take the rightmost
 * IP that our trusted proxy appended). On Hostinger LiteSpeed, P3 measures
 * the real hop count with `/__diag/whoami`; this default is safe for a
 * single-proxy deployment.
 */

import type { IncomingMessage } from 'node:http';
import { isIP }                 from 'node:net';

export interface ClientIpResult {
  /** Derived client IP address (without port). */
  ip:       string;
  /**
   * Zero-based index into the split XFF array that was selected.
   * -1 means the socket address was used as fallback.
   */
  hopIndex: number;
  /** Raw X-Forwarded-For header value as received. */
  rawXff:   string;
}

/** Parse proxy hop count from the environment (minimum 1). */
const XFF_HOPS = (): number =>
  Math.max(1, parseInt(process.env['ALIENCLAW_XFF_HOPS'] ?? '1', 10) || 1);

/**
 * Strip a port suffix from an IP string.
 * Handles both IPv6 bracket notation (`[::1]:port`) and IPv4+port (`1.2.3.4:port`).
 * Bare IPv6 and bare IPv4 addresses are returned unchanged.
 */
function stripPort(s: string): string {
  // IPv6 bracketed: [::1]:1234 or [::1]
  const bracketMatch = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketMatch) return bracketMatch[1]!;

  // IPv4 with port: 1.2.3.4:1234
  const colonParts = s.split(':');
  if (colonParts.length === 2) return colonParts[0]!;

  // Bare IPv6 or bare IPv4 (no port)
  return s;
}

/**
 * Derive the client IP from an incoming HTTP request.
 *
 * @param req - Node.js IncomingMessage (works with http, https, http2 compat wrappers)
 * @returns An object containing the derived IP, which XFF index was used, and the raw header.
 */
export function deriveClientIp(req: IncomingMessage): ClientIpResult {
  const raw  = String(req.headers['x-forwarded-for'] ?? '');
  const hops = XFF_HOPS();

  const entries = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Select from the right: entries[entries.length - hops]
  const idx = entries.length - hops;
  if (entries.length > 0 && idx >= 0) {
    const candidate = stripPort(entries[idx]!);
    if (isIP(candidate)) {
      return { ip: candidate, hopIndex: idx, rawXff: raw };
    }
  }

  // Fallback: use the socket remote address, stripping any IPv4-mapped IPv6 prefix
  const socketAddr = req.socket?.remoteAddress ?? '127.0.0.1';
  const ip = socketAddr.replace(/^::ffff:/, '');
  return { ip, hopIndex: -1, rawXff: raw };
}
