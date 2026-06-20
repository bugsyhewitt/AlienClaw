import { describe, it, expect } from 'vitest';
import { TaskManager } from '../../src/alienclaw/governance/common/task-manager.js';
import { MAX_STRIKE_COUNT } from '../../src/alienclaw/constants.js';
import type { TaskEnvelope } from '../../src/alienclaw/types.js';

function mkTask(id: string, overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    taskId: id,
    description: `task ${id}`,
    domain: 'compute',
    priority: 'normal',
    createdAt: Date.now(),
    strikeCount: 0,
    attempts: [],
    ...overrides,
  };
}

describe('TaskManager', () => {
  it('lifecycle: register / get / deregister', () => {
    const tm = new TaskManager();
    const t = mkTask('t1');
    tm.register(t);
    expect(tm.get('t1')).toBe(t);
    tm.deregister('t1');
    expect(tm.get('t1')).toBeUndefined();
  });

  it('assign: mutates assignedTo and throws on missing', () => {
    const tm = new TaskManager();
    const t = mkTask('a');
    tm.register(t);
    tm.assign('a', 'sub-1');
    expect(t.assignedTo).toBe('sub-1');
    expect(() => tm.assign('nope', 'sub-1')).toThrow(/Task .* not found/);
  });

  it('recordAttempt: pushes attempt, increments strikeCount, throws on missing', () => {
    const tm = new TaskManager();
    const t = mkTask('a');
    tm.register(t);
    const attempt = { attemptNumber: 1, employeeId: 'sub-1', failureReason: 'crash', advisorVerdict: 'retry', ts: 1 };
    tm.recordAttempt('a', attempt);
    expect(t.attempts.length).toBe(1);
    expect(t.strikeCount).toBe(1);
    expect(() => tm.recordAttempt('nope', attempt)).toThrow(/not found/);
  });

  it('isExhausted: false below MAX_STRIKE_COUNT, true at limit, false for missing', () => {
    const tm = new TaskManager();
    tm.register(mkTask('a'));
    expect(tm.isExhausted('a')).toBe(false);
    for (let n = 0; n < MAX_STRIKE_COUNT; n++) {
      tm.recordAttempt('a', { attemptNumber: n + 1, employeeId: 'sub-1', failureReason: 'f', advisorVerdict: 'retry', ts: n });
    }
    expect(tm.isExhausted('a')).toBe(true);
    expect(tm.isExhausted('missing')).toBe(false);
  });

  it('resetStrikes: zeros strikeCount, sets extendedBudget, no-op for missing', () => {
    const tm = new TaskManager();
    const t = mkTask('a', { strikeCount: 3 });
    tm.register(t);
    tm.resetStrikes('a', 5);
    expect(t.strikeCount).toBe(0);
    expect((t as TaskEnvelope & { extendedBudget?: number }).extendedBudget).toBe(5);
    expect(() => tm.resetStrikes('nope')).not.toThrow();
  });

  it('getAttemptSummary empty: placeholder for missing and no-attempt task', () => {
    const tm = new TaskManager();
    expect(tm.getAttemptSummary('nope')).toBe('  (no attempts recorded)');
    tm.register(mkTask('a'));
    expect(tm.getAttemptSummary('a')).toBe('  (no attempts recorded)');
  });

  it('getAttemptSummary populated: formats attempts in registration order', () => {
    const tm = new TaskManager();
    tm.register(mkTask('a'));
    tm.recordAttempt('a', { attemptNumber: 1, employeeId: 'sub-1', failureReason: 'timeout', advisorVerdict: 'retry', ts: 1 });
    tm.recordAttempt('a', { attemptNumber: 2, employeeId: 'sub-2', failureReason: 'wrong-format', advisorVerdict: 'retry', ts: 2 });
    expect(tm.getAttemptSummary('a')).toBe('  1. [sub-1] timeout\n  2. [sub-2] wrong-format');
  });
});
