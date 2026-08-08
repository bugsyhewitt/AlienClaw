/**
 * governance-loop-handle-user-input.test.ts
 *
 * Covers the three classification branches of `handleUserInput()` (L687-698)
 * in `src/alienclaw/governance/common/governance-loop.ts` (PKT-326).
 *
 * All three arms were confirmed cold by processEvent.test.ts (vi.fn() stub)
 * and goal-loop-e2e.test.ts (spy without body execution).
 *
 * Arm A (new_subgoal  L688-691): generateSubGoals + foldUserInput + status + dispatchReadySubGoals
 * Arm B (constraint   L692-693): status only, no sub-goal generation
 * Arm C (else/direction_change L695-697): generateSubGoals + foldUserInput + dispatchReadySubGoals (no length message)
 */

import { describe, it, expect } from 'vitest';
import { GovernanceLoop } from '../../../src/alienclaw/governance/common/governance-loop.js';
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

// ── Base noop stubs (same idiom as governance-loop-pure-methods.test.ts) ─────

const noopAdvisorBot        = {} as unknown as AdvisorBot;
const noopCreatorBot        = {} as unknown as CreatorBot;
const noopAgentRegistry     = {} as unknown as AgentRegistry;
const noopTaskManager       = {} as unknown as TaskManager;
const noopEscalationHandler = {} as unknown as EscalationHandler;
const noopCompletionHandler = {} as unknown as CompletionHandler;
const noopAgentChannel      = {} as unknown as AgentChannel;
const noopAdapter           = {} as unknown as MartianSummonAdapter;

function makeNoop<T>(overrides: Partial<T> = {}): T {
  return overrides as unknown as T;
}

// ── Factory ────────────────────────────────────────────────────────────────────

interface LoopOverrides {
  bossBot?:     BossBot;
  goalManager?: GoalManager;
  userChannel?: UserChannel;
}

function makeLoop(overrides: LoopOverrides = {}): GovernanceLoop {
  const defaultGoalManager = makeNoop<GoalManager>({
    load: () => ({ version: '1', activeGoalId: null, goals: [] } as any),
  });
  const defaultUserChannel = makeNoop<UserChannel>({
    required: () => {},
    verbose:  () => {},
    status:   () => {},
    close:    () => {},
  });

  return new GovernanceLoop({
    bossBot:           overrides.bossBot    ?? ({} as unknown as BossBot),
    advisorBot:        noopAdvisorBot,
    creatorBot:        noopCreatorBot,
    agentRegistry:     noopAgentRegistry,
    goalManager:       overrides.goalManager ?? defaultGoalManager,
    taskManager:       noopTaskManager,
    escalationHandler: noopEscalationHandler,
    completionHandler: noopCompletionHandler,
    userChannel:       overrides.userChannel ?? defaultUserChannel,
    agentChannel:      noopAgentChannel,
    adapter:           noopAdapter,
  });
}

// ── Shared stub builder ───────────────────────────────────────────────────────

function makeStubs(classification: string): {
  bossBot:     BossBot;
  goalManager: GoalManager;
  foldCalls:   unknown[][];
} {
  const foldCalls: unknown[][] = [];

  const bossBot = makeNoop<BossBot>({
    classifyUserInput: async (_msg: string) => classification,
    generateSubGoals:  async (_msg: string) => [{ description: 'do-X', domain: 'web' }],
  });

  const goalManager = makeNoop<GoalManager>({
    load:           () => ({ version: '1', activeGoalId: null, goals: [] } as any),
    foldUserInput:  async (goalId: string, subs: unknown[]) => { foldCalls.push([goalId, subs]); },
    getReadySubGoals: () => [],   // short-circuit dispatchReadySubGoals; prevents real spawn
  });

  return { bossBot, goalManager, foldCalls };
}

// ── Helper: access private method via cast ────────────────────────────────────

function callHandleUserInput(loop: GovernanceLoop, message: string): Promise<void> {
  return (loop as unknown as { handleUserInput(m: string): Promise<void> })
    .handleUserInput.call(loop, message);
}

/** Set private state + currentGoalId directly — avoids the transition-graph path. */
function armLoop(loop: GovernanceLoop, goalId: string): void {
  (loop as any).state         = 'EXECUTING';
  (loop as any).currentGoalId = goalId;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GovernanceLoop.handleUserInput — three cold branches (PKT-326)', () => {

  it('Arm A — new_subgoal: calls foldUserInput and emits length status (L688-691)', async () => {
    const statusCalls: string[] = [];
    const { bossBot, goalManager, foldCalls } = makeStubs('new_subgoal');
    const userChannel = makeNoop<UserChannel>({
      required: () => {},
      verbose:  () => {},
      status:   (m: string) => { statusCalls.push(m); },
      close:    () => {},
    });

    const loop = makeLoop({ bossBot, goalManager, userChannel });
    armLoop(loop, 'goal-1');

    await callHandleUserInput(loop, 'also add search');

    expect(foldCalls).toHaveLength(1);
    expect(foldCalls[0]![0]).toBe('goal-1');
    expect(statusCalls.some(m => m.includes('sub-goal(s)'))).toBe(true);
  });

  it('Arm B — constraint: emits status only, no foldUserInput call (L692-693)', async () => {
    const statusCalls: string[] = [];
    const { bossBot, goalManager, foldCalls } = makeStubs('constraint');
    const userChannel = makeNoop<UserChannel>({
      required: () => {},
      verbose:  () => {},
      status:   (m: string) => { statusCalls.push(m); },
      close:    () => {},
    });

    const loop = makeLoop({ bossBot, goalManager, userChannel });
    armLoop(loop, 'goal-1');

    await callHandleUserInput(loop, 'do not use SQL');

    expect(statusCalls.some(m => m.includes('Constraint noted'))).toBe(true);
    expect(foldCalls).toHaveLength(0);
  });

  it('Arm C — direction_change: calls foldUserInput without length status message (L695-697)', async () => {
    const statusCalls: string[] = [];
    const { bossBot, goalManager, foldCalls } = makeStubs('direction_change');
    const userChannel = makeNoop<UserChannel>({
      required: () => {},
      verbose:  () => {},
      status:   (m: string) => { statusCalls.push(m); },
      close:    () => {},
    });

    const loop = makeLoop({ bossBot, goalManager, userChannel });
    armLoop(loop, 'goal-1');

    await callHandleUserInput(loop, 'let us pivot to Y');

    expect(foldCalls).toHaveLength(1);
    expect(foldCalls[0]![0]).toBe('goal-1');
    expect(statusCalls.some(m => m.includes('sub-goal(s)'))).toBe(false); // no length msg in else-arm
  });

});
