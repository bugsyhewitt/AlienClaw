import type { AdvisorBot } from '../agents/advisorbot.js';
import type { BossBot }    from '../agents/bossbot.js';
import type { GoalManager } from './goal-manager.js';
import type { UserChannel } from '../comms/user-channel.js';
import type { SubGoal }     from '../types.js';

export type CompletionReview =
  | { proceed: true }
  | { proceed: false; reopenIds: string[] };

export type SignoffOutcome =
  | { approved: true }
  | { approved: false; instructions: string };

export class CompletionHandler {
  constructor(
    private advisorBot:  AdvisorBot,
    private bossBot:     BossBot,
    private goalManager: GoalManager,
    private userChannel: UserChannel,
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

    const subSummary = goal.subGoals
      .map(s => `  [${s.status.toUpperCase()}] ${s.description}`)
      .join('\n');

    this.userChannel.verbose(`Reviewing completion with AdvisorBot for "${goal.description}"`);

    const adviceReq = {
      requesterId: 'BossBot' as const,
      context:     `Goal "${goal.description}" sub-goals:\n${subSummary}`,
      question:    'Is this actually done? What might we have missed?',
    };

    // Use goalId as the advisory session key for completion review
    const verdict = await this.advisorBot.advise(adviceReq, goalId);

    this.advisorBot.appendToSession('BossBot', goalId, {
      from: 'BossBot', to: 'AdvisorBot', content: adviceReq.question, ts: Date.now(),
    });
    this.advisorBot.appendToSession('BossBot', goalId, {
      from: 'AdvisorBot', to: 'BossBot', content: verdict.verdict, ts: Date.now(),
    });

    void this.bossBot; // wired for Phase 3 synthesis

    // Low-confidence: flag the first sub-goal to re-exercise the state machine
    if (verdict.confidence === 'low') {
      const firstId = goal.subGoals[0]?.id;
      return { proceed: false, reopenIds: firstId ? [firstId] : [] };
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

    const done = goal.subGoals
      .filter(s => s.status === 'complete')
      .map((s: SubGoal) => `  ✓ ${s.description}`)
      .join('\n');

    const msg =
      `Goal complete: "${goal.description}"\n` +
      `Accomplished:\n${done}\n\n` +
      `AdvisorBot has reviewed and agrees.\n` +
      `Sign off? (yes / no + instructions)`;

    const response = await this.userChannel.prompt(msg);
    const trimmed  = response.trim().toLowerCase();

    if (trimmed === 'yes' || trimmed === 'y') {
      return { approved: true };
    }

    return { approved: false, instructions: response.trim() };
  }
}
