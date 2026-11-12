/**
 * goal-manager-write-path-subgoals-envelope.test.ts
 *
 * File-A for PKT-1464 — the WRITE-path `subGoals` envelope on
 * `src/alienclaw/governance/common/goal-manager.ts`.
 *
 * Two layers, both on the WRITE path (the read path is already hardened at
 * L112 `getReadySubGoals`, L124 `isGoalComplete`, L147 `markGoalComplete`):
 *
 *   LAYER 1 — PARENT ENVELOPE
 *     `load()` does `JSON.parse(readFileSync(GOALS_PATH, 'utf-8')) as GoalsFile`
 *     (L50) — an unvalidated cast. A goals.json whose goal lacks `subGoals`
 *     (or has it null / non-array) reaches:
 *       - `updateSubGoal`  L92  `goal.subGoals.find(...)`  -> TypeError
 *       - `foldUserInput`  L132 `goal.subGoals.push(...)` -> TypeError
 *     The read-path siblings guard; these two mutating methods did not.
 *
 *   LAYER 2 — ELEMENT FILTER (foldUserInput only)
 *     `foldUserInput` persists `newSubGoals` verbatim. A subGoal with no `id`
 *     can never be dispatched (dispatchReadySubGoals keys on `s.id`); a
 *     subGoal with a `status` outside the GoalStatus union can never be
 *     flipped to 'complete'. Either one permanently blocks the parent goal:
 *     markGoalComplete's PKT-905 guard then refuses to complete the goal and
 *     no reader can clear the blocker.
 *
 * Design decision (stated, not left as an option):
 *   - elements  -> FAIL-QUIET (drop the malformed element), matching the
 *     read-path symmetry at L112 / L124 / L147.
 *   - `newSubGoals` argument -> FAIL-LOUD (throw), because a non-array
 *     argument is a caller bug, not a data-shape defect.
 *
 * This file replaces the never-shipped PKT-1345 File-A
 * (`test/governance/common/goal-manager-f303.test.ts`, ABSENT from HEAD)
 * and adds the PKT-1370 F-1370-A..E element cases.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

// ─── Env setup ──────────────────────────────────────────────────────────────

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'p1464-gmgr-'));
  process.env['ALIENCLAW_HOME'] = homeDir;
  vi.resetModules();
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env['ALIENCLAW_HOME'];
  vi.resetModules();
});

async function loadGoalManager(): Promise<{
  GoalManager: new () => InstanceType<typeof import('../../../src/alienclaw/governance/common/goal-manager.js').GoalManager>;
  PATHS: { goals: string };
}> {
  const mod = await import('../../../src/alienclaw/governance/common/goal-manager.js');
  const consts = await import('../../../src/alienclaw/constants.js');
  return { GoalManager: mod.GoalManager, PATHS: consts.PATHS };
}

// ─── Fixture builders ───────────────────────────────────────────────────────

function writeGoalsFile(path: string, goals: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ version: '1', activeGoalId: 'g1', goals }, null, 2),
    'utf-8',
  );
}

function makeSubGoal(id: string, overrides: Record<string, unknown> = {}): any {
  return {
    id,
    description: `sg-${id}`,
    domain: 'test',
    status: 'pending',
    dependsOn: [],
    ...overrides,
  };
}

function readGoals(path: string): any {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ─── LAYER 1 — parent envelope ──────────────────────────────────────────────

describe('PKT-1464 — write-path parent envelope: goal.subGoals is not an array', () => {
  it('foldUserInput folds into a goal whose subGoals is missing (undefined)', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'legacy goal', status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await expect(gm.foldUserInput('g1', [makeSubGoal('sg-new')])).resolves.toBeUndefined();

    const onDisk = readGoals(PATHS.goals);
    expect(Array.isArray(onDisk.goals[0].subGoals)).toBe(true);
    expect(onDisk.goals[0].subGoals).toHaveLength(1);
    expect(onDisk.goals[0].subGoals[0].id).toBe('sg-new');
  });

  it('foldUserInput folds into a goal whose subGoals is null', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'null-subgoals goal', subGoals: null, status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await expect(gm.foldUserInput('g1', [makeSubGoal('sg-new')])).resolves.toBeUndefined();

    const onDisk = readGoals(PATHS.goals);
    expect(onDisk.goals[0].subGoals).toHaveLength(1);
    expect(onDisk.goals[0].subGoals[0].id).toBe('sg-new');
  });

  it('foldUserInput folds into a goal whose subGoals is a non-array object', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'object-subgoals goal', subGoals: { 'sg-x': {} }, status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await expect(gm.foldUserInput('g1', [makeSubGoal('sg-new')])).resolves.toBeUndefined();

    const onDisk = readGoals(PATHS.goals);
    expect(Array.isArray(onDisk.goals[0].subGoals)).toBe(true);
    expect(onDisk.goals[0].subGoals).toHaveLength(1);
  });

  it('updateSubGoal throws a controlled "SubGoal not found" (not a TypeError) when subGoals is undefined', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'legacy goal', status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await expect(gm.updateSubGoal('g1', 'sg1', { status: 'complete' }))
      .rejects.toThrow(/SubGoal sg1 not found/);
    await expect(gm.updateSubGoal('g1', 'sg1', { status: 'complete' }))
      .rejects.not.toBeInstanceOf(TypeError);
  });

  it('updateSubGoal throws a controlled "SubGoal not found" (not a TypeError) when subGoals is null', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'null-subgoals goal', subGoals: null, status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await expect(gm.updateSubGoal('g1', 'sg1', { status: 'complete' }))
      .rejects.toThrow(/SubGoal sg1 not found/);
  });
});

// ─── LAYER 2 — element filter ───────────────────────────────────────────────

describe('PKT-1464 — foldUserInput element filter (fail-quiet)', () => {
  it('drops a subGoal element missing its id field', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'g', subGoals: [makeSubGoal('sg-ok')], status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    const noId = { description: 'bad', domain: 'test', status: 'pending', dependsOn: [] };
    await gm.foldUserInput('g1', [noId as any]);

    const onDisk = readGoals(PATHS.goals);
    expect(onDisk.goals[0].subGoals).toHaveLength(1);
    expect(onDisk.goals[0].subGoals[0].id).toBe('sg-ok');
  });

  it('drops a subGoal element whose status is outside the GoalStatus union', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'g', subGoals: [makeSubGoal('sg-ok')], status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await gm.foldUserInput('g1', [makeSubGoal('sg-bad', { status: 'BOGUS_STATUS' }) as any]);

    const onDisk = readGoals(PATHS.goals);
    expect(onDisk.goals[0].subGoals).toHaveLength(1);
    expect(onDisk.goals[0].subGoals[0].id).toBe('sg-ok');
  });

  it('drops a subGoal element whose dependsOn is not an array', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'g', subGoals: [makeSubGoal('sg-ok')], status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await gm.foldUserInput('g1', [makeSubGoal('sg-bad', { dependsOn: 'not-an-array' }) as any]);

    const onDisk = readGoals(PATHS.goals);
    expect(onDisk.goals[0].subGoals).toHaveLength(1);
    expect(onDisk.goals[0].subGoals[0].id).toBe('sg-ok');
  });

  it('drops a subGoal element whose dependsOn holds a non-string member', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'g', subGoals: [makeSubGoal('sg-ok')], status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await gm.foldUserInput('g1', [makeSubGoal('sg-bad', { dependsOn: ['ok', 7] }) as any]);

    const onDisk = readGoals(PATHS.goals);
    expect(onDisk.goals[0].subGoals).toHaveLength(1);
    expect(onDisk.goals[0].subGoals[0].id).toBe('sg-ok');
  });

  it('drops a null / non-object element', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'g', subGoals: [makeSubGoal('sg-ok')], status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await gm.foldUserInput('g1', [null as any, 'nope' as any, 42 as any]);

    const onDisk = readGoals(PATHS.goals);
    expect(onDisk.goals[0].subGoals).toHaveLength(1);
    expect(onDisk.goals[0].subGoals[0].id).toBe('sg-ok');
  });

  it('throws (fail-loud) when newSubGoals itself is not an array', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'g', subGoals: [], status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await expect(gm.foldUserInput('g1', 'not-an-array' as any))
      .rejects.toThrow(/newSubGoals must be an array/);
  });
});

// ─── CONTROL — happy path preserved ─────────────────────────────────────────

describe('PKT-1464 — control: well-formed input keeps its existing behaviour', () => {
  it('appends to the existing subGoals, preserving order', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'g', subGoals: [makeSubGoal('sg1')], status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await gm.foldUserInput('g1', [makeSubGoal('sg-new-1') as any, makeSubGoal('sg-new-2') as any]);

    const onDisk = readGoals(PATHS.goals);
    expect(onDisk.goals[0].subGoals).toHaveLength(3);
    expect(onDisk.goals[0].subGoals.map((s: any) => s.id)).toEqual(['sg1', 'sg-new-1', 'sg-new-2']);
  });

  it('updateSubGoal still mutates a matching subGoal', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'g', subGoals: [makeSubGoal('sg1')], status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await gm.updateSubGoal('g1', 'sg1', { status: 'complete' });

    const onDisk = readGoals(PATHS.goals);
    expect(onDisk.goals[0].subGoals[0].status).toBe('complete');
  });

  it('updateSubGoal still throws "SubGoal not found" for an unknown id', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'g', subGoals: [makeSubGoal('sg1')], status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await expect(gm.updateSubGoal('g1', 'nope', { status: 'complete' }))
      .rejects.toThrow(/SubGoal nope not found/);
  });

  it('accepts a subGoal with an empty id-string? NO — empty id is dropped', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    writeGoalsFile(PATHS.goals, [
      { id: 'g1', description: 'g', subGoals: [], status: 'active', createdAt: 1 },
    ]);

    const gm = new GoalManager();
    await gm.foldUserInput('g1', [makeSubGoal('') as any]);

    const onDisk = readGoals(PATHS.goals);
    expect(onDisk.goals[0].subGoals).toHaveLength(0);
  });
});
