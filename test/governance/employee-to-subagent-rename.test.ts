import { describe, it, expect } from 'vitest';
import { TaskAttempt, TaskResult, TaskEnvelope } from '../../src/alienclaw/types.js';
import { MartianReport } from '../../src/alienclaw/telemetry/telemetry-reader.js';

describe('packet-043: Employee → Subagent rename is complete and self-consistent', () => {
  it('TaskAttempt carries subagentId (not employeeId)', () => {
    const attempt: TaskAttempt = {
      attemptNumber:  1,
      subagentId:     'subagent-A',
      failureReason:  'test',
      advisorVerdict: 'escalate',
      ts:             Date.now(),
    };
    expect((attempt as unknown as Record<string, unknown>).employeeId).toBeUndefined();
    expect(attempt.subagentId).toBe('subagent-A');
  });

  it('TaskResult carries subagentId (not employeeId)', () => {
    const result: TaskResult = {
      taskId:     't-1',
      subagentId: 'subagent-B',
      outcome:    'SUCCESS',
      summary:    'ok',
      ts:         Date.now(),
    };
    expect((result as unknown as Record<string, unknown>).employeeId).toBeUndefined();
    expect(result.subagentId).toBe('subagent-B');
  });

  it('MartianReport carries subagentId (not employeeId)', () => {
    const report: MartianReport = {
      reportCode: 'OK',
      ts:         Date.now(),
      taskId:     't-1',
      subagentId: 'subagent-C',
      martianId:  'm-1',
      domain:     'implementation',
      outcome:    'SUCCESS',
      summary:    'ok',
    };
    expect((report as unknown as Record<string, unknown>).employeeId).toBeUndefined();
    expect(report.subagentId).toBe('subagent-C');
  });

  it('TaskManager.assign accepts subagentId (regression: was employeeId)', async () => {
    const { TaskManager } = await import('../../src/alienclaw/governance/common/task-manager.js');
    const tm = new TaskManager();
    const taskId = 'task-test-001';
    const envelope: TaskEnvelope = {
      taskId,
      description: 'd',
      domain:      'd',
      priority:    'normal',
      createdAt:   Date.now(),
      strikeCount: 0,
      attempts:    [],
    };
    tm.register(envelope);
    tm.assign(taskId, 'subagent-D');
    const t = tm.get(taskId);
    expect(t?.assignedTo).toBe('subagent-D');
  });

  it('agent prompts contain "Subagent" and do not contain standalone "Employee" identifier', async () => {
    const fs = await import('fs/promises');
    const prompts = ['bossbot', 'creatorbot', 'advisorbot'];
    for (const p of prompts) {
      const text = await fs.readFile(`src/alienclaw/prompts/${p}.soul.md`, 'utf8');
      // Must have Subagent (or Subagents) — canonical term
      expect(text).toMatch(/Subagents?/);
      // Must NOT have standalone "Employee" word (matches "Employee" not "Employees")
      // The compounds "Sub-agent (Employee)" were rewritten in §3.2.
      expect(text).not.toMatch(/\bEmployees?\b/);
    }
  });
});
