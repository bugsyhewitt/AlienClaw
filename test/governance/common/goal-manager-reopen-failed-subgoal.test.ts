/**
 * goal-manager-reopen-failed-subgoal.test.ts
 *
 * DEFECT: `CompletionHandler.review()` picks the REOPEN target with
 *
 *   subGoals.find(s => s.status !== 'complete')
 *
 * (src/alienclaw/governance/common/completion-handler.ts:75 in the fitness-gate
 * branch and :121 in the low-confidence branch).
 *
 * A sub-goal whose status is 'failed' satisfies `status !== 'complete'`, so a
 * sub-goal the USER EXPLICITLY ABANDONED is selected as the reopen target.
 * governance-loop.ts:760 then flips it back:
 *
 *   await this.goalManager.updateSubGoal(goalId, id, { status: 'pending', taskId: undefined });
 *
 * and governance-loop.ts:766 re-dispatches it. The abandoned work is silently
 * resurrected.
 *
 * 'failed' is produced on the live wire path at governance-loop.ts:635
 * (user-abandon branch):
 *
 *   await this.goalManager.updateSubGoal(event.goalId, event.subGoalId, { status: 'failed' });
 *
 * The overmind named this exact defect as a residual of the PKT-1446 approval
 * (issues.md:41326-41332): "the low-fitness / low-confidence reopen path can
 * flip a user-ABANDONED sub-goal back to 'pending' ... the find should skip
 * 'failed'."
 *
 * Wall discipline: test-only. No production code is modified by this file.
 */

import { describe, it, expect, vi } from 'vitest';

import { CompletionHandler } from '../../../src/alienclaw/governance/common/completion-handler.js';
import { REVIEW_THRESHOLD } from '../../../src/alienclaw/governance/common/advisor-bot.js';

// ── Stub factories (mirror the shape used by completion-handler.test.ts) ─────

function makeAdvisorBot(verdict: { verdict: string; confidence: 'low' | 'medium' | 'high' } = {
  verdict: 'looks done', confidence: 'high',
}) {
  return {
    advise:         vi.fn().mockResolvedValue(verdict),
    appendToSession: vi.fn(),
  };
}

function makeGoalManager(goals: any[]) {
  return { load: vi.fn().mockReturnValue({ goals }) };
}

function makeUserChannel(input: string = '') {
  return {
    prompt:  vi.fn().mockResolvedValue(input),
    verbose: vi.fn(),
  };
}

function makeAgentChannel() {
  const sent: any[] = [];
  return {
    send: vi.fn().mockImplementation((c: any) => { sent.push(c); }),
    sent,
  };
}

function makeHandler(
  goals: any[],
  confidence: 'low' | 'medium' | 'high' = 'low',
  fitness?: number,
) {
  const advisor = makeAdvisorBot({ verdict: 'v', confidence });
  const goalMgr = makeGoalManager(goals);
  const userCh  = makeUserChannel();
  const agentCh = makeAgentChannel();
  const handler = new CompletionHandler(
    advisor as any, goalMgr as any, userCh as any, agentCh as any,
  );
  return { handler, advisor, goalMgr, userCh, agentCh };
}


/** Narrow the CompletionReview union so `reopenIds` is accessible in TS. */
function reopenIdsOf(review: { proceed: boolean; reopenIds?: string[] }): string[] {
  return (review as { reopenIds?: string[] }).reopenIds ?? [];
}

