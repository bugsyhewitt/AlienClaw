/**
 * PKT-1276 — API server port env-var coercion hardening.
 *
 * Resolves the API server bind port from environment variables, mirroring
 * the `_resolveRateLimitInt()` (rate-limit.ts), `resolvePoolMax()`
 * (storage.ts), `resolveCacheTtlMs()` (cache.ts), and `resolveXffHops()`
 * (client-ip.ts, PKT-1275) hardening pattern.
 *
 * The naive `parseInt(env, 10)` shape (the previous form at main.ts:45)
 * only protected against a subset of bypass inputs. NaN, empty-string,
 * substring truncation ('1234garbage' → 1234), out-of-range ports
 * (0 → ephemeral, -1, 99999), and exponent-truncation ('1e9' → 1) all
 * slipped through. PKT-1276 closes the LAST remaining `parseInt(
 * process.env…)` site in `src/alienclaw/api/`.
 *
 * Priority: PORT (12-factor convention) > ALIENCLAW_API_PORT (legacy).
 *
 * Range: 1..65535 (TCP/IP user-port space, excluding 0 which Node
 * silently maps to an ephemeral port — defeating operator intent).
 */

/** Default API server port, matching the prior implicit default of `'8080'`. */
export const DEFAULT_API_PORT = 8080;

/** Maximum allowed API server port. Anything above 65535 is not a valid TCP/IP port. */
export const MAX_API_PORT = 65535;

/**
 * Resolve the API server port with PORT > ALIENCLAW_API_PORT precedence.
 *
 * `PORT` is the 12-factor convention and is checked first; if it is unset
 * or fails validation, fall back to `ALIENCLAW_API_PORT` (legacy). If both
 * are unset or invalid, return DEFAULT_API_PORT (8080).
 *
 * Both env values are validated by `resolveApiPort()`, which falls back
 * to DEFAULT_API_PORT on every bypass input. This function only adds the
 * precedence layer; it never applies `parseInt`.
 */
export function resolveApiPortFromEnv(
  portEnv?: string,
  apiPortEnv?: string,
): number {
  const port = resolveApiPort(portEnv);
  if (port !== DEFAULT_API_PORT) return port;
  return resolveApiPort(apiPortEnv);
}

/**
 * Parse an env-var string into a safe port number in [1, 65535].
 * Falls back to DEFAULT_API_PORT (8080) for unset, non-numeric,
 * non-integer, out-of-range, or empty inputs.
 *
 * @param envValue  raw env-var string (typically `process.env['PORT']` or
 *                  `process.env['ALIENCLAW_API_PORT']`); `undefined` and
 *                  `''` both fall back to the default
 * @returns         a positive integer in [1, 65535]
 */
export function resolveApiPort(envValue?: string): number {
  if (envValue === undefined || envValue.trim() === '') return DEFAULT_API_PORT;
  const n = Number(envValue);
  if (!Number.isInteger(n)) return DEFAULT_API_PORT;
  if (n < 1 || n > MAX_API_PORT) return DEFAULT_API_PORT;
  return n;
}
