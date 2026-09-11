/**
 * Per-install token bucket rate limiting — flat-file persistent.
 * TypeScript port of api/rate_limit.py (Packet 31.5).
 *
 * 100 submissions per install per rolling 3600s window.
 * Flat-file persistence; in-memory cache; lazy-loaded.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { atomicWrite } from '../utils.js';

const _LIMIT = 100;
const _WINDOW = 3600; // seconds

interface RateState {
  install_id:        string;
  window_timestamps: string[];
}

export class RateLimiter {
  private readonly _limit:  number;
  private readonly _window: number;
  private readonly _root:   string | null;
  private readonly _cache:  Map<string, number[]> = new Map();
  private readonly _loaded: Set<string>           = new Set();

  constructor(opts: { limit?: number; windowSeconds?: number; dataRoot?: string } = {}) {
    this._limit  = opts.limit          ?? _LIMIT;
    this._window = opts.windowSeconds  ?? _WINDOW;
    this._root   = opts.dataRoot       ?? null;
  }

  private _filePath(installId: string): string | null {
    if (!this._root) return null;
    return join(this._root, 'rate_limit', installId.slice(0, 2), `${installId}.json`);
  }

  private _ensureLoaded(installId: string): void {
    if (this._loaded.has(installId)) return;
    this._loaded.add(installId);
    const path = this._filePath(installId);
    if (!path || !existsSync(path)) {
      this._cache.set(installId, []);
      return;
    }
    try {
      const state: RateState = JSON.parse(readFileSync(path, 'utf8'));
      const raw = Array.isArray(state.window_timestamps) ? state.window_timestamps : [];
      const mapped = raw.map((iso: unknown) =>
        typeof iso === 'string' ? new Date(iso).getTime() / 1000 : NaN,
      );
      if (mapped.length === 0) {
        this._cache.set(installId, []);
      } else if (mapped.every((t: number) => Number.isFinite(t))) {
        this._cache.set(installId, mapped);
      } else {
        // FAIL CLOSED per overmind directive 2026-08-01T11:28:05Z (PKT-473 re-author, PKT-496):
        // any non-empty file with ≥1 unparseable timestamp ⇒ treat as limit-reached.
        // Prevents a corrupted rate_limit file from silently restoring the per-install budget.
        this._cache.set(installId, new Array(this._limit).fill(Date.now() / 1000));
      }
    } catch {
      this._cache.set(installId, []);
    }
  }

  private _persist(installId: string, timestamps: number[]): void {
    const path = this._filePath(installId);
    if (!path) return;
    const isoList = [...timestamps].sort().map(ts => new Date(ts * 1000).toISOString());
    const data: RateState = { install_id: installId, window_timestamps: isoList };
    try {
      mkdirSync(dirname(path), { recursive: true });
      atomicWrite(path, JSON.stringify(data, null, 0));
    } catch {
      // Persistence failure is silent; in-memory state still works
    }
  }

  check(installId: string): [boolean, number] {
    this._ensureLoaded(installId);
    const now  = Date.now() / 1000;
    const cut  = now - this._window;
    let ts = (this._cache.get(installId) ?? []).filter(t => t > cut);

    if (ts.length >= this._limit) {
      const oldest     = Math.min(...ts);
      const retryAfter = Math.ceil(oldest + this._window - now) + 1;
      this._cache.set(installId, ts);
      return [false, Math.max(1, retryAfter)];
    }

    ts = [...ts, now];
    this._cache.set(installId, ts);
    // Fire-and-forget persist
    void Promise.resolve().then(() => this._persist(installId, ts));
    return [true, 0];
  }

  remaining(installId: string): number {
    this._ensureLoaded(installId);
    const now = Date.now() / 1000;
    const cut = now - this._window;
    const ts  = (this._cache.get(installId) ?? []).filter(t => t > cut);
    return Math.max(0, this._limit - ts.length);
  }
}

// ── IP-based rate limiter (T6) ───────────────────────────────────────────────
// Two buckets keyed by client IP: reads (120/min) and submissions (10/hr).
// In-memory, single-process. A process restart resets counters (acceptable).
// LRU eviction to bound memory: max 10_000 IPs per bucket.

const _IP_MAX_SIZE = 10_000;

/**
 * Default read rate (per minute) when ALIENCLAW_RATE_READ_PER_MIN is unset or invalid.
 * Matches the prior implicit default of `parseInt(...) || 120`.
 */
export const DEFAULT_IP_READ_PER_MIN = 120;

/**
 * Default submit rate (per hour) when ALIENCLAW_RATE_SUBMIT_PER_HOUR is unset or invalid.
 * Matches the prior implicit default of `parseInt(...) || 10`.
 */
export const DEFAULT_IP_SUBMIT_PER_HOUR = 10;

