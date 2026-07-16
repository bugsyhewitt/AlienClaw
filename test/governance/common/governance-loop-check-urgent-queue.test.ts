/**
 * governance-loop-check-urgent-queue.test.ts
 *
 * Covers paths B and C of `checkUrgentQueue()` (L810-832) in
 * `src/alienclaw/governance/common/governance-loop.ts` — both previously
 * unreachable because every existing test mocks `peekUrgent` to return null.
 *
 *   Path B (L814): urgent item exists but CREATOR_INTERRUPT is not in
 *     VALID_TRANSITIONS for the current state → early return, advise not called.
 *   Path C (L816-832): urgent item exists and CREATOR_INTERRUPT is valid →
 *     full round-trip: consumeUrgent, transition, advise, transition back.
 *
 * Mock infrastructure mirrors governance-loop-pure-methods.test.ts (packet 099).
 */

import { describe, it, expect, vi } from 'vitest';
import { GovernanceLoop } from '../../../src/alienclaw/governance/common/governance-loop.js';
import type { GovernanceLoopDeps } from '../../../src/alienclaw/governance/common/governance-loop.js';
import type { BossBot }            from '../../../src/alienclaw/agents/bossbot.js';
import type { AdvisorBot }         from '../../../src/alienclaw/agents/advisorbot.js';
import type { CreatorBot }         from '../../../src/alienclaw/agents/creatorbot.js';
import type { AgentRegistry }      from '../../../src/alienclaw/agents/agent-registry.js';
import type { GoalManager }        from '../../../src/alienclaw/governance/common/goal-manager.js';
import type { TaskManager }        from '../../../src/alienclaw/governance/common/task-manager.js';
import type { EscalationHandler }  from '../../../src/alienclaw/governance/common/escalation-handler.js';
import type { CompletionHandler }  from '../../../src/alienclaw/governance/common/completion-handler.js';
import type { MartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { UserChannel }        from '../../../src/alienclaw/comms/user-channel.js';
import type { AgentChannel }       from '../../../src/alienclaw/comms/agent-channel.js';
import type { GoalsFile }          from '../../../src/alienclaw/types.js';

// ── Noop dependency stubs (mirror governance-loop-pure-methods.test.ts) ──────

const noopBossBot           = {} as unknown as BossBot;
const noopAgentRegistry     = {} as unknown as AgentRegistry;
const noopTaskManager       = {} as unknown as TaskManager;
const noopEscalationHandler = {} as unknown as EscalationHandler;
const noopCompletionHandler = {} as unknown as CompletionHandler;
const noopAgentChannel      = {} as unknown as AgentChannel;
const noopAdapter           = {} as unknown as MartianSummonAdapter;

const noopGoalManager = {
  load: (): GoalsFile => ({ version: '1', activeGoalId: null, goals: [] }),
} as unknown as GoalManager;

// ── Path B — guard branch (L814) ─────────────────────────────────────────────

describe('GovernanceLoop.checkUrgentQueue — Path B (packet 169)', () => {
  it('urgent item in IDLE state → guard returns early, advise not called', async () => {
    const adviseSpy = vi.fn();

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      agentRegistry:     noopAgentRegistry,
      goalManager:       noopGoalManager,
      taskManager:       noopTaskManager,
      escalationHandler: noopEscalationHandler,
      completionHandler: noopCompletionHandler,
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
      creatorBot: {
        peekUrgent:    vi.fn(() => ({ priority: 'URGENT', observation: 'ignored', context: '', ts: 0 })),
        consumeUrgent: vi.fn(),
        flushNotable:  vi.fn(() => []),
      } as unknown as CreatorBot,
      advisorBot: {
        destroyTaskSessions: vi.fn(),
        advise: adviseSpy,
      } as unknown as AdvisorBot,
      userChannel: {
        required: vi.fn(),
        verbose:  vi.fn(),
        status:   vi.fn(),
        close:    vi.fn(),
      } as unknown as UserChannel,
    } satisfies GovernanceLoopDeps);

    // Loop starts in IDLE — CREATOR_INTERRUPT not in VALID_TRANSITIONS['IDLE']
    await (loop as any).checkUrgentQueue();

    expect(adviseSpy).not.toHaveBeenCalled();
  });
});

