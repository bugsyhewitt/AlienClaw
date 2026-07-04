/**
 * goal-manager.test.ts
 *
 * Direct unit tests for `src/alienclaw/governance/common/goal-manager.ts` (packet 079).
 *
 * Background:
 *   `goal-manager.ts` (191 lines, 1 class) exposes 1 public symbol:
 *     - GoalManager (class)              — 13 public methods
 *
 *   The 13 public methods are:
 *     - load()                                  (NOT covered — direct coverage)
 *     - save(file)                              (NOT covered — atomic write + lock)
 *     - addGoal(goal)                           (NOT covered — pushes + sets active)
 *     - updateSubGoal(goalId, subGoalId, patch) (NOT covered — throws on missing)
 *     - updateGoal(goalId, patch)               (NOT covered — throws on missing)
 *     - getReadySubGoals(file, goalId)          (NOT covered — dep + status filter)
 *     - isGoalComplete(file, goalId)            (NOT covered — empty-goal edge case)
 *     - foldUserInput(goalId, newSubGoals)      (NOT covered — appends + throws)
 *     - markGoalComplete(goalId)                (NOT covered — sets complete + clears active)
 *     - attachScheme(goalId, scheme)            (NOT covered — sets scheme + throws)
 *     - updateCampaign(goalId, campaignId, p)   (NOT covered — 2 throw sites)
 *     - getReadyCampaigns(file, goalId)         (NOT covered — empty/no-scheme edge case)
 *     - isSchemeComplete(file, goalId)          (NOT covered — empty/no-scheme edge case)
 *
 *   The class is instantiated by `src/alienclaw/wiring/hierarchy-bootstrap.ts:71`
 *   (CLI-startup bootstrap path) and used by `completion-handler.ts` and
 *   `governance-loop.ts`. A regression in the atomic-write lock (acquireLock →
 *   writeFileSync(tmp) → renameSync → releaseLock), the cache+dirty-bit flow,
 *   or the throw-on-missing-goal guard would silently corrupt the goals.json
 *   file or block CLI bootstrap with no test catching it today.
 *
 *   `getReadySubGoals` / `getReadyCampaigns` implement the dependency-aware
 *   scheduling logic that the campaign-ready events are derived from. A
 *   regression that returns ready subgoals whose dependencies are still
 *   pending would silently break the campaign execution order.
 *
 *   `isGoalComplete` / `isSchemeComplete` have the subtle empty-list short-circuit
 *   (return false when there are 0 subgoals/campaigns) — a regression here
 *   would cause the governance loop to mark an empty goal as "complete"
 *   immediately on creation.
 *
 * These tests use the mkdtempSync + ALIENCLAW_HOME env-var idiom (mirrors
 * packets 067, 068, 069, 070, 071, 076, 077): set the env var BEFORE the
 * dynamic import (via `vi.resetModules()`) so the module's top-level
 * `const GOALS_PATH = PATHS.goals` and `const LOCK_PATH = GOALS_PATH + '.lock'`
 * resolve to the temp dir.
 *
 * SCOPE NOTES (verified at this wake):
 *   - `load()` cache invalidation: only `_dirty` flip invalidates. We test the
 *     both cases (clean return + ENOENT fallback to default-empty).
 *   - `acquireLock` retries LOCK_MAX_TRIES (10) times with LOCK_RETRY_MS (50ms).
 *     We simulate an EEXIST by pre-creating the .lock file, then assert the
 *     method eventually throws. Total wallclock < 1s.
 *   - `releaseLock` is best-effort (try/catch). We do not directly assert on
 *     its behavior; we exercise it via `save()`.
 *   - `getReadySubGoals` and `getReadyCampaigns` both have the "no goal" /
 *     "no scheme" short-circuits returning `[]` — both covered.
 *   - `updateCampaign` has 2 throw sites (line 165 no-scheme + line 167
 *     no-campaign) — both covered.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Env setup ──────────────────────────────────────────────────────────────

let homeDir: string;

beforeEach(() => {
  // mkdtempSync is sync; safe at top of beforeEach.
  homeDir = mkdtempSync(join(tmpdir(), 'p079-gmgr-'));
  process.env['ALIENCLAW_HOME'] = homeDir;
  // Force the module under test to re-evaluate so PATHS picks up the new env.
  vi.resetModules();
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env['ALIENCLAW_HOME'];
  vi.resetModules();
});

// Helper: dynamic-import the module under test with the fresh env.
async function loadGoalManager(): Promise<{
  GoalManager: new () => InstanceType<typeof import('../../../src/alienclaw/governance/common/goal-manager.js').GoalManager>;
  PATHS: { goals: string };
}> {
  const mod = await import('../../../src/alienclaw/governance/common/goal-manager.js');
  const consts = await import('../../../src/alienclaw/constants.js');
  return { GoalManager: mod.GoalManager, PATHS: consts.PATHS };
}

// ─── Test fixture builders ──────────────────────────────────────────────────

function makeGoal(id: string, subGoals: any[] = [], overrides: Record<string, any> = {}): any {
  return {
    id,
    description: `desc-${id}`,
    subGoals,
    status: 'pending',
    createdAt: 1_000_000,
    ...overrides,
  };
}

function makeSubGoal(id: string, opts: { status?: string; dependsOn?: string[]; taskId?: string } = {}): any {
  return {
    id,
    description: `sg-${id}`,
    domain: 'test',
    status: opts.status ?? 'pending',
    dependsOn: opts.dependsOn ?? [],
    ...(opts.taskId ? { taskId: opts.taskId } : {}),
  };
}

function makeCampaign(id: string, opts: { status?: string; dependsOn?: string[] } = {}): any {
  return {
    id,
    name: `camp-${id}`,
    objective: `obj-${id}`,
    subagents: [],
    dependsOn: opts.dependsOn ?? [],
    status: opts.status ?? 'pending',
  };
}

function makeScheme(campaigns: any[]): any {
  return {
    goalId: 'g1',
    rationale: 'test rationale',
    campaigns,
    advisorEndorsement: 'endorsed',
    createdAt: 2_000_000,
  };
}

// ─── 1. load(): cache + ENOENT fallback ──────────────────────────────────────

describe('GoalManager.load() — initial load + cache + ENOENT fallback', () => {
  it('returns a default-empty GoalsFile when goals.json does not exist (ENOENT)', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const file = gm.load();
    expect(file.version).toBe('1');
    expect(file.activeGoalId).toBeNull();
    expect(file.goals).toEqual([]);
  });

  it('reads existing goals.json from ALIENCLAW_HOME/workspace/goals.json', async () => {
    // Pre-write a goals.json with one goal so load() reads from disk.
    const workspaceDir = join(homeDir, 'workspace');
    require('node:fs').mkdirSync(workspaceDir, { recursive: true });
    const goalsPath = join(workspaceDir, 'goals.json');
    const seedGoal = makeGoal('g-loaded', [makeSubGoal('sg1', { status: 'pending' })]);
    writeFileSync(goalsPath, JSON.stringify({
      version: '1', activeGoalId: 'g-loaded', goals: [seedGoal],
    }), 'utf-8');

    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const file = gm.load();
    expect(file.goals).toHaveLength(1);
    expect(file.goals[0].id).toBe('g-loaded');
    expect(file.activeGoalId).toBe('g-loaded');
  });

  it('caches the loaded GoalsFile (returns same reference on second call)', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const a = gm.load();
    const b = gm.load();
    expect(a).toBe(b); // same reference — cache hit
  });

  it('re-reads from disk after _dirty flips (cache invalidated by mutation)', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    gm.load(); // prime cache, returns default-empty
    // After load() with no on-disk file, _cached = { version: '1', activeGoalId: null, goals: [] }, _dirty = false.
    // Mutate cache via addGoal (sets _dirty = true). Save should write to disk.
    await gm.addGoal(makeGoal('g-mut', [makeSubGoal('sg1', { status: 'pending' })]));
    // After save, _dirty is reset to false. The on-disk file now exists.
    expect(existsSync(PATHS.goals)).toBe(true);
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals).toHaveLength(1);
    expect(onDisk.goals[0].id).toBe('g-mut');
    expect(onDisk.activeGoalId).toBe('g-mut');
  });

  it('throws "load goals: ..." when goals.json is malformed (line 59 throw site)', async () => {
    // Pre-write malformed JSON to goals.json so load() hits the parse-error branch.
    const workspaceDir = join(homeDir, 'workspace');
    require('node:fs').mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, 'goals.json'), '{ this is not valid JSON', 'utf-8');

    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    // Line 59: throw new Error(`load goals: ${errorMessage(err)}`) — non-ENOENT errors wrap and rethrow.
    expect(() => gm.load()).toThrow(/^load goals:/);
  });
});

// ─── 2. save(): atomic write + lock ─────────────────────────────────────────

describe('GoalManager.save() — atomic write + lock release', () => {
  it('writes a GoalsFile atomically (tmp → rename → lock released)', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    const file = {
      version: '1',
      activeGoalId: 'g-saved',
      goals: [makeGoal('g-saved', [makeSubGoal('sg1', { status: 'pending' })])],
    };
    await gm.save(file);
    expect(existsSync(PATHS.goals)).toBe(true);
    expect(existsSync(`${PATHS.goals}.tmp`)).toBe(false);
    expect(existsSync(`${PATHS.goals}.lock`)).toBe(false); // released after save
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals[0].id).toBe('g-saved');
    expect(onDisk.activeGoalId).toBe('g-saved');
  });

  it('creates ALIENCLAW_HOME/workspace with mkdirSync({recursive:true}) if missing', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    expect(existsSync(join(homeDir, 'workspace'))).toBe(false);
    const gm = new GoalManager();
    await gm.save({ version: '1', activeGoalId: null, goals: [] });
    expect(existsSync(join(homeDir, 'workspace'))).toBe(true);
    expect(existsSync(PATHS.goals)).toBe(true);
  });

  it('throws after LOCK_MAX_TRIES retries when .lock file is held', async () => {
    const { GoalManager } = await loadGoalManager();
    // ensureGoalsDir() is only called inside save() before acquireLock(); since
    // acquireLock runs first inside save() (after ensureGoalsDir), but we want
    // to simulate the lock being held BEFORE save() runs. Easiest: pre-create
    // the workspace dir, then write the lock file at PATHS.goals + '.lock'.
    const consts = await import('../../../src/alienclaw/constants.js');
    require('node:fs').mkdirSync(require('node:path').join(homeDir, 'workspace'), { recursive: true });
    const lockPath = `${consts.PATHS.goals}.lock`;
    writeFileSync(lockPath, 'held-by-other-process', 'utf-8');

    const gm = new GoalManager();
    // LOCK_MAX_TRIES = 10, LOCK_RETRY_MS = 50 → up to 500ms of retry.
    await expect(gm.save({ version: '1', activeGoalId: null, goals: [] }))
      .rejects.toThrow(/goals\.json lock not acquired/);
  });

  it('propagates non-EEXIST errors from acquireLock immediately without retrying (L27 arm0)', async () => {
    // Import fs module — same singleton that goal-manager.ts references as `import * as fs from 'fs'`.
    const fsModule = await import('node:fs');
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    // Pre-create workspace so ensureGoalsDir() succeeds before acquireLock() is reached.
    fsModule.mkdirSync(require('node:path').join(homeDir, 'workspace'), { recursive: true });
    // Inject a single non-EEXIST error (EACCES) — should be re-thrown immediately, not retried.
    const spy = vi.spyOn(fsModule.promises, 'open').mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    );
    await expect(gm.save({ version: '1', activeGoalId: null, goals: [] }))
      .rejects.toThrow('EACCES');
    spy.mockRestore();
  });
});

// ─── 3. addGoal() ───────────────────────────────────────────────────────────

describe('GoalManager.addGoal()', () => {
  it('pushes the goal, sets activeGoalId, and persists to disk', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g-add', [makeSubGoal('sg1', { status: 'pending' })]));
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals).toHaveLength(1);
    expect(onDisk.goals[0].id).toBe('g-add');
    expect(onDisk.activeGoalId).toBe('g-add');
  });

  it('overwrites activeGoalId when adding a second goal (latest wins)', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await gm.addGoal(makeGoal('g2', [makeSubGoal('sg2', { status: 'pending' })]));
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals).toHaveLength(2);
    expect(onDisk.activeGoalId).toBe('g2');
  });
});

// ─── 4. updateSubGoal() ─────────────────────────────────────────────────────

describe('GoalManager.updateSubGoal()', () => {
  it('applies a patch to a sub-goal and persists', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await gm.updateSubGoal('g1', 'sg1', { status: 'complete' });
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals[0].subGoals[0].status).toBe('complete');
  });

  it('throws "Goal <id> not found" when goalId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await expect(gm.updateSubGoal('g-missing', 'sg1', { status: 'complete' }))
      .rejects.toThrow('Goal g-missing not found');
  });

  it('throws "SubGoal <id> not found" when subGoalId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await expect(gm.updateSubGoal('g1', 'sg-missing', { status: 'complete' }))
      .rejects.toThrow('SubGoal sg-missing not found');
  });
});

// ─── 5. updateGoal() ────────────────────────────────────────────────────────

describe('GoalManager.updateGoal()', () => {
  it('applies a patch to a goal and persists', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await gm.updateGoal('g1', { description: 'updated' });
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals[0].description).toBe('updated');
  });

  it('throws "Goal <id> not found" when goalId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await expect(gm.updateGoal('g-missing', { description: 'x' }))
      .rejects.toThrow('Goal g-missing not found');
  });
});

// ─── 6. getReadySubGoals() ──────────────────────────────────────────────────

describe('GoalManager.getReadySubGoals()', () => {
  it('returns [] when goalId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const file = { version: '1', activeGoalId: null, goals: [] };
    expect(gm.getReadySubGoals(file, 'g-missing')).toEqual([]);
  });

  it('returns pending sub-goals with all deps complete', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', [
      makeSubGoal('sg-a', { status: 'pending', dependsOn: ['sg-b'] }),
      makeSubGoal('sg-b', { status: 'complete', dependsOn: [] }),
      makeSubGoal('sg-c', { status: 'pending', dependsOn: ['sg-a'] }),
      makeSubGoal('sg-d', { status: 'pending', dependsOn: [] }),
      makeSubGoal('sg-e', { status: 'active', dependsOn: [] }), // not pending → not ready
    ]);
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    const ready = gm.getReadySubGoals(file, 'g1').map(s => s.id).sort();
    // sg-a: dep sg-b complete → ready
    // sg-c: dep sg-a pending → NOT ready
    // sg-d: no deps → ready
    // sg-e: status=active → NOT ready
    expect(ready).toEqual(['sg-a', 'sg-d']);
  });

  it('returns [] when no sub-goal is ready (all blocked)', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', [
      makeSubGoal('sg-a', { status: 'pending', dependsOn: ['sg-b'] }),
      makeSubGoal('sg-b', { status: 'pending', dependsOn: ['sg-a'] }),
    ]);
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    expect(gm.getReadySubGoals(file, 'g1')).toEqual([]);
  });
});

// ─── 7. isGoalComplete() ────────────────────────────────────────────────────

describe('GoalManager.isGoalComplete()', () => {
  it('returns false when goalId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const file = { version: '1', activeGoalId: null, goals: [] };
    expect(gm.isGoalComplete(file, 'g-missing')).toBe(false);
  });

  it('returns false when goal has zero sub-goals (empty short-circuit)', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', []);
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    expect(gm.isGoalComplete(file, 'g1')).toBe(false);
  });

  it('returns false when any sub-goal is not complete', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', [
      makeSubGoal('sg1', { status: 'complete' }),
      makeSubGoal('sg2', { status: 'pending' }),
    ]);
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    expect(gm.isGoalComplete(file, 'g1')).toBe(false);
  });

  it('returns true when all sub-goals are complete', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', [
      makeSubGoal('sg1', { status: 'complete' }),
      makeSubGoal('sg2', { status: 'complete' }),
    ]);
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    expect(gm.isGoalComplete(file, 'g1')).toBe(true);
  });
});

// ─── 8. foldUserInput() ─────────────────────────────────────────────────────

describe('GoalManager.foldUserInput()', () => {
  it('appends new sub-goals to an existing goal and persists', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await gm.foldUserInput('g1', [
      makeSubGoal('sg-new-1', { status: 'pending' }),
      makeSubGoal('sg-new-2', { status: 'pending' }),
    ]);
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals[0].subGoals).toHaveLength(3);
    expect(onDisk.goals[0].subGoals.map((s: any) => s.id)).toEqual(['sg1', 'sg-new-1', 'sg-new-2']);
  });

  it('throws "Goal <id> not found" when goalId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await expect(gm.foldUserInput('g-missing', [makeSubGoal('sg-x')]))
      .rejects.toThrow('Goal g-missing not found');
  });
});

// ─── 9. markGoalComplete() ──────────────────────────────────────────────────

describe('GoalManager.markGoalComplete()', () => {
  it('sets goal status=complete, completedAt=now, and clears activeGoalId', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'complete' })]));
    const before = Date.now();
    await gm.markGoalComplete('g1');
    const after = Date.now();
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals[0].status).toBe('complete');
    expect(onDisk.goals[0].completedAt).toBeGreaterThanOrEqual(before);
    expect(onDisk.goals[0].completedAt).toBeLessThanOrEqual(after);
    expect(onDisk.activeGoalId).toBeNull();
  });

  it('throws "Goal <id> not found" when goalId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await expect(gm.markGoalComplete('g-missing')).rejects.toThrow('Goal g-missing not found');
  });
});

// ─── 10. attachScheme() ─────────────────────────────────────────────────────

describe('GoalManager.attachScheme()', () => {
  it('attaches a Scheme to an existing goal and persists', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    const scheme = makeScheme([makeCampaign('c1')]);
    await gm.attachScheme('g1', scheme);
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals[0].scheme).toBeDefined();
    expect(onDisk.goals[0].scheme.campaigns).toHaveLength(1);
    expect(onDisk.goals[0].scheme.campaigns[0].id).toBe('c1');
  });

  it('throws "Goal <id> not found" when goalId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await expect(gm.attachScheme('g-missing', makeScheme([])))
      .rejects.toThrow('Goal g-missing not found');
  });
});

// ─── 11. updateCampaign() ───────────────────────────────────────────────────

describe('GoalManager.updateCampaign()', () => {
  it('applies a status patch to a campaign and persists', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    const scheme = makeScheme([makeCampaign('c1', { status: 'pending' })]);
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await gm.attachScheme('g1', scheme);
    await gm.updateCampaign('g1', 'c1', { status: 'active' });
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals[0].scheme.campaigns[0].status).toBe('active');
  });

  it('throws "Goal <id> has no Scheme" when goal exists but has no scheme', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await expect(gm.updateCampaign('g1', 'c1', { status: 'active' }))
      .rejects.toThrow('Goal g1 has no Scheme');
  });

  it('throws "Campaign <id> not found" when campaignId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const scheme = makeScheme([makeCampaign('c1', { status: 'pending' })]);
    await gm.addGoal(makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]));
    await gm.attachScheme('g1', scheme);
    await expect(gm.updateCampaign('g1', 'c-missing', { status: 'active' }))
      .rejects.toThrow('Campaign c-missing not found');
  });
});

// ─── 12. getReadyCampaigns() ───────────────────────────────────────────────

describe('GoalManager.getReadyCampaigns()', () => {
  it('returns [] when goalId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const file = { version: '1', activeGoalId: null, goals: [] };
    expect(gm.getReadyCampaigns(file, 'g-missing')).toEqual([]);
  });

  it('returns [] when goal exists but has no scheme', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]);
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    expect(gm.getReadyCampaigns(file, 'g1')).toEqual([]);
  });

  it('returns pending campaigns whose deps are all complete', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })], {
      scheme: makeScheme([
        makeCampaign('c-a', { status: 'pending', dependsOn: ['c-b'] }),
        makeCampaign('c-b', { status: 'complete', dependsOn: [] }),
        makeCampaign('c-c', { status: 'pending', dependsOn: ['c-a'] }),
        makeCampaign('c-d', { status: 'pending', dependsOn: [] }),
        makeCampaign('c-e', { status: 'active', dependsOn: [] }),
      ]),
    });
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    const ready = gm.getReadyCampaigns(file, 'g1').map(c => c.id).sort();
    // c-a: dep c-b complete → ready
    // c-c: dep c-a pending → NOT ready
    // c-d: no deps → ready
    // c-e: status=active → NOT ready
    expect(ready).toEqual(['c-a', 'c-d']);
  });
});

// ─── 13. isSchemeComplete() ─────────────────────────────────────────────────

describe('GoalManager.isSchemeComplete()', () => {
  it('returns false when goalId does not exist', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const file = { version: '1', activeGoalId: null, goals: [] };
    expect(gm.isSchemeComplete(file, 'g-missing')).toBe(false);
  });

  it('returns false when goal exists but has no scheme', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })]);
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    expect(gm.isSchemeComplete(file, 'g1')).toBe(false);
  });

  it('returns false when scheme has zero campaigns (empty short-circuit)', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })], {
      scheme: makeScheme([]),
    });
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    expect(gm.isSchemeComplete(file, 'g1')).toBe(false);
  });

  it('returns false when any campaign is not complete', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })], {
      scheme: makeScheme([
        makeCampaign('c1', { status: 'complete' }),
        makeCampaign('c2', { status: 'pending' }),
      ]),
    });
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    expect(gm.isSchemeComplete(file, 'g1')).toBe(false);
  });

  it('returns true when all campaigns are complete', async () => {
    const { GoalManager } = await loadGoalManager();
    const gm = new GoalManager();
    const goal = makeGoal('g1', [makeSubGoal('sg1', { status: 'pending' })], {
      scheme: makeScheme([
        makeCampaign('c1', { status: 'complete' }),
        makeCampaign('c2', { status: 'complete' }),
      ]),
    });
    const file = { version: '1', activeGoalId: 'g1', goals: [goal] };
    expect(gm.isSchemeComplete(file, 'g1')).toBe(true);
  });
});

// ─── 14. Integration: full lifecycle ────────────────────────────────────────

describe('GoalManager — integration: full goal lifecycle', () => {
  it('addGoal → foldUserInput → updateSubGoal → markGoalComplete round-trip', async () => {
    const { GoalManager, PATHS } = await loadGoalManager();
    const gm = new GoalManager();
    await gm.addGoal(makeGoal('g-lifecycle', []));
    await gm.foldUserInput('g-lifecycle', [
      makeSubGoal('sg-1', { status: 'pending' }),
      makeSubGoal('sg-2', { status: 'pending', dependsOn: ['sg-1'] }),
    ]);
    await gm.updateSubGoal('g-lifecycle', 'sg-1', { status: 'complete' });
    await gm.updateSubGoal('g-lifecycle', 'sg-2', { status: 'complete' });

    // All sub-goals complete — isGoalComplete should return true.
    const file = gm.load();
    expect(gm.isGoalComplete(file, 'g-lifecycle')).toBe(true);

    await gm.markGoalComplete('g-lifecycle');
    const onDisk = JSON.parse(readFileSync(PATHS.goals, 'utf-8'));
    expect(onDisk.goals[0].status).toBe('complete');
    expect(onDisk.goals[0].completedAt).toBeDefined();
    expect(onDisk.activeGoalId).toBeNull();
  });
});
