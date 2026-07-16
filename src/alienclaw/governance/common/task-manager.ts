import { MAX_STRIKE_COUNT } from '../../constants.js';
import type { TaskEnvelope, TaskAttempt } from '../../types.js';

export class TaskManager {
  private tasks = new Map<string, TaskEnvelope>();

  register(task: TaskEnvelope): void {
    this.tasks.set(task.taskId, task);
  }

  get(taskId: string): TaskEnvelope | undefined {
    return this.tasks.get(taskId);
  }

  assign(taskId: string, subagentId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.assignedTo = subagentId;
  }

  recordAttempt(taskId: string, attempt: TaskAttempt): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.attempts.push(attempt);
    task.strikeCount++;
  }

  isExhausted(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    return task.strikeCount >= MAX_STRIKE_COUNT;
  }

  resetStrikes(taskId: string, extendedBudget?: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.strikeCount = 0;
    if (extendedBudget !== undefined) {
      // Stored for Phase 3+ budget enforcement
      (task as TaskEnvelope & { extendedBudget?: number }).extendedBudget = extendedBudget;
    }
  }

  deregister(taskId: string): void {
    this.tasks.delete(taskId);
  }

  getAttemptSummary(taskId: string): string {
    const task = this.tasks.get(taskId);
    if (!task || task.attempts.length === 0) return '  (no attempts recorded)';
    return task.attempts
      .map((a, i) => `  ${i + 1}. [${a.subagentId}] ${a.failureReason}`)
      .join('\n');
  }
}
