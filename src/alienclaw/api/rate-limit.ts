/**
 * Per-install token bucket rate limiting — flat-file persistent.
 * TypeScript port of api/rate_limit.py (Packet 31.5).
 *
 * 100 submissions per install per rolling 3600s window.
 * Flat-file persistence; in-memory cache; lazy-loaded.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

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
      this._cache.set(installId, state.window_timestamps.map(iso => new Date(iso).getTime() / 1000));
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
      const tmp = join(dirname(path), `.tmp-${randomBytes(6).toString('hex')}`);
      writeFileSync(tmp, JSON.stringify(data, null, 0), 'utf8');
      // Atomic rename
      renameSync(tmp, path);
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
