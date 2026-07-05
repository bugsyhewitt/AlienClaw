/**
 * completion-handler.test.ts
 *
 * Direct unit tests for `src/alienclaw/governance/common/completion-handler.ts` (packet 081).
 *
 * Background:
 *   `completion-handler.ts` (126 lines, 1 class) exposes 2 public methods on the
 *   `CompletionHandler` class:
 *     - review(goalId: string): Promise<CompletionReview>
 *       → { proceed: true }
 *       → { proceed: false, reopenIds: string[] }
 *     - promptSignoff(goalId: string): Promise<SignoffOutcome>
 *       → { approved: true }
 *       → { approved: false, instructions: string }
 *
 *   Plus 2 module-internal helpers (NOT exported, not part of the public surface):
 *     - goalStatusLines(goal)   — line 18
 *     - goalDoneLines(goal)     — line 28
 *
 *   The class is instantiated at CLI startup (`hierarchy-bootstrap.ts:78`:
 *   `new CompletionHandler(...)`) and used by `governance-loop.ts` after every
 *   sub-goal completes. A regression in:
 *     - the `review()` low-confidence short-circuit that returns
 *       `proceed: false` with the first incomplete sub-goal OR campaign id
 *       (or the first sub-goal as the final fallback)
 *     - the `review()` agent-channel audit-log writes (BossBot→AdvisorBot
 *       request, AdvisorBot→BossBot response — Rule 5 enforcement)
 *     - the `promptSignoff()` yes/y input normalization
 *     - the `promptSignoff()` rejection path that returns the trimmed
 *       instructions
 *     - the throw on missing goal id (both methods)
 *   …would silently break the goal-completion / user-sign-off flow with no
 *   test catching it today.
 *
 *   The module imports normalizeInput from `../../utils.js` — used in
 *   promptSignoff to fold user input case/whitespace; we stub UserChannel
 *   to control the input string.
 *
 * Wall discipline: no production code is modified. Test-only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CompletionHandler } from '../../../src/alienclaw/governance/common/completion-handler.js';

// ── Stub factories ──────────────────────────────────────────────────────────
// These match the shape of the real interfaces but capture every call so we
// can assert on argument flow without depending on the real AdvisorBot /
// GoalManager / channel implementations.

interface AdvisorBotStub {
  advise:        ReturnType<typeof vi.fn>;
  appendToSession: ReturnType<typeof vi.fn>;
}

interface GoalManagerStub {
  load: ReturnType<typeof vi.fn>;
}

interface UserChannelStub {
  prompt:  ReturnType<typeof vi.fn>;
  verbose: ReturnType<typeof vi.fn>;
}

interface AgentChannelCall {
  from:    string;
  to:      string;
  kind?:   string;
  content: string;
  ts?:     number;
  taskId?: string;
}

interface AgentChannelStub {
  send: ReturnType<typeof vi.fn>;
  sent: AgentChannelCall[];
}

function makeAdvisorBot(verdict: { verdict: string; confidence: 'low' | 'medium' | 'high' } = {
  verdict: 'looks done', confidence: 'high',
}): AdvisorBotStub {
  return {
    advise: vi.fn().mockResolvedValue(verdict),
    appendToSession: vi.fn(),
  };
}

function makeGoalManager(goals: Array<{
  id: string;
  description: string;
  subGoals: Array<{ id: string; description: string; status: string }>;
  scheme?: { campaigns: Array<{ id?: string; name: string; objective: string; status: string }> };
}> = []): GoalManagerStub {
  return { load: vi.fn().mockReturnValue({ goals }) };
}

function makeUserChannel(input: string = ''): UserChannelStub {
  return {
    prompt:  vi.fn().mockResolvedValue(input),
    verbose: vi.fn(),
  };
}

function makeAgentChannel(): AgentChannelStub {
  const sent: AgentChannelCall[] = [];
  return {
    send: vi.fn().mockImplementation((c: AgentChannelCall) => { sent.push(c); }),
    sent,
  };
}

// ── Helpers to build realistic goal fixtures ─────────────────────────────────

function makeGoal(overrides: Partial<{
  id: string;
  description: string;
  subGoals: Array<{ id: string; description: string; status: string }>;
  campaignStatus: string;
}> = {}) {
  const subGoals = overrides.subGoals ?? [
    { id: 'sg-1', description: 'subgoal one', status: 'complete' },
    { id: 'sg-2', description: 'subgoal two', status: 'complete' },
  ];
  return {
    id: overrides.id ?? 'goal-1',
    description: overrides.description ?? 'Build X',
    subGoals,
    scheme: overrides.campaignStatus
      ? { campaigns: [{ id: 'camp-1', name: 'C1', objective: 'do thing', status: overrides.campaignStatus }] }
      : undefined,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CompletionHandler', () => {
  let advisor:  AdvisorBotStub;
  let goalMgr:  GoalManagerStub;
  let userCh:   UserChannelStub;
  let agentCh:  AgentChannelStub;
  let handler:  CompletionHandler;

  beforeEach(() => {
    advisor = makeAdvisorBot();
    goalMgr = makeGoalManager([makeGoal()]);
    userCh  = makeUserChannel();
    agentCh = makeAgentChannel();
    handler = new CompletionHandler(
      advisor as any,
      goalMgr as any,
      userCh  as any,
      agentCh as any,
    );
  });

  // ── review() ─────────────────────────────────────────────────────────────

  describe('review(goalId)', () => {
    it('returns proceed: true when AdvisorBot reports high confidence', async () => {
      const out = await handler.review('goal-1');
      expect(out).toEqual({ proceed: true });
    });

    it('throws Error when goalId is not present in goals.json', async () => {
      await expect(handler.review('does-not-exist')).rejects.toThrow(
        'Goal does-not-exist not found',
      );
    });

    it('calls AdvisorBot.advise with a structured request containing the goal description and summary', async () => {
      await handler.review('goal-1');
      expect(advisor.advise).toHaveBeenCalledOnce();
      const [req, sessionKey] = advisor.advise.mock.calls[0]!;
      expect(req.requesterId).toBe('BossBot');
      expect(req.context).toContain('Build X');
      expect(req.context).toContain('subgoal one');
      expect(req.question).toContain('actually done');
      expect(sessionKey).toBe('goal-1');
    });

    it('writes BOTH directions to AgentChannel as the Rule-5 audit log', async () => {
      await handler.review('goal-1');
      expect(agentCh.send).toHaveBeenCalledTimes(2);
      expect(agentCh.sent[0]).toMatchObject({
        from: 'BossBot', to: 'AdvisorBot', kind: 'request', taskId: 'goal-1',
      });
      expect(agentCh.sent[1]).toMatchObject({
        from: 'AdvisorBot', to: 'BossBot', kind: 'response', taskId: 'goal-1',
      });
      expect(agentCh.sent[0]!.content).toContain('actually done');
      expect(agentCh.sent[1]!.content).toBe('looks done');
    });

    it('persists the request + verdict to AdvisorBot session log', async () => {
      await handler.review('goal-1');
      expect(advisor.appendToSession).toHaveBeenCalledTimes(2);
      expect(advisor.appendToSession.mock.calls[0]![1]).toBe('goal-1');
      expect(advisor.appendToSession.mock.calls[1]![1]).toBe('goal-1');
    });

    it('returns proceed: false with the first incomplete sub-goal id when confidence is low', async () => {
      advisor = makeAdvisorBot({ verdict: 'not really', confidence: 'low' });
      goalMgr = makeGoalManager([makeGoal({
        subGoals: [
          { id: 'sg-1', description: 'done item', status: 'complete' },
          { id: 'sg-2', description: 'open item',  status: 'pending'  },
          { id: 'sg-3', description: 'another',    status: 'pending'  },
        ],
      })]);
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );

      const out = await handler.review('goal-1');
      expect(out).toEqual({ proceed: false, reopenIds: ['sg-2'] });
    });

    it('falls back to the first incomplete CAMPAIGN id when all sub-goals are complete and confidence is low', async () => {
      advisor = makeAdvisorBot({ verdict: 'missed something', confidence: 'low' });
      goalMgr = makeGoalManager([makeGoal({
        subGoals: [
          { id: 'sg-1', description: 'done item', status: 'complete' },
          { id: 'sg-2', description: 'done item', status: 'complete' },
        ],
        campaignStatus: 'pending',
      })]);
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );

      const out = await handler.review('goal-1');
      expect(out).toEqual({ proceed: false, reopenIds: ['camp-1'] });
    });

    it('falls back to the FIRST sub-goal id when confidence is low and all items are complete', async () => {
      advisor = makeAdvisorBot({ verdict: 'not sure', confidence: 'low' });
      // everything complete; should fall back to goal.subGoals[0].id
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );

      const out = await handler.review('goal-1');
      expect(out).toEqual({ proceed: false, reopenIds: ['sg-1'] });
    });

    it('emits verbose log line BEFORE calling AdvisorBot', async () => {
      const callOrder: string[] = [];
      userCh.verbose = vi.fn().mockImplementation(() => { callOrder.push('verbose'); });
      advisor.advise = vi.fn().mockImplementation(async () => {
        callOrder.push('advise');
        return { verdict: 'ok', confidence: 'high' };
      });

      await handler.review('goal-1');
      expect(callOrder).toEqual(['verbose', 'advise']);
    });

    it('returns proceed: false with empty reopenIds and includes "(no items)" context when goal has no subGoals and no scheme (confidence: low)', async () => {
      advisor = makeAdvisorBot({ verdict: 'unclear', confidence: 'low' });
      goalMgr = makeGoalManager([{ id: 'goal-1', description: 'Build X', subGoals: [] }]);
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );

      const out = await handler.review('goal-1');

      // Branch 7 arm-1: reopenId is undefined → reopenIds = []
      expect(out).toEqual({ proceed: false, reopenIds: [] });

      // Branch 3 arm-1: summary is empty → '  (no items)' fallback fires
      const [req] = advisor.advise.mock.calls[0]!;
      expect(req.context).toContain('(no items)');
    });
  });

  // ── promptSignoff() ──────────────────────────────────────────────────────

  describe('promptSignoff(goalId)', () => {
    it('returns approved: true when user replies "yes"', async () => {
      userCh = makeUserChannel('yes');
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );
      const out = await handler.promptSignoff('goal-1');
      expect(out).toEqual({ approved: true });
    });

    it('returns approved: true when user replies "y" (shorthand)', async () => {
      userCh = makeUserChannel('y');
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );
      const out = await handler.promptSignoff('goal-1');
      expect(out).toEqual({ approved: true });
    });

    it('returns approved: false with trimmed instructions when user replies with anything else', async () => {
      userCh = makeUserChannel('   no, please add the export step   ');
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );
      const out = await handler.promptSignoff('goal-1');
      expect(out).toEqual({
        approved: false,
        instructions: 'no, please add the export step',
      });
    });

    it('throws Error when goalId is not present in goals.json', async () => {
      await expect(handler.promptSignoff('missing-goal')).rejects.toThrow(
        'Goal missing-goal not found',
      );
    });

    it('calls userChannel.prompt with a message containing the goal description and completed-item summary', async () => {
      goalMgr = makeGoalManager([makeGoal({
        subGoals: [
          { id: 'sg-1', description: 'first thing', status: 'complete' },
        ],
      })]);
      userCh = makeUserChannel('yes');
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );
      await handler.promptSignoff('goal-1');
      const msg = userCh.prompt.mock.calls[0]![0] as string;
      expect(msg).toContain('Build X');
      expect(msg).toContain('first thing');
      expect(msg).toContain('Sign off');
    });

    it('lists only items with status=complete in the done summary (filters pending)', async () => {
      goalMgr = makeGoalManager([makeGoal({
        subGoals: [
          { id: 'sg-1', description: 'finished work', status: 'complete' },
          { id: 'sg-2', description: 'pending work',  status: 'pending'  },
        ],
      })]);
      userCh = makeUserChannel('yes');
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );
      await handler.promptSignoff('goal-1');
      const msg = userCh.prompt.mock.calls[0]![0] as string;
      expect(msg).toContain('finished work');
      expect(msg).not.toContain('pending work');
    });

    it('handles a goal with an empty subGoals + empty scheme gracefully (no items line)', async () => {
      goalMgr = makeGoalManager([makeGoal({ subGoals: [] })]);
      userCh = makeUserChannel('yes');
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );
      const out = await handler.promptSignoff('goal-1');
      expect(out).toEqual({ approved: true });
      const msg = userCh.prompt.mock.calls[0]![0] as string;
      expect(msg).toContain('(no items)');
    });

    it('includes completed campaigns in the done summary when goal has a scheme', async () => {
      goalMgr = makeGoalManager([{
        id: 'goal-1',
        description: 'Build X',
        subGoals: [{ id: 'sg-1', description: 'subgoal one', status: 'complete' }],
        scheme: { campaigns: [
          { id: 'camp-1', name: 'Alpha', objective: 'alpha obj', status: 'complete' },
          { id: 'camp-2', name: 'Beta',  objective: 'beta obj',  status: 'pending'  },
        ]},
      }]);
      userCh = makeUserChannel('yes');
      handler = new CompletionHandler(
        advisor as any, goalMgr as any, userCh as any, agentCh as any,
      );
      await handler.promptSignoff('goal-1');
      const msg = userCh.prompt.mock.calls[0]![0] as string;
      expect(msg).toContain('Alpha');
      expect(msg).toContain('alpha obj');
      expect(msg).not.toContain('Beta');   // pending campaign is filtered out
    });
  });

  // ── Constructor + surface area ───────────────────────────────────────────

  describe('constructor + surface area', () => {
    it('exports CompletionHandler as a class with exactly 2 public methods', () => {
      // (We instantiate elsewhere; this guards against drift.)
      const proto = Object.getPrototypeOf(handler);
      const methodNames = Object.getOwnPropertyNames(proto).filter(
        (n) => n !== 'constructor' && typeof (handler as any)[n] === 'function',
      );
      // 2 public methods + (constructor is filtered)
      expect(methodNames.sort()).toEqual(['promptSignoff', 'review']);
    });

    it('does NOT call any constructor dependency at construction time', () => {
      const a = makeAdvisorBot();
      const g = makeGoalManager();
      const u = makeUserChannel();
      const c = makeAgentChannel();
      // eslint-disable-next-line no-new
      new CompletionHandler(a as any, g as any, u as any, c as any);
      expect(a.advise).not.toHaveBeenCalled();
      expect(a.appendToSession).not.toHaveBeenCalled();
      expect(g.load).not.toHaveBeenCalled();
      expect(u.prompt).not.toHaveBeenCalled();
      expect(c.send).not.toHaveBeenCalled();
    });
  });
});
