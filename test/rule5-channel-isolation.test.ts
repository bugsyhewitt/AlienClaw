/**
 * rule5-channel-isolation.test.ts
 *
 * Validates Rule 5 (the channel isolation rule):
 *   UserChannel NEVER sees inter-agent messages.
 *   AgentChannel ALWAYS records them.
 *
 * This is a structural test — it verifies the channel boundary without
 * requiring a full end-to-end goal run.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { AgentChannel } from '../src/alienclaw/comms/agent-channel.js';
import { UserChannel }  from '../src/alienclaw/comms/user-channel.js';

describe('Rule 5 — channel isolation', () => {
  let agentChannel: AgentChannel;
  let userChannel:  UserChannel;
  let userOutput:   string[];

  beforeEach(() => {
    agentChannel = new AgentChannel();
    userOutput = [];

    // Spy on console.log to capture what UserChannel emits
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      userOutput.push(args.map(String).join(' '));
      originalLog(...args);
    };
  });

  it('agentChannel.send() does not write to stdout', () => {
    agentChannel.send({
      from: 'BossBot', to: 'AdvisorBot', kind: 'request',
      content: 'Should we add a testing campaign?',
      ts: Date.now(), taskId: 'test-task-1',
    });
    expect(userOutput).toHaveLength(0);
  });

  it('agentChannel.history() returns messages between agent pairs', () => {
    const ts = Date.now();
    agentChannel.send({ from: 'BossBot', to: 'AdvisorBot', kind: 'request', content: 'Q1', ts, taskId: 't1' });
    agentChannel.send({ from: 'AdvisorBot', to: 'BossBot', kind: 'response', content: 'A1', ts: ts + 1, taskId: 't1' });
    agentChannel.send({ from: 'BossBot', to: 'CreatorBot', kind: 'notice', content: 'Build specialists', ts: ts + 2, taskId: 't1' });

    const bossAdvisor = agentChannel.history('BossBot', 'AdvisorBot');
    expect(bossAdvisor).toHaveLength(2);
    expect(bossAdvisor[0]!.content).toBe('Q1');
    expect(bossAdvisor[1]!.content).toBe('A1');

    const bossCreator = agentChannel.history('BossBot', 'CreatorBot');
    expect(bossCreator).toHaveLength(1);
    expect(bossCreator[0]!.content).toBe('Build specialists');
  });

  it('agentChannel.history() filters by taskId when provided', () => {
    const ts = Date.now();
    agentChannel.send({ from: 'BossBot', to: 'AdvisorBot', kind: 'request', content: 'Q-A', ts, taskId: 'task-A' });
    agentChannel.send({ from: 'AdvisorBot', to: 'BossBot', kind: 'response', content: 'A-A', ts: ts + 1, taskId: 'task-A' });
    agentChannel.send({ from: 'BossBot', to: 'AdvisorBot', kind: 'request', content: 'Q-B', ts: ts + 2, taskId: 'task-B' });

    const taskA = agentChannel.history('BossBot', 'AdvisorBot', 'task-A');
    expect(taskA).toHaveLength(1);
    expect(taskA[0]!.content).toBe('Q-A');
  });

  it('agentChannel.subscribe() notifies observers of new messages', () => {
    const received: string[] = [];
    const unsub = agentChannel.subscribe(msg => received.push(msg.content));

    agentChannel.send({ from: 'BossBot', to: 'AdvisorBot', kind: 'request', content: 'ping', ts: Date.now() });
    expect(received).toEqual(['ping']);

    unsub();
    agentChannel.send({ from: 'BossBot', to: 'AdvisorBot', kind: 'request', content: 'ping2', ts: Date.now() });
    expect(received).toHaveLength(1); // second ping not received after unsubscribe
  });

  it('userChannel.status() emits to stdout — AgentChannel has no stdout path', () => {
    userChannel = new UserChannel({ verbosity: 'normal', advisorPersistence: 'per_task' });
    userChannel.status('user-facing status');
    expect(userOutput.some(line => line.includes('user-facing status'))).toBe(true);
    expect(userOutput.some(line => line.includes('BossBot') || line.includes('AdvisorBot'))).toBe(false);
  });
});
