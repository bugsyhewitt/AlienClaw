import {
  readFileSync, writeFileSync, existsSync,
  mkdirSync, renameSync, unlinkSync,
} from 'fs';
import { dirname } from 'path';
import { PATHS } from '../constants.js';
import type { Goal, GoalsFile, SubGoal } from '../types.js';

const GOALS_PATH = PATHS.goals;
const LOCK_PATH  = `${GOALS_PATH}.lock`;
const TMP_PATH   = `${GOALS_PATH}.tmp`;

const LOCK_RETRY_MS  = 50;
const LOCK_MAX_TRIES = 10;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function ensureGoalsDir(): void {
  const dir = dirname(GOALS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function acquireLock(): Promise<void> {
  for (let i = 0; i < LOCK_MAX_TRIES; i++) {
    if (!existsSync(LOCK_PATH)) {
      writeFileSync(LOCK_PATH, String(process.pid), 'utf-8');
      return;
    }
    await sleep(LOCK_RETRY_MS);
  }
  throw new Error(`goals.json lock not acquired after ${LOCK_MAX_TRIES} retries`);
}

function releaseLock(): void {
  try { if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH); } catch { /* best-effort */ }
}

export class GoalManager {
  load(): GoalsFile {
    ensureGoalsDir();
    if (!existsSync(GOALS_PATH)) {
      return { version: '1', activeGoalId: null, goals: [] };
    }
    return JSON.parse(readFileSync(GOALS_PATH, 'utf-8')) as GoalsFile;
  }

  /** Atomic write: tmp → lock → rename → release */
  async save(file: GoalsFile): Promise<void> {
    ensureGoalsDir();
    writeFileSync(TMP_PATH, JSON.stringify(file, null, 2), 'utf-8');
    await acquireLock();
    try {
      renameSync(TMP_PATH, GOALS_PATH);
    } finally {
      releaseLock();
    }
  }

  async addGoal(goal: Goal): Promise<void> {
    const file         = this.load();
    file.goals.push(goal);
    file.activeGoalId  = goal.id;
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
    await this.save(file);
  }

  async updateGoal(goalId: string, patch: Partial<Goal>): Promise<void> {
    const file = this.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    Object.assign(goal, patch);
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

  getActiveSubGoals(file: GoalsFile, goalId: string): SubGoal[] {
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) return [];
    return goal.subGoals.filter(s => s.status === 'active');
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
    await this.save(file);
  }

  async markGoalComplete(goalId: string): Promise<void> {
    const file = this.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    goal.status       = 'complete';
    goal.completedAt  = Date.now();
    file.activeGoalId = null;
    await this.save(file);
  }
}
