import { normalizeInput } from '../../utils.js';
import { DEFAULT_BUDGET_EXTENSION } from '../../constants.js';
import type { TaskEnvelope } from '../../types.js';
import type { AdvisorBot } from '../../agents/advisorbot.js';
import type { CreatorBot }  from '../../agents/creatorbot.js';
import type { AgentChannel }  from '../../comms/agent-channel.js';
import type { TaskManager } from './task-manager.js';
import type { UserChannel }  from '../../comms/user-channel.js';
import { telemetryWriter }   from '../../telemetry/telemetry-writer.js';

export type StrikeAction =
  | { action: 'REBUILD' }
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
    private agentChannel: AgentChannel,
  ) {}

  /**
   * Called by GovernanceLoop on every JOB_FAILED event.
   *
   * Records the attempt (which increments strikeCount) then decides:
   *   - SURFACE_USER when MAX_STRIKE_COUNT is reached
   *   - REBUILD otherwise (after consulting AdvisorBot)
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

    const advice = await this.advisorBot.advise(adviceReq, advisorTaskId);

    this.advisorBot.appendToSession('BossBot', advisorTaskId, {
      from: 'BossBot', to: 'AdvisorBot', content: adviceReq.question, ts: Date.now(),
    });
    this.advisorBot.appendToSession('BossBot', advisorTaskId, {
      from: 'AdvisorBot', to: 'BossBot', content: advice.verdict, ts: Date.now(),
    });
    // Route through AgentChannel for the structural audit log (Rule 5)
    this.agentChannel.send({
      from: 'BossBot', to: 'AdvisorBot', kind: 'request',
      content: adviceReq.question, ts: Date.now(), taskId: advisorTaskId,
    });
    this.agentChannel.send({
      from: 'AdvisorBot', to: 'BossBot', kind: 'response',
      content: advice.verdict, ts: Date.now(), taskId: advisorTaskId,
    });

    // Record attempt with the AdvisorBot verdict and post-increment strike count
    this.taskManager.recordAttempt(task.taskId, {
      attemptNumber:  task.strikeCount + 1,
      subagentId:     task.assignedTo ?? 'unknown',
      failureReason,
      advisorVerdict: advice.verdict,
      ts:             Date.now(),
    });

    // Telemetry: record failforward event
    void telemetryWriter.writeFailforward({
      taskId:          task.taskId,
      domain,
      strikeCount:     task.strikeCount + 1,
      failureReason,
      advisorVerdict:  advice.verdict,
      advisorConfidence: advice.confidence,
    });

    // Caller (GovernanceLoop) spawns a fresh Subagent for the retry.
    void toolTags; // parameter kept for API stability; no longer used to build a SubagentSpec
    return { action: 'REBUILD' };
  }

  /**
   * Called when Strike 3 is reached. Surfaces the failure to the user and
   * awaits their decision. Does not mutate task state — caller owns that.
   */
  async handleStrikeThree(task: TaskEnvelope): Promise<UserStrikeResponse> {
    const raw      = await this.userChannel.strikeAlert(task, false);
    const input     = normalizeInput(raw);

    if (input === 'abandon') {
      return { outcome: 'abandon' };
    }

    if (input.startsWith('budget:')) {
      const n = parseInt(input.slice('budget:'.length), 10);
      return { outcome: 'resume_budget', budget: isNaN(n) ? DEFAULT_BUDGET_EXTENSION : n };
    }

    // Everything else is treated as new instructions
    return { outcome: 'new_instructions', instructions: raw.trim() };
  }
}
