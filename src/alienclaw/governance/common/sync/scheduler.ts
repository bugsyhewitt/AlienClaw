/**
 * Network sync scheduler — periodic push/pull with the API server.
 *
 * CreatorBot calls SyncScheduler.start() once on boot. The scheduler
 * runs push/pull cycles at a configurable interval (default 5 minutes).
 * Uses node:timers setInterval — stops cleanly via stop().
 */

import type { NetworkAPIClient } from './client.js';
import { pushTopGenomes, type PushResult } from './push.js';
import { pullTopGenomes, type PullResult } from './pull.js';

export interface SyncSchedulerOptions {
  client:           NetworkAPIClient;
  machineHash:      string;
  populationsRoot:  string;
  martianTypes:     string[];
  /**
   * Install-level public leaderboard handle (^[A-Z]{8}$) for this node.
   *
   * Used as the board name for any pushed genome whose own
   * run_metadata.leaderboard_name is absent or invalid. The server
   * hard-requires leaderboard_name, so this is what keeps the push path
   * alive for entries that don't carry their own name. Default: DEFAULT_LEADERBOARD_NAME.
   */
  leaderboardName?: string;
  /** Interval between sync cycles in ms. Default: 5 minutes. */
  intervalMs?:      number;
  /** Max genomes to push per type per cycle. Default: 5. */
  pushTopN?:        number;
  /** Max genomes to pull per type per cycle. Default: 10. */
  pullTopN?:        number;
  onCycle?:         (summary: SyncCycleSummary) => void;
  onError?:         (err: unknown) => void;
}

export interface SyncCycleSummary {
  cycleAt:   string;  // ISO timestamp
  installed: boolean;
  push:      PushResult[];
  pull:      PullResult[];
  durationMs: number;
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes

/**
 * Fallback install-level leaderboard handle (^[A-Z]{8}$).
 *
 * Applied when a SyncScheduler is constructed without an explicit
 * `leaderboardName` and an entry carries no valid name of its own.
 * Operators are expected to override this with their own handle.
 */
export const DEFAULT_LEADERBOARD_NAME = 'ALIENBOT';

export class SyncScheduler {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _installed = false;
  private readonly opts: Required<SyncSchedulerOptions>;

  constructor(opts: SyncSchedulerOptions) {
    this.opts = {
      intervalMs:      DEFAULT_INTERVAL_MS,
      pushTopN:        5,
      pullTopN:        10,
      leaderboardName: DEFAULT_LEADERBOARD_NAME,
      onCycle:         () => undefined,
      onError:         () => undefined,
      ...opts,
    };
  }

  /**
   * Start the scheduler. Runs one cycle immediately, then every intervalMs.
   * Safe to call multiple times — idempotent.
   */
  start(): void {
    if (this._timer !== null) return;
    void this._runCycle();
    this._timer = setInterval(() => void this._runCycle(), this.opts.intervalMs);
    // Allow process to exit even if timer is running (unref for background use)
    this._timer.unref?.();
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  get isRunning(): boolean { return this._timer !== null; }

  private async _runCycle(): Promise<void> {
    const t0 = Date.now();
    const cycleAt = new Date().toISOString();
    try {
      // Install on first cycle (idempotent — server returns 200 if known)
      if (!this._installed) {
        const r = await this.opts.client.install(this.opts.machineHash);
        this._installed = r.ok;
      }

      const push = await pushTopGenomes(
        this.opts.client,
        this.opts.populationsRoot,
        this.opts.leaderboardName,
        this.opts.pushTopN,
      );
      const pull = await pullTopGenomes(
        this.opts.client,
        this.opts.martianTypes,
        this.opts.populationsRoot,
        this.opts.pullTopN,
      );

      const summary: SyncCycleSummary = {
        cycleAt,
        installed: this._installed,
        push,
        pull,
        durationMs: Date.now() - t0,
      };
      this.opts.onCycle(summary);
    } catch (err) {
      this.opts.onError(err);
    }
  }
}
