/**
 * In-process TTL cache for leaderboard reads.
 * Key = martian_type + n. TTL default 10s (ALIENCLAW_BOARD_CACHE_TTL_MS).
 */
import { createHash } from 'node:crypto';

export interface CacheEntry<T> {
  value:     T;
  etag:      string;  // SHA-256 of JSON(value), hex, first 32 chars, wrapped in quotes
  expiresAt: number;  // Date.now() ms
}

export class TTLCache<K extends string, V> {
  private readonly _ttl: number;  // ms
  private readonly _map: Map<K, CacheEntry<V>> = new Map();

  constructor(ttlMs: number) {
    this._ttl = ttlMs;
  }

  get(key: K): CacheEntry<V> | undefined {
    const e = this._map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) {
      this._map.delete(key);
      return undefined;
    }
    return e;
  }

  set(key: K, value: V, etag: string): void {
    this._map.set(key, { value, etag, expiresAt: Date.now() + this._ttl });
  }

  delete(key: K): void {
    this._map.delete(key);
  }

  /** Number of non-expired entries currently in the cache. */
  size(): number {
    const now = Date.now();
    let count = 0;
    for (const e of this._map.values()) {
      if (now <= e.expiresAt) count++;
    }
    return count;
  }

  /** Remove all expired entries. */
  prune(): void {
    const now = Date.now();
    for (const [key, e] of this._map.entries()) {
      if (now > e.expiresAt) this._map.delete(key);
    }
  }
}

/**
 * Compute a short ETag from a value (SHA-256, first 32 hex chars, quoted).
 * The quote wrapping follows RFC 7232 §2.3: ETags are always quoted strings.
 */
export function computeEtag(value: unknown): string {
  return '"' + createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32) + '"';
}

// ── Board-read cache singleton ─────────────────────────────────────────────

const _ttlMs = (): number =>
  parseInt(process.env['ALIENCLAW_BOARD_CACHE_TTL_MS'] ?? '10000', 10) || 10000;

let _boardCache: TTLCache<string, unknown> | null = null;

/**
 * Singleton in-process cache for board reads.
 * Keyed by `${martian_type}:${n}`. TTL from ALIENCLAW_BOARD_CACHE_TTL_MS (default 10 000 ms).
 * Constructed on first call; the TTL is read at construction time.
 */
export function boardCache(): TTLCache<string, unknown> {
  if (!_boardCache) _boardCache = new TTLCache(_ttlMs());
  return _boardCache;
}

/** Reset the board cache singleton (for tests). */
export function _resetBoardCache(): void {
  _boardCache = null;
}
