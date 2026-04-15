import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AGENT_MODELS, EMPLOYEE_DEFAULT_MODEL, DOMAIN_SLUG_MAX } from '../constants.js';
import { errorMessage } from '../utils.js';
import type {
  EmployeeSpec, CreatorQueueItem, CreatorQueuePriority,
  Campaign, Scheme, SpecialistRole,
} from '../types.js';
import { buildSpecialist, registerEmployee } from './employee.js';
import type { Employee } from './employee.js';

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
        spec.onComplete?.(result);
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

  // ── Employee spec ──────────────────────────────────────────────────────────

  buildEmployeeSpec(
    domain: string,
    toolTags: string[],
    model: string,
    generation = 1,
  ): EmployeeSpec {
    const suffix     = Date.now().toString(36).toUpperCase();
    const employeeId = `EMP_${domain.toUpperCase().slice(0, DOMAIN_SLUG_MAX)}_${suffix}`;
    return {
      employeeId,
      domain,
      model,
      toolTags,
      createdBy:  'CreatorBot',
      createdAt:  Date.now(),
      generation,
    };
  }

  // ── Specialist / Campaign building ─────────────────────────────────────────

  /**
   * Build a single Specialist Employee for a given role within a campaign.
   *
   * The specialist carries the campaign-specific knowledgeBase in its soul
   * and is registered in the global employee registry immediately.
   */
  buildSpecialistForRole(
    role:       SpecialistRole,
    campaignId: string,
    generation  = 1
  ): Employee {
    const suffix     = Date.now().toString(36).toUpperCase();
    const roleSlug   = role.domain.toUpperCase().slice(0, DOMAIN_SLUG_MAX);
    const employeeId = `SPEC_${roleSlug}_${suffix}`;

    const spec: EmployeeSpec = {
      employeeId,
      domain:     role.domain,
      model:      EMPLOYEE_DEFAULT_MODEL,
      toolTags:   role.martianTags,
      createdBy:  'CreatorBot',
      createdAt:  Date.now(),
      generation,
    };

    const specialist = buildSpecialist(spec, role, campaignId);
    registerEmployee(specialist);

    this.enqueue(
      'NOTABLE',
      `Specialist ${employeeId} built for campaign ${campaignId} (role: ${role.role})`,
      `Domain: ${role.domain}, Tags: ${role.martianTags.join(', ')}`
    );

    return specialist;
  }

  /**
   * Build all specialists for every campaign in a Scheme.
   *
   * Campaigns are ready to build if their dependsOn list is empty or
   * all dependencies are in the provided completedIds set.
   * Returns a map of campaignId → specialist Employee[].
   *
   * Note: this builds ALL campaigns immediately (governance-loop tracks
   * which campaigns are ready to EXECUTE based on dependency state).
   */
  buildSchemeSpecialists(scheme: Scheme): Map<string, Employee[]> {
    const result = new Map<string, Employee[]>();

    for (const campaign of scheme.campaigns) {
      const specialists: Employee[] = [];

      for (const role of campaign.specialists) {
        const specialist = this.buildSpecialistForRole(role, campaign.id);
        specialists.push(specialist);
      }

      result.set(campaign.id, specialists);
      campaign.specialistIds = specialists.map(s => s.id);
    }

    this.enqueue(
      'NOTABLE',
      `Scheme specialists built: ${scheme.campaigns.length} campaign(s), ` +
      `${scheme.campaigns.reduce((n, c) => n + c.specialists.length, 0)} specialist(s) total`,
      `Goal: ${scheme.goalId}`
    );

    return result;
  }
}

export const creatorBot = new CreatorBot();
