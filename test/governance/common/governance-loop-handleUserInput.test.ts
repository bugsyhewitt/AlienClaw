/**
 * governance-loop-handleUserInput.test.ts
 *
 * Covers all 4 execution paths of GovernanceLoop.handleUserInput() (HUI-101–104).
 * handleUserInput is called by processEvent when a USER_INPUT event is dispatched
 * during an active goal. All branches are tested with lightweight stubs — no DB,
 * no LLM, no campaignCreatorBot.
 *
 * Branches covered:
 *   HUI-101 — guard: currentGoalId is null → delegates to handleUserGoal
 *   HUI-102 — guard: state is IDLE (even with currentGoalId set) → delegates to handleUserGoal
 *   HUI-103 — classification 'new_subgoal' → classify + generate + fold + status + dispatch
 *   HUI-104 — classification 'constraint' → status only; no sub-goals generated
 *   HUI-105 — classification 'direction_change' (else) → generate + fold + dispatch, no sub-goal status
 *
 * No source files are modified.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GovernanceLoop } from '../../../src/alienclaw/governance/common/governance-loop.js';
import type { BossBot }           from '../../../src/alienclaw/agents/bossbot.js';
import type { AdvisorBot }        from '../../../src/alienclaw/agents/advisorbot.js';
import type { CreatorBot }        from '../../../src/alienclaw/agents/creatorbot.js';
import type { AgentRegistry }     from '../../../src/alienclaw/agents/agent-registry.js';
import type { GoalManager }       from '../../../src/alienclaw/governance/common/goal-manager.js';
import type { TaskManager }       from '../../../src/alienclaw/governance/common/task-manager.js';
import type { EscalationHandler } from '../../../src/alienclaw/governance/common/escalation-handler.js';
import type { CompletionHandler } from '../../../src/alienclaw/governance/common/completion-handler.js';
import type { MartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { UserChannel }       from '../../../src/alienclaw/comms/user-channel.js';
import type { AgentChannel }      from '../../../src/alienclaw/comms/agent-channel.js';
import type { SubGoal, GoalsFile } from '../../../src/alienclaw/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSubGoal(id: string): SubGoal {
  return { id, description: `task ${id}`, domain: 'compute', status: 'pending', dependsOn: [] };
}

function makeUserChannel(): { channel: UserChannel; status: ReturnType<typeof vi.fn>; verbose: ReturnType<typeof vi.fn> } {
  const status  = vi.fn();
  const verbose = vi.fn();
  const channel = { status, verbose, required: vi.fn(), close: vi.fn() } as unknown as UserChannel;
  return { channel, status, verbose };
}

interface Stubs {
  classifyUserInput: ReturnType<typeof vi.fn>;
  generateSubGoals:  ReturnType<typeof vi.fn>;
  foldUserInput:     ReturnType<typeof vi.fn>;
}

function buildLoop(stubs: Partial<Stubs> = {}): {
  loop: GovernanceLoop;
  uc:   ReturnType<typeof makeUserChannel>;
  stubs: Stubs;
} {
  const classifyUserInput = stubs.classifyUserInput ?? vi.fn().mockResolvedValue('new_subgoal');
  const generateSubGoals  = stubs.generateSubGoals  ?? vi.fn().mockResolvedValue([]);
  const foldUserInput     = stubs.foldUserInput     ?? vi.fn().mockResolvedValue(undefined);

  const bossBot = { classifyUserInput, generateSubGoals } as unknown as BossBot;
  const goalManager = {
    load: () => ({ version: '1', activeGoalId: null, goals: [] }) as GoalsFile,
    foldUserInput,
  } as unknown as GoalManager;

  const uc = makeUserChannel();

  const loop = new GovernanceLoop({
    bossBot,
    advisorBot:        {} as unknown as AdvisorBot,
    creatorBot:        {} as unknown as CreatorBot,
    agentRegistry:     {} as unknown as AgentRegistry,
    goalManager,
    taskManager:       {} as unknown as TaskManager,
    escalationHandler: {} as unknown as EscalationHandler,
    completionHandler: {} as unknown as CompletionHandler,
    userChannel:       uc.channel,
    agentChannel:      {} as unknown as AgentChannel,
    adapter:           {} as unknown as MartianSummonAdapter,
  });

  return { loop, uc, stubs: { classifyUserInput, generateSubGoals, foldUserInput } };
}

// ── HUI-101: guard — currentGoalId is null ────────────────────────────────────

describe('GovernanceLoop.handleUserInput — HUI-101: guard (currentGoalId null)', () => {
  it('delegates to handleUserGoal when currentGoalId is null', async () => {
    const { loop } = buildLoop();
    // Default state: currentGoalId = null, state = IDLE

    const handleUserGoalSpy = vi.spyOn(loop as any, 'handleUserGoal').mockResolvedValue(undefined);

    await (loop as any).handleUserInput('add a feature');

    expect(handleUserGoalSpy).toHaveBeenCalledOnce();
    expect(handleUserGoalSpy).toHaveBeenCalledWith('add a feature');
  });

  it('does not classify or fold when guarded (currentGoalId null)', async () => {
    const { loop, stubs } = buildLoop();

    vi.spyOn(loop as any, 'handleUserGoal').mockResolvedValue(undefined);
    await (loop as any).handleUserInput('add a feature');

    expect(stubs.classifyUserInput).not.toHaveBeenCalled();
    expect(stubs.generateSubGoals).not.toHaveBeenCalled();
    expect(stubs.foldUserInput).not.toHaveBeenCalled();
  });
});

// ── HUI-102: guard — state is IDLE ────────────────────────────────────────────

describe('GovernanceLoop.handleUserInput — HUI-102: guard (state IDLE)', () => {
  it('delegates to handleUserGoal when state is IDLE even if currentGoalId is set', async () => {
    const { loop } = buildLoop();
    // Set currentGoalId but keep state = IDLE (default)
    (loop as any).currentGoalId = 'g-active';
    // state is already 'IDLE' (the field default)

    const handleUserGoalSpy = vi.spyOn(loop as any, 'handleUserGoal').mockResolvedValue(undefined);

    await (loop as any).handleUserInput('change direction');

    expect(handleUserGoalSpy).toHaveBeenCalledOnce();
    expect(handleUserGoalSpy).toHaveBeenCalledWith('change direction');
  });
});

// ── HUI-103: new_subgoal branch ───────────────────────────────────────────────

describe('GovernanceLoop.handleUserInput — HUI-103: new_subgoal branch', () => {
  const GOAL_ID = 'g-active-103';
  const NEW_SUBS = [makeSubGoal('sg-new-1'), makeSubGoal('sg-new-2')];

  let loop:     GovernanceLoop;
  let uc:       ReturnType<typeof makeUserChannel>;
  let stubs:    Stubs;
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ({ loop, uc, stubs } = buildLoop({
      classifyUserInput: vi.fn().mockResolvedValue('new_subgoal'),
      generateSubGoals:  vi.fn().mockResolvedValue(NEW_SUBS),
      foldUserInput:     vi.fn().mockResolvedValue(undefined),
    }));
    (loop as any).currentGoalId = GOAL_ID;
    (loop as any).state = 'EXECUTING';
    dispatchSpy = vi.spyOn(loop as any, 'dispatchReadySubGoals').mockResolvedValue(undefined);
  });

  it('classifies the message', async () => {
    await (loop as any).handleUserInput('add logging');
    expect(stubs.classifyUserInput).toHaveBeenCalledWith('add logging');
  });

  it('generates sub-goals from the message', async () => {
    await (loop as any).handleUserInput('add logging');
    expect(stubs.generateSubGoals).toHaveBeenCalledWith('add logging');
  });

  it('folds generated sub-goals into the active goal', async () => {
    await (loop as any).handleUserInput('add logging');
    expect(stubs.foldUserInput).toHaveBeenCalledWith(GOAL_ID, NEW_SUBS);
  });

  it('emits "Folding" status before classification', async () => {
    await (loop as any).handleUserInput('add logging');
    expect(uc.status).toHaveBeenCalledWith('Folding user input into active plan.');
  });

  it('emits "Added N sub-goal(s)" status after folding', async () => {
    await (loop as any).handleUserInput('add logging');
    expect(uc.status).toHaveBeenCalledWith(`Added ${NEW_SUBS.length} sub-goal(s) to the plan.`);
  });

  it('dispatches ready sub-goals for the active goal', async () => {
    await (loop as any).handleUserInput('add logging');
    expect(dispatchSpy).toHaveBeenCalledWith(GOAL_ID);
  });
});

// ── HUI-104: constraint branch ────────────────────────────────────────────────

describe('GovernanceLoop.handleUserInput — HUI-104: constraint branch', () => {
  const GOAL_ID = 'g-active-104';

  it('emits "Constraint noted" status and does not generate sub-goals', async () => {
    const { loop, uc, stubs } = buildLoop({
      classifyUserInput: vi.fn().mockResolvedValue('constraint'),
    });
    (loop as any).currentGoalId = GOAL_ID;
    (loop as any).state = 'EXECUTING';

    const dispatchSpy = vi.spyOn(loop as any, 'dispatchReadySubGoals').mockResolvedValue(undefined);

    await (loop as any).handleUserInput('never use files in /tmp');

    expect(uc.status).toHaveBeenCalledWith(
      'Constraint noted. Will inform active subagents (next iteration).'
    );
    expect(stubs.generateSubGoals).not.toHaveBeenCalled();
    expect(stubs.foldUserInput).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

// ── HUI-105: else / direction_change branch ───────────────────────────────────

describe('GovernanceLoop.handleUserInput — HUI-105: direction_change (else) branch', () => {
  const GOAL_ID  = 'g-active-105';
  const NEW_SUBS = [makeSubGoal('sg-dir-1')];

  let loop:     GovernanceLoop;
  let uc:       ReturnType<typeof makeUserChannel>;
  let stubs:    Stubs;
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ({ loop, uc, stubs } = buildLoop({
      classifyUserInput: vi.fn().mockResolvedValue('direction_change'),
      generateSubGoals:  vi.fn().mockResolvedValue(NEW_SUBS),
      foldUserInput:     vi.fn().mockResolvedValue(undefined),
    }));
    (loop as any).currentGoalId = GOAL_ID;
    (loop as any).state = 'EXECUTING';
    dispatchSpy = vi.spyOn(loop as any, 'dispatchReadySubGoals').mockResolvedValue(undefined);
  });

  it('generates sub-goals from the message', async () => {
    await (loop as any).handleUserInput('actually, prioritize performance');
    expect(stubs.generateSubGoals).toHaveBeenCalledWith('actually, prioritize performance');
  });

  it('folds generated sub-goals into the active goal', async () => {
    await (loop as any).handleUserInput('actually, prioritize performance');
    expect(stubs.foldUserInput).toHaveBeenCalledWith(GOAL_ID, NEW_SUBS);
  });

  it('dispatches ready sub-goals', async () => {
    await (loop as any).handleUserInput('actually, prioritize performance');
    expect(dispatchSpy).toHaveBeenCalledWith(GOAL_ID);
  });

  it('does NOT emit "Added N sub-goal(s)" status (that message is new_subgoal only)', async () => {
    await (loop as any).handleUserInput('actually, prioritize performance');
    const calls = uc.status.mock.calls.map((c: unknown[]) => c[0]);
    const hadSubGoalStatus = calls.some((msg: unknown) =>
      typeof msg === 'string' && msg.startsWith('Added ')
    );
    expect(hadSubGoalStatus).toBe(false);
  });
});
