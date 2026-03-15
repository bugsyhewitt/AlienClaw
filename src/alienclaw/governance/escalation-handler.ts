import { EMPLOYEE_DEFAULT_MODEL } from '../constants.js';
import type { TaskEnvelope, EmployeeSpec } from '../types.js';
import type { AdvisorBot } from '../agents/advisorbot.js';
import type { CreatorBot }  from '../agents/creatorbot.js';
import type { TaskManager } from './task-manager.js';
import type { UserChannel }  from '../comms/user-channel.js';
import { telemetryWriter }   from '../telemetry/telemetry-writer.js';

export type StrikeAction =
  | { action: 'REBUILD';      spec: EmployeeSpec }
  | { action: 'SURFACE_USER' };

export type UserStrikeResponse =
  | { outcome: 'new_instructions'; instructions: string }
  | { outcome: 'resume_budget';    budget: number }
  | { outcome: 'abandon' };

export class EscalationHandler {
  constructor(
    private advisorBot:   AdvisorBot,
    private creatorBot:   CreatorBot,
    private taskManager:  TaskManager,
    private userChannel:  UserChannel,
  ) {}

  /**
   * Called by GovernanceLoop on every JOB_FAILED event.
   *
   * Records the attempt (which increments strikeCount) then decides:
   *   - SURFACE_USER when MAX_STRIKE_COUNT is reached
   *   - REBUILD otherwise (after consulting AdvisorBot + briefing CreatorBot)
   *
   * State transitions (AWAITING_ADVICE, CREATOR_BUILDING) are owned by
   * GovernanceLoop, not here.
   */
  async handleFailure(
    task:          TaskEnvelope,
    domain:        string,
    toolTags:      string[],
    failureReason: string,
    /** BossBot's advisory session key for this task */
    advisorTaskId: string,
  ): Promise<StrikeAction> {
    // Record attempt — increments strikeCount
    this.taskManager.recordAttempt(task.taskId, {
      attemptNumber:  task.attempts.length + 1,
      employeeId:     task.assignedTo ?? 'unknown',
      failureReason,
      advisorVerdict: '',
      ts:             Date.now(),
    });

    if (this.taskManager.isExhausted(task.taskId)) {
      return { action: 'SURFACE_USER' };
    }

    // ── Consult AdvisorBot (BossBot session) ────────────────────────────────
    const adviceReq = {
      requesterId: 'BossBot' as const,
      context:
        `Task "${task.description}" (domain: ${domain}) failed attempt ${task.strikeCount}.\n` +
        `Previous attempts:\n${this.taskManager.getAttemptSummary(task.taskId)}`,
      question: 'What is your read on a new approach? What might be causing repeated failure?',
    };

    const session = this.advisorBot.getOrCreateSession('BossBot', advisorTaskId);
    const advice  = await this.advisorBot.advise(adviceReq, advisorTaskId);

    this.advisorBot.appendToSession('BossBot', advisorTaskId, {
      from: 'BossBot', to: 'AdvisorBot', content: adviceReq.question, ts: Date.now(),
    });
    this.advisorBot.appendToSession('BossBot', advisorTaskId, {
      from: 'AdvisorBot', to: 'BossBot', content: advice.verdict, ts: Date.now(),
    });

    void session; // session reference kept for future persistence

    // Telemetry: record failforward event
    void telemetryWriter.writeFailforward({
      taskId:        task.taskId,
      domain,
      strikeCount:   task.strikeCount,
      failureReason,
      advisorVerdict: advice.verdict,
      advisorConfidence: advice.confidence,
    });

    // ── Brief CreatorBot — direction only, not AdvisorBot's exact words ─────
    const direction =
      `Task ${task.taskId} in domain "${domain}" failed ${task.strikeCount} time(s). ` +
      `Adjust the Employee spec for better results in this domain.`;

    const spec = this.creatorBot.buildEmployeeSpec(
      domain,
      toolTags,
      EMPLOYEE_DEFAULT_MODEL,
      task.strikeCount + 1,
      direction,
    );

    return { action: 'REBUILD', spec };
  }

  /**
   * Called when Strike 3 is reached. Surfaces the failure to the user and
   * awaits their decision. Does not mutate task state — caller owns that.
   */
  async handleStrikeThree(task: TaskEnvelope): Promise<UserStrikeResponse> {
    const raw      = await this.userChannel.strikeAlert(task, false);
    const trimmed  = raw.trim().toLowerCase();

    if (trimmed === 'abandon') {
      return { outcome: 'abandon' };
    }

    if (trimmed.startsWith('budget:')) {
      const n = parseInt(trimmed.slice('budget:'.length), 10);
      return { outcome: 'resume_budget', budget: isNaN(n) ? 3 : n };
    }

    // Everything else is treated as new instructions
    return { outcome: 'new_instructions', instructions: raw.trim() };
  }
}