/**
 * Maximum allowed IP rate-limit per bucket. Anything above this would effectively
 * disable rate limiting on a public endpoint. 1_000/min reads and 1_000/hr submits
 * are far above any sane operator setting; this ceiling prevents a `1e9` env typo
 * from collapsing the limit to 1 via parseInt's leading-digit-only behavior, and
 * prevents an accidental DoS of the bucket map (memory growth).
 *
 * Justified in packets/1089-ipratelimiter-env-var-coercion-bypass-corrective-re-author.md §"MAX_IP_RATE".
 */
export const MAX_IP_READ_PER_MIN     = 1_000;
export const MAX_IP_SUBMIT_PER_HOUR  = 1_000;

/**
 * Parse an env-var string into a positive safe integer in [1, maxValue].
 * Falls back to defaultValue for unset, non-numeric, non-integer, out-of-range,
 * or unsafe-integer inputs. Honours sci-notation ('1e2' → 100) via Number() since
 * operator intent is the integer value the literal would resolve to.
 *
 * The naive `parseInt(x, 10) || default` shape only protected against 0 and NaN.
 * Negative integers, huge integers, exponent notation ('1e9' → 1), and Infinity
 * all slipped through. PKT-089 documented this; PKT-1089 is the corrective
 * re-author with full File-A coverage (RED→GREEN both run).
 *
 * Mirror of resolvePoolMax() (storage.ts, PKT-1087), resolveCacheTtlMs()
 * (cache.ts, PKT-1118/1120). All three are the same env-var-coercion family
 * from PR #593 (e322631d, feat(p2) hardening).
 */
export function _resolveRateLimitInt(
  envValue:     string | undefined,
  defaultValue: number,
  maxValue:     number,
): number {
  if (envValue === undefined || envValue === '') return defaultValue;
  const n = Number(envValue);
  if (!Number.isInteger(n)) return defaultValue;
  if (n < 1 || n > maxValue) return defaultValue;
  return n;
}

export class IpRateLimiter {
  private readonly _readBucket:   Map<string, number[]> = new Map();
  private readonly _submitBucket: Map<string, number[]> = new Map();

  private readonly _readLimit:    number;
  private readonly _readWindow:   number; // seconds
  private readonly _submitLimit:  number;
  private readonly _submitWindow: number;

  constructor(opts?: { readPerMin?: number; submitPerHour?: number }) {
    const envRead   = _resolveRateLimitInt(process.env['ALIENCLAW_RATE_READ_PER_MIN'],
      DEFAULT_IP_READ_PER_MIN, MAX_IP_READ_PER_MIN);
    const envSubmit = _resolveRateLimitInt(process.env['ALIENCLAW_RATE_SUBMIT_PER_HOUR'],
      DEFAULT_IP_SUBMIT_PER_HOUR, MAX_IP_SUBMIT_PER_HOUR);
    const optRead   = (opts?.readPerMin !== undefined)
      ? _resolveRateLimitInt(String(opts.readPerMin), DEFAULT_IP_READ_PER_MIN, MAX_IP_READ_PER_MIN)
      : undefined;
    const optSubmit = (opts?.submitPerHour !== undefined)
      ? _resolveRateLimitInt(String(opts.submitPerHour), DEFAULT_IP_SUBMIT_PER_HOUR, MAX_IP_SUBMIT_PER_HOUR)
      : undefined;
    this._readLimit    = optRead   ?? envRead;
    this._submitLimit  = optSubmit ?? envSubmit;
    this._readWindow   = 60;
    this._submitWindow = 3600;
  }

  private _check(bucket: Map<string, number[]>, ip: string, limit: number, windowSec: number): [boolean, number] {
    const now = Date.now() / 1000;
    const cut = now - windowSec;
    let ts = (bucket.get(ip) ?? []).filter(t => t > cut);

    if (ts.length >= limit) {
      const oldest     = Math.min(...ts);
      const retryAfter = Math.ceil(oldest + windowSec - now) + 1;
      bucket.set(ip, ts);
      return [false, Math.max(1, retryAfter)];
    }

    // LRU eviction: remove oldest entry when at capacity
    if (bucket.size >= _IP_MAX_SIZE && !bucket.has(ip)) {
      const firstKey = bucket.keys().next().value;
      if (firstKey !== undefined) bucket.delete(firstKey);
    }

    ts = [...ts, now];
    bucket.set(ip, ts);
    return [true, 0];
  }

  checkRead(ip: string):   [boolean, number] { return this._check(this._readBucket,   ip, this._readLimit,   this._readWindow);   }
  checkSubmit(ip: string): [boolean, number] { return this._check(this._submitBucket, ip, this._submitLimit, this._submitWindow); }
}