describe("CompletionHandler.review() — must not reopen a user-ABANDONED ('failed') sub-goal", () => {
  // ── Group 1: the low-confidence reopen path (completion-handler.ts:121) ────

  it('R-1501-1: low-confidence review does NOT select a failed sub-goal as the reopen target', async () => {
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-failed',  description: 'abandoned by user', status: 'failed' },
        { id: 'sg-pending', description: 'still to do',          status: 'pending' },
      ],
    }], 'low');

    const review = await handler.review('g1');

    expect(review.proceed).toBe(false);
    // The ABANDONED sub-goal must not be the reopen target.
    expect(reopenIdsOf(review)).not.toContain('sg-failed');
    // The genuinely-incomplete sub-goal is the right target.
    expect(reopenIdsOf(review)).toEqual(['sg-pending']);
  });

  it('R-1501-2: low-confidence review with ONLY a failed sub-goal does not reopen it', async () => {
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-failed', description: 'abandoned by user', status: 'failed' },
      ],
    }], 'low');

    const review = await handler.review('g1');

    expect(review.proceed).toBe(false);
    expect(reopenIdsOf(review)).not.toContain('sg-failed');
  });

  it('R-1501-3: low-confidence review skips the failed sub-goal and picks the first NON-FAILED incomplete one', async () => {
    // Ordering contract: the fix must skip ONLY 'failed'. The first remaining
    // non-'complete' sub-goal in declaration order wins — 'active' here, exactly
    // as pristine did for a non-failed list. (Pristine picked 'sg-failed' for
    // this fixture; the fix must not change any non-'failed' ordering.)
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-failed',  description: 'abandoned', status: 'failed' },
        { id: 'sg-active',  description: 'in flight',  status: 'active' },
        { id: 'sg-pending', description: 'to do',     status: 'pending' },
      ],
    }], 'low');

    const review = await handler.review('g1');

    expect(reopenIdsOf(review)).not.toContain('sg-failed');
    expect(reopenIdsOf(review)).toEqual(['sg-active']);
  });

  it('R-1501-3b: low-confidence review picks the pending sub-goal when the failed one is the only earlier one', async () => {
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-failed',  description: 'abandoned', status: 'failed' },
        { id: 'sg-pending', description: 'to do',     status: 'pending' },
      ],
    }], 'low');

    const review = await handler.review('g1');

    expect(reopenIdsOf(review)).toEqual(['sg-pending']);
  });

  // ── Group 2: the fitness-gate reopen path (completion-handler.ts:75) ──────

  it('R-1501-4: fitness-gate review does NOT select a failed sub-goal as the reopen target', async () => {
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-failed',  description: 'abandoned by user', status: 'failed' },
        { id: 'sg-pending', description: 'still to do',         status: 'pending' },
      ],
    }], 'high', 0.1);   // fitness below REVIEW_THRESHOLD → fitness gate fires

    const review = await handler.review('g1', 0.1);

    expect(review.proceed).toBe(false);
    expect(reopenIdsOf(review)).not.toContain('sg-failed');
    expect(reopenIdsOf(review)).toEqual(['sg-pending']);
  });

  it('R-1501-5: fitness-gate review with ONLY a failed sub-goal does not reopen it', async () => {
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-failed', description: 'abandoned by user', status: 'failed' },
      ],
    }], 'high', 0.1);

    const review = await handler.review('g1', 0.1);

    expect(review.proceed).toBe(false);
    expect(reopenIdsOf(review)).not.toContain('sg-failed');
  });

  it('R-1501-6: NaN fitness still fires the gate AND still skips the failed sub-goal', async () => {
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-failed',  description: 'abandoned', status: 'failed' },
        { id: 'sg-pending', description: 'to do',     status: 'pending' },
      ],
    }], 'high', NaN);

    const review = await handler.review('g1', NaN);

    expect(review.proceed).toBe(false);
    expect(reopenIdsOf(review)).not.toContain('sg-failed');
  });

  // ── Group 3: the production seam — governance-loop flips it back to pending ─

  it('R-1501-7: the reopen target is never a failed sub-goal, so governance-loop cannot resurrect it', async () => {
    // This mirrors governance-loop.ts:754-760 verbatim: for each reopenId the
    // loop calls updateSubGoal(goalId, id, { status: 'pending' }).
    const updateSubGoal = vi.fn();
    const goal = {
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-failed',  description: 'abandoned by user', status: 'failed' },
        { id: 'sg-pending', description: 'still to do',         status: 'pending' },
      ],
    };
    const { handler } = makeHandler([goal], 'low');
    const review = await handler.review('g1');

    // governance-loop.ts:754-760
    for (const id of reopenIdsOf(review)) {
      updateSubGoal('g1', id, { status: 'pending', taskId: undefined });
    }

    // The abandoned sub-goal's status on disk must be untouched.
    expect(updateSubGoal).not.toHaveBeenCalledWith(
      'g1', 'sg-failed', expect.anything(),
    );
  });

  // ── Group 4: regression guards — the existing correct behaviour must hold ──

  it('R-1501-8: REGRESSION — a pending sub-goal is still selected (guard against over-filtering)', async () => {
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-complete', description: 'done',    status: 'complete' },
        { id: 'sg-pending',  description: 'to do',   status: 'pending' },
      ],
    }], 'low');

    const review = await handler.review('g1');
    expect(reopenIdsOf(review)).toEqual(['sg-pending']);
  });

  it('R-1501-9: REGRESSION — an active sub-goal is still selectable (PKT-1446 leaves active alone)', async () => {
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-active', description: 'in flight', status: 'active' },
      ],
    }], 'low');

    const review = await handler.review('g1');
    expect(reopenIdsOf(review)).toEqual(['sg-active']);
  });

  it('R-1501-10: REGRESSION — the final fallback still returns the first sub-goal when all are complete', async () => {
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [
        { id: 'sg-1', description: 'one', status: 'complete' },
        { id: 'sg-2', description: 'two', status: 'complete' },
      ],
    }], 'low');

    const review = await handler.review('g1');
    expect(reopenIdsOf(review)).toEqual(['sg-1']);
  });

  it('R-1501-11: REGRESSION — REVIEW_THRESHOLD boundary does NOT fire the gate (exclusive)', async () => {
    const advisor = makeAdvisorBot({ verdict: 'v', confidence: 'high' });
    const goalMgr = makeGoalManager([{
      id: 'g1',
      description: 'Goal',
      subGoals: [{ id: 'sg-pending', description: 'to do', status: 'pending' }],
    }]);
    const handler = new CompletionHandler(
      advisor as any, goalMgr as any, makeUserChannel() as any, makeAgentChannel() as any,
    );

    const review = await handler.review('g1', REVIEW_THRESHOLD);
    // At exactly the threshold the gate does NOT fire → AdvisorBot is consulted →
    // high confidence → proceed.
    expect(advisor.advise).toHaveBeenCalled();
    expect(review.proceed).toBe(true);
  });

  it('R-1501-12: REGRESSION — a failed CAMPAIGN is not affected (campaigns cannot reach failed today)', async () => {
    const { handler } = makeHandler([{
      id: 'g1',
      description: 'Goal',
      subGoals: [{ id: 'sg-complete', description: 'done', status: 'complete' }],
      scheme: { campaigns: [{ id: 'camp-1', name: 'C', objective: 'o', status: 'pending' }] },
    }], 'low');

    const review = await handler.review('g1');
    expect(reopenIdsOf(review)).toEqual(['camp-1']);
  });
});
