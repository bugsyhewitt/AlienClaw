/**
 * governance-loop-recover.test.ts
 *
 * Covers `recoverFromDisk()` (L836-846) and `stop()` (L152) in
 * `src/alienclaw/governance/common/governance-loop.ts` (packet 225).
 *
 * Four arms of recoverFromDisk():
 *   Arm 1 — no activeGoalId          → early return, no userChannel call
 *   Arm 2 — activeGoalId set, goal missing → early return, no userChannel call
 *   Arm 3 — goal status 'complete'   → userChannel.required with completion message
 *   Arm 4 — goal status 'active'     → resumeGoal(goal.id) dispatched
 *
 * stop():
 *   Sets this.running = false.
 *
 * Uses the noop-stub pattern from governance-loop.test.ts; no LLM stubs needed.
 */

import { describe, it, expect } from 'vitest';
import { GovernanceLoop }          from '../../../src/alienclaw/governance/common/governance-loop.js';
import type { GoalManager }        from '../../../src/alienclaw/governance/common/goal-manager.js';
import type { TaskManager }        from '../../../src/alienclaw/governance/common/task-manager.js';
import type { EscalationHandler }  from '../../../src/alienclaw/governance/common/escalation-handler.js';
import type { CompletionHandler }  from '../../../src/alienclaw/governance/common/completion-handler.js';
import type { BossBot }            from '../../../src/alienclaw/agents/bossbot.js';
import type { AdvisorBot }         from '../../../src/alienclaw/agents/advisorbot.js';
import type { CreatorBot }         from '../../../src/alienclaw/agents/creatorbot.js';
import type { AgentRegistry }      from '../../../src/alienclaw/agents/agent-registry.js';
import type { MartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { UserChannel }        from '../../../src/alienclaw/comms/user-channel.js';
import type { AgentChannel }       from '../../../src/alienclaw/comms/agent-channel.js';

// ── Shared noop stubs ─────────────────────────────────────────────────────────

const noopBossBot           = {} as unknown as BossBot;
const noopAdvisorBot        = {} as unknown as AdvisorBot;
const noopCreatorBot        = {} as unknown as CreatorBot;
const noopAgentRegistry     = {} as unknown as AgentRegistry;
const noopTaskManager       = {} as unknown as TaskManager;
const noopEscalationHandler = {} as unknown as EscalationHandler;
const noopCompletionHandler = {} as unknown as CompletionHandler;
const noopAgentChannel      = {} as unknown as AgentChannel;
const noopAdapter           = {} as unknown as MartianSummonAdapter;

function makeUserChannel(spy?: { required: string[] }): UserChannel {
  return {
    required: (msg: string) => { if (spy) spy.required.push(msg); },
    verbose:  () => {},
    status:   () => {},
    close:    () => {},
  } as unknown as UserChannel;
}

function makeLoop(goalManager: GoalManager, userChannel?: UserChannel): GovernanceLoop {
  return new GovernanceLoop({
    bossBot:           noopBossBot,
    advisorBot:        noopAdvisorBot,
    creatorBot:        noopCreatorBot,
    agentRegistry:     noopAgentRegistry,
    goalManager,
    taskManager:       noopTaskManager,
    escalationHandler: noopEscalationHandler,
    completionHandler: noopCompletionHandler,
    userChannel:       userChannel ?? makeUserChannel(),
    agentChannel:      noopAgentChannel,
    adapter:           noopAdapter,
  });
}

// ── recoverFromDisk() ─────────────────────────────────────────────────────────

describe('GovernanceLoop.recoverFromDisk — crash recovery arms (packet 225)', () => {
  it('Arm 1 — returns early with no userChannel call when activeGoalId is null', async () => {
    const goalManager = {
      load: () => ({ version: '1', activeGoalId: null, goals: [] }),
    } as unknown as GoalManager;

    const spy = { required: [] as string[] };
    const loop = makeLoop(goalManager, makeUserChannel(spy));

    await (loop as any).recoverFromDisk();

    expect(spy.required).toHaveLength(0);
  });

  it('Arm 1 — returns early with no userChannel call when activeGoalId is undefined', async () => {
    const goalManager = {
      load: () => ({ version: '1', activeGoalId: undefined, goals: [] }),
    } as unknown as GoalManager;

    const spy = { required: [] as string[] };
    const loop = makeLoop(goalManager, makeUserChannel(spy));

    await (loop as any).recoverFromDisk();

    expect(spy.required).toHaveLength(0);
  });

  it('Arm 2 — returns early with no userChannel call when activeGoalId has no matching goal', async () => {
    const goalManager = {
      load: () => ({ version: '1', activeGoalId: 'ghost-id', goals: [] }),
    } as unknown as GoalManager;

    const spy = { required: [] as string[] };
    const loop = makeLoop(goalManager, makeUserChannel(spy));

    await (loop as any).recoverFromDisk();

    expect(spy.required).toHaveLength(0);
  });

  it('Arm 3 — calls userChannel.required with completion message when goal status is complete', async () => {
    const goalManager = {
      load: () => ({
        version:      '1',
        activeGoalId: 'g1',
        goals: [{
          id:          'g1',
          description: 'My finished goal',
          status:      'complete' as const,
          subGoals:    [],
        }],
      }),
    } as unknown as GoalManager;

    const spy = { required: [] as string[] };
    const loop = makeLoop(goalManager, makeUserChannel(spy));

    await (loop as any).recoverFromDisk();

    expect(spy.required).toHaveLength(1);
    expect(spy.required[0]).toBe('Previous goal "My finished goal" is already complete.');
  });

  it('Arm 4 — calls resumeGoal(goal.id) when goal status is active', async () => {
    const goalManager = {
      load: () => ({
        version:      '1',
        activeGoalId: 'g2',
        goals: [{
          id:          'g2',
          description: 'Active goal',
          status:      'active' as const,
          subGoals:    [],
        }],
      }),
    } as unknown as GoalManager;

    const loop = makeLoop(goalManager);

    let resumedId = '';
    (loop as any).resumeGoal = async (id: string) => { resumedId = id; };

    await (loop as any).recoverFromDisk();

    expect(resumedId).toBe('g2');
  });
});

// ── stop() ───────────────────────────────────────────────────────────────────

describe('GovernanceLoop.stop — sets running to false (packet 225)', () => {
  it('sets this.running to false', () => {
    const goalManager = {
      load: () => ({ version: '1', activeGoalId: null, goals: [] }),
    } as unknown as GoalManager;

    const loop = makeLoop(goalManager);

    // running starts false; set it to true to confirm stop() changes it
    (loop as any).running = true;
    loop.stop();

    expect((loop as any).running).toBe(false);
  });
});
