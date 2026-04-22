import { normalizeInput } from '../utils.js';
import type { AdvisorBot }  from '../agents/advisorbot.js';
import type { AgentChannel } from '../comms/agent-channel.js';
import type { GoalManager } from './goal-manager.js';
import type { UserChannel } from '../comms/user-channel.js';
import type { SubGoal }     from '../types.js';

export type CompletionReview =
  | { proceed: true }
  | { proceed: false; reopenIds: string[] };

export type SignoffOutcome =
  | { approved: true }
  | { approved: false; instructions: string };

// ── Shared helpers ────────────────────────────────────────────────────────────

function goalStatusLines(goal: { subGoals: SubGoal[]; scheme?: { campaigns: Array<{ name: string; objective: string; status: string }> } }): string[] {
  const subGoalLines = goal.subGoals
    .map(s => `  [${s.status.toUpperCase()}] ${s.description}`);
  const campaignLines = (goal.scheme?.campaigns ?? [])
    .map(c => `  [${c.status.toUpperCase()}] Campaign "${c.name}": ${c.objective}`);
  return [...subGoalLines, ...campaignLines];
}

function goalDoneLines(goal: { subGoals: SubGoal[]; scheme?: { campaigns: Array<{ name: string; objective: string; status: string }> } }): string[] {
  const subGoalLines = goal.subGoals
    .filter(s => s.status === 'complete')
    .map((s: SubGoal) => `  ✓ ${s.description}`);
  const campaignLines = (goal.scheme?.campaigns ?? [])
    .filter(c => c.status === 'complete')
    .map(c => `  ✓ Campaign "${c.name}": ${c.objective}`);
  return [...subGoalLines, ...campaignLines];
}

export class CompletionHandler {
  constructor(
    private advisorBot:   AdvisorBot,
    private goalManager:   GoalManager,
    private userChannel:   UserChannel,
    private agentChannel:  AgentChannel,
  ) {}

  /**
   * BossBot asks AdvisorBot whether the goal is genuinely complete.
   * Returns proceed=true if clean, or proceed=false with IDs to re-open.
   *
   * Phase 2B: stub AdvisorBot always approves. Low-confidence stubs
   * cause a reopen so the state machine exercises that path.
   */
  async review(goalId: string): Promise<CompletionReview> {
    const file    = this.goalManager.load();
    const goal    = file.goals.find(g => g.id === goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const summary = goalStatusLines(goal);

    this.userChannel.verbose(`Reviewing completion with AdvisorBot for "${goal.description}"`);

    const adviceReq = {
      requesterId: 'BossBot' as const,
      context:
        `Goal "${goal.description}" completion review:\n${summary.join('\n') || '  (no items)'}`,
      question: 'Is this actually done? What might we have missed?',
    };

    // Use goalId as the advisory session key for completion review
    const verdict = await this.advisorBot.advise(adviceReq, goalId);

    this.advisorBot.appendToSession('BossBot', goalId, {
      from: 'BossBot', to: 'AdvisorBot', content: adviceReq.question, ts: Date.now(),
    });
    this.advisorBot.appendToSession('BossBot', goalId, {
      from: 'AdvisorBot', to: 'BossBot', content: verdict.verdict, ts: Date.now(),
    });
    // Route through AgentChannel for the structural audit log (Rule 5)
    this.agentChannel.send({
      from: 'BossBot', to: 'AdvisorBot', kind: 'request',
      content: adviceReq.question, ts: Date.now(), taskId: goalId,
    });
    this.agentChannel.send({
      from: 'AdvisorBot', to: 'BossBot', kind: 'response',
      content: verdict.verdict, ts: Date.now(), taskId: goalId,
    });

    // Low-confidence: flag the first incomplete item to re-exercise the state machine
    if (verdict.confidence === 'low') {
      const firstIncompleteSubGoal = goal.subGoals.find(s => s.status !== 'complete');
      const firstIncompleteCampaign = (goal.scheme?.campaigns ?? [])
        .find(c => c.status !== 'complete');
      const reopenId = firstIncompleteSubGoal?.id
        ?? firstIncompleteCampaign?.id
        ?? goal.subGoals[0]?.id;
      return { proceed: false, reopenIds: reopenId ? [reopenId] : [] };
    }

    return { proceed: true };
  }

  /**
   * Surfaces the completed goal to the user and awaits sign-off.
   * Returns approved=true or approved=false with change instructions.
   */
  async promptSignoff(goalId: string): Promise<SignoffOutcome> {
    const file = this.goalManager.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const allDone = goalDoneLines(goal);

    const msg =
      `Goal complete: "${goal.description}"\n` +
      `Accomplished:\n${allDone.join('\n') || '  (no items)'}\n\n` +
      `AdvisorBot has reviewed and agrees.\n` +
      `Sign off? (yes / no + instructions)`;

    const response = await this.userChannel.prompt(msg);
    const input   = normalizeInput(response);

    if (input === 'yes' || input === 'y') {
      return { approved: true };
    }

    return { approved: false, instructions: response.trim() };
  }
}