// ── Path C — happy path (L816-832) ────────────────────────────────────────────

describe('GovernanceLoop.checkUrgentQueue — Path C (packet 169)', () => {
  it('urgent item in EXECUTING state → consumeUrgent + advise + return to EXECUTING', async () => {
    const consumeUrgentSpy = vi.fn();
    const adviseSpy = vi.fn().mockResolvedValue({ verdict: 'proceed', recommendation: '', confidence: 'high' });
    const requiredSpy = vi.fn();
    const verboseSpy  = vi.fn();

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      agentRegistry:     noopAgentRegistry,
      goalManager:       noopGoalManager,
      taskManager:       noopTaskManager,
      escalationHandler: noopEscalationHandler,
      completionHandler: noopCompletionHandler,
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
      creatorBot: {
        peekUrgent:    vi.fn(() => ({ priority: 'URGENT', observation: 'test-obs', context: 'test-ctx', ts: 0 })),
        consumeUrgent: consumeUrgentSpy,
        flushNotable:  vi.fn(() => []),
      } as unknown as CreatorBot,
      advisorBot: {
        destroyTaskSessions: vi.fn(),
        advise: adviseSpy,
      } as unknown as AdvisorBot,
      userChannel: {
        required: requiredSpy,
        verbose:  verboseSpy,
        status:   vi.fn(),
        close:    vi.fn(),
      } as unknown as UserChannel,
    } satisfies GovernanceLoopDeps);

    // Force loop into EXECUTING via valid transition chain: IDLE → CREATOR_BUILDING → EXECUTING
    (loop as any).transition.call(loop, 'CREATOR_BUILDING', 'setup');
    (loop as any).transition.call(loop, 'EXECUTING',        'setup');

    await (loop as any).checkUrgentQueue();

    expect(consumeUrgentSpy).toHaveBeenCalledOnce();
    expect(adviseSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterId: 'BossBot',
        question:    expect.stringContaining('test-obs'),
      }),
    );
    expect(requiredSpy).toHaveBeenCalledWith(expect.stringContaining('[CreatorBot URGENT]'));
    // State returns to EXECUTING after the round-trip
    expect((loop as any).state).toBe('EXECUTING');
  });
});

// ── Path A — no urgent item (L812) ───────────────────────────────────────────

describe('GovernanceLoop.checkUrgentQueue — Path A (packet 240)', () => {
  it('no urgent item → early return, consumeUrgent and advise not called', async () => {
    const consumeSpy = vi.fn();
    const adviseSpy  = vi.fn();

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      agentRegistry:     noopAgentRegistry,
      goalManager:       noopGoalManager,
      taskManager:       noopTaskManager,
      escalationHandler: noopEscalationHandler,
      completionHandler: noopCompletionHandler,
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
      creatorBot: {
        peekUrgent:    vi.fn(() => undefined),
        consumeUrgent: consumeSpy,
        flushNotable:  vi.fn(() => []),
      } as unknown as CreatorBot,
      advisorBot: {
        destroyTaskSessions: vi.fn(),
        advise: adviseSpy,
      } as unknown as AdvisorBot,
      userChannel: {
        required: vi.fn(),
        verbose:  vi.fn(),
        status:   vi.fn(),
        close:    vi.fn(),
      } as unknown as UserChannel,
    } satisfies GovernanceLoopDeps);

    (loop as any).transition.call(loop, 'CREATOR_BUILDING', 'setup');
    (loop as any).transition.call(loop, 'EXECUTING',        'setup');

    await (loop as any).checkUrgentQueue();

    expect(consumeSpy).not.toHaveBeenCalled();
    expect(adviseSpy).not.toHaveBeenCalled();
  });
});
