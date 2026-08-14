import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AGENT_MODELS, CREATOR_QUEUE_MAX } from '../constants.js';
import { errorMessage } from '../utils.js';
import type {
  CreatorQueueItem, CreatorQueuePriority,
} from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_PATH  = join(__dirname, '..', 'prompts', 'creatorbot.soul.md');

// ---------------------------------------------------------------------------
// Scheduling types
// ---------------------------------------------------------------------------

export interface ScheduledJob {
  /** Human-readable label for this job */
  label:        string;
  /** Interval in milliseconds */
  intervalMs:   number;
  /** The work to run */
  fn:           () => Promise<void>;
  /** Timer handle (NodeJS) */
  _handle?:     ReturnType<typeof setInterval>;
}

// ---------------------------------------------------------------------------
// Subagent types
// ---------------------------------------------------------------------------

export interface SubagentSpec {
  /** What the subagent should accomplish */
  task:        string;
  /** Domain context (e.g. "genome-mutation", "registry-audit") */
  domain:      string;
  /** Optional callback invoked with the result */
  onComplete?: (result: unknown) => void;
  /** Optional callback invoked on error */
  onError?:    (err: Error) => void;
}

// ---------------------------------------------------------------------------
// CreatorBot
// ---------------------------------------------------------------------------

export class CreatorBot {
  readonly name  = 'CreatorBot' as const;
  readonly model = AGENT_MODELS.CreatorBot;
  readonly soul  = readFileSync(SOUL_PATH, 'utf-8');

  private queue: CreatorQueueItem[]  = [];
  private scheduledJobs: ScheduledJob[] = [];

  /**
   * Active subagents spawned by CreatorBot.
   * There is NO cap — CreatorBot may spawn as many subagents as the task
   * requires. Each entry is a running Promise.
   */
  private activeSubagents: Set<Promise<void>> = new Set();

  systemPrompt(): string {
    return this.soul;
  }

  // ── Queue ──────────────────────────────────────────────────────────────────

  enqueue(priority: CreatorQueuePriority, observation: string, context: string): void {
    if (this.queue.length >= CREATOR_QUEUE_MAX) {
      // Priority-aware drop: evict the oldest NOTABLE first; only fall back to
      // dropping the oldest URGENT when no NOTABLE remains. This preserves the
      // URGENT > NOTABLE invariant that flushNotable/peekUrgent/consumeUrgent
      // (L75-89) rely on — a plain shift() violates it when NOTABLE entries flood
      // the cap and cause the oldest URGENT to be evicted instead.
      const notableIdx = this.queue.findIndex(i => i.priority === 'NOTABLE');
      if (notableIdx !== -1) {
        this.queue.splice(notableIdx, 1);
      } else {
        this.queue.shift();  // only URGENTs remain; drop oldest URGENT
      }
    }
    this.queue.push({ priority, observation, context, ts: Date.now() });
  }

  flushNotable(): CreatorQueueItem[] {
    const notable = this.queue.filter(i => i.priority === 'NOTABLE');
    this.queue    = this.queue.filter(i => i.priority !== 'NOTABLE');
    return notable;
  }

  peekUrgent(): CreatorQueueItem | undefined {
    return this.queue.find(i => i.priority === 'URGENT');
  }

  consumeUrgent(): CreatorQueueItem | undefined {
    const idx = this.queue.findIndex(i => i.priority === 'URGENT');
    if (idx === -1) return undefined;
    return this.queue.splice(idx, 1)[0];
  }

  // ── Scheduling ─────────────────────────────────────────────────────────────

  /**
   * Register a recurring scheduled job.
   * CreatorBot operates primarily on a scheduled cadence; BossBot requests
   * are the only out-of-band interrupts.
   *
   * Calling startScheduler() activates all registered jobs.
   */
  registerScheduledJob(job: ScheduledJob): void {
    // De-dup by label: startScheduler is idempotent by _handle (per-job-object);
    // registerScheduledJob MUST be idempotent by label (the only identifier the
    // registration exposes). Mirror of BrainRegistry.load hard-fail-on-duplicate
    // (src/alienclaw/brains/registry.py:117-122). Without this, two registrations
    // of the same label silently fire BOTH fn callbacks on every setInterval tick.
    const existing = this.scheduledJobs.find(j => j.label === job.label);
    if (existing) {
      throw new Error(
        `Duplicate scheduled-job label '${job.label}'. ` +
        `Each CreatorBot.registerScheduledJob call must use a unique label.`
      );
    }
    this.scheduledJobs.push(job);
  }

  /**
   * Start all registered scheduled jobs.
   * Safe to call multiple times — jobs already running are skipped.
   */
  startScheduler(): void {
    for (const job of this.scheduledJobs) {
      if (job._handle) continue; // already running
      job._handle = setInterval(async () => {
        try {
          await job.fn();
        } catch (err) {
          this.enqueue(
            'NOTABLE',
            `Scheduled job "${job.label}" threw: ${errorMessage(err)}`,
            `Job: ${job.label}`
          );
        }
      }, job.intervalMs);
    }
  }

  /**
   * Stop all scheduled jobs (e.g. on shutdown).
   */
  stopScheduler(): void {
    for (const job of this.scheduledJobs) {
      if (job._handle) {
        clearInterval(job._handle);
        job._handle = undefined;
      }
    }
  }

  // ── Subagents ──────────────────────────────────────────────────────────────

  /**
   * Spawn a subagent to handle a specific task.
   * There is NO cap on concurrent subagents — CreatorBot may spawn as many
   * as required. Each subagent runs as a fire-and-forget Promise tracked
   * in activeSubagents.
   */
  spawnSubagent(spec: SubagentSpec, work: () => Promise<unknown>): void {
    const promise: Promise<void> = work()
      .then(result => {
        try {
          spec.onComplete?.(result);
        } catch (cbErr) {
          this.enqueue('NOTABLE', `onComplete threw: ${errorMessage(cbErr)}`, spec.domain);
        }
      })
      .catch(err => {
        const msg = errorMessage(err);
        const error = err instanceof Error ? err : new Error(msg);
        if (spec.onError) {
          spec.onError(error);
        } else {
          this.enqueue(
            'NOTABLE',
            `Subagent for "${spec.task}" failed: ${msg}`,
            `Domain: ${spec.domain}`
          );
        }
      })
      .finally(() => {
        this.activeSubagents.delete(promise);
      });

    this.activeSubagents.add(promise);
  }

  /** Number of currently running subagents. */
  get subagentCount(): number {
    return this.activeSubagents.size;
  }

}


export const creatorBot = new CreatorBot();
