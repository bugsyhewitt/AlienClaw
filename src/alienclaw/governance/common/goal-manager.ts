import * as fs from 'fs';
import {
  readFileSync, writeFileSync,
  mkdirSync, renameSync, unlinkSync,
} from 'fs';
import { dirname } from 'path';
import { errorMessage, sleep } from '../../utils.js';
import { PATHS, LOCK_RETRY_MS, LOCK_MAX_TRIES } from '../../constants.js';
import type { Goal, GoalsFile, SubGoal, Campaign, Scheme } from '../../types.js';

const GOALS_PATH = PATHS.goals;
const LOCK_PATH  = `${GOALS_PATH}.lock`;
const TMP_PATH   = `${GOALS_PATH}.tmp`;

function ensureGoalsDir(): void {
  const dir = dirname(GOALS_PATH);
  mkdirSync(dir, { recursive: true });
}

async function acquireLock(): Promise<void> {
  for (let i = 0; i < LOCK_MAX_TRIES; i++) {
    try {
      const handle = await fs.promises.open(LOCK_PATH, 'wx');
      await handle.close();
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error(`goals.json lock not acquired after ${LOCK_MAX_TRIES} retries`);
}

function releaseLock(): void {
  try { unlinkSync(LOCK_PATH); } catch { /* best-effort */ }
}

export class GoalManager {
  private _cached: GoalsFile | null = null;
  private _dirty  = false;

  load(): GoalsFile {
    // Clean cache — return without any syscall
    if (this._cached !== null && !this._dirty) {
      return this._cached;
    }
    // Stale or absent — read from disk
    ensureGoalsDir();
    try {
      this._cached = JSON.parse(readFileSync(GOALS_PATH, 'utf-8')) as GoalsFile;
      this._dirty  = false;
      return this._cached;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this._cached = { version: '1', activeGoalId: null, goals: [] };
        this._dirty  = false;
        return this._cached;
      }
      throw new Error(`load goals: ${errorMessage(err)}`);
    }
  }

  /** Atomic write: tmp → lock → rename → release */
  async save(file: GoalsFile): Promise<void> {
    ensureGoalsDir();
    writeFileSync(TMP_PATH, JSON.stringify(file, null, 2), 'utf-8');
    await acquireLock();
    try {
      renameSync(TMP_PATH, GOALS_PATH);
      this._dirty = false;
    } finally {
      releaseLock();
    }
  }

  async addGoal(goal: Goal): Promise<void> {
    const file         = this.load();
    file.goals.push(goal);
    file.activeGoalId  = goal.id;
    this._dirty       = true;
    await this.save(file);
  }

  async updateSubGoal(
    goalId:    string,
    subGoalId: string,
    patch:     Partial<SubGoal>
  ): Promise<void> {
    const file = this.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    const sg = goal.subGoals.find(s => s.id === subGoalId);
    if (!sg) throw new Error(`SubGoal ${subGoalId} not found`);
    Object.assign(sg, patch);
    this._dirty = true;
    await this.save(file);
  }

  async updateGoal(goalId: string, patch: Partial<Goal>): Promise<void> {
    const file = this.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    Object.assign(goal, patch);
    this._dirty = true;
    await this.save(file);
  }

  /** Sub-goals whose dependencies are all complete and whose status is 'pending'. */
  getReadySubGoals(file: GoalsFile, goalId: string): SubGoal[] {
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) return [];
    const doneIds = new Set(
      goal.subGoals.filter(s => s.status === 'complete').map(s => s.id)
    );
    return goal.subGoals.filter(
      s => s.status === 'pending' && s.dependsOn.every(dep => doneIds.has(dep))
    );
  }

  isGoalComplete(file: GoalsFile, goalId: string): boolean {
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) return false;
    return goal.subGoals.length > 0 && goal.subGoals.every(s => s.status === 'complete');
  }

  async foldUserInput(goalId: string, newSubGoals: SubGoal[]): Promise<void> {
    const file = this.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    goal.subGoals.push(...newSubGoals);
    this._dirty = true;
    await this.save(file);
  }

  async markGoalComplete(goalId: string): Promise<void> {
    const file = this.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    goal.status       = 'complete';
    goal.completedAt  = Date.now();
    file.activeGoalId = null;
    this._dirty = true;
    await this.save(file);
  }

  // ── Campaign / Scheme methods ───────────────────────────────────────────────

  /** Attach a Scheme to an existing goal and initialise its campaigns. */
  async attachScheme(goalId: string, scheme: Scheme): Promise<void> {
    const file = this.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    goal.scheme = scheme;
    await this.save(file);
  }

  /** Update a campaign's status. */
  async updateCampaign(
    goalId:     string,
    campaignId: string,
    patch:      Partial<Pick<Campaign, 'status'>>
  ): Promise<void> {
    const file = this.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal?.scheme) throw new Error(`Goal ${goalId} has no Scheme`);
    const campaign = goal.scheme.campaigns.find(c => c.id === campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
    Object.assign(campaign, patch);
    this._dirty = true;
    await this.save(file);
  }

  /** Campaigns whose dependencies are all complete and whose status is 'pending'. */
  getReadyCampaigns(file: GoalsFile, goalId: string): Campaign[] {
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal?.scheme) return [];
    const doneIds = new Set(
      goal.scheme.campaigns.filter(c => c.status === 'complete').map(c => c.id)
    );
    return goal.scheme.campaigns.filter(
      c => c.status === 'pending' && c.dependsOn.every(dep => doneIds.has(dep))
    );
  }

  isSchemeComplete(file: GoalsFile, goalId: string): boolean {
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal?.scheme) return false;
    const { campaigns } = goal.scheme;
    return campaigns.length > 0 && campaigns.every(c => c.status === 'complete');
  }
}
