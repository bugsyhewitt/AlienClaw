/**
 * creatorbot-queue.test.ts — unit tests for the production CreatorBot class
 * in src/alienclaw/agents/creatorbot.ts (the one wired into
 * hierarchy-bootstrap.ts:107-250 and called by governance-loop.ts:618,744,750).
 *
 * NOT to be confused with src/alienclaw/governance/common/creator-bot.js
 * (the simplified Packet-6 governance-layer class — covered by
 *  test/governance/creator-bot.test.ts).
 *
 * Packet 053.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CreatorBot } from '../../src/alienclaw/agents/creatorbot.js';
import { CREATOR_QUEUE_MAX } from '../../src/alienclaw/constants.js';

describe('CreatorBot queue (agents/creatorbot.ts:68-89)', () => {
  it('enqueue pushes item with correct shape', () => {
    const cb = new CreatorBot();
    cb.enqueue('URGENT', 'obs-1', 'ctx-1');
    // peekUrgent is the cheapest read-only probe of the queue
    const peek = cb.peekUrgent();
    expect(peek?.priority).toBe('URGENT');
    expect(peek?.observation).toBe('obs-1');
    expect(peek?.context).toBe('ctx-1');
    expect(typeof peek?.ts).toBe('number');
  });

  it('enqueue respects CREATOR_QUEUE_MAX=1000 (drops oldest)', () => {
    const cb = new CreatorBot();
    for (let i = 0; i < CREATOR_QUEUE_MAX + 1; i++) {
      cb.enqueue('URGENT', `flood-${i}`, 'ctx');
    }
    // First enqueue (flood-0) was dropped; queue still at capacity 1000
    expect(cb.peekUrgent()?.observation).toBe('flood-1');
  });

  it('peekUrgent returns the first URGENT (insertion order)', () => {
    const cb = new CreatorBot();
    cb.enqueue('URGENT', 'u1', 'c');
    cb.enqueue('NOTABLE', 'n1', 'c');
    cb.enqueue('URGENT', 'u2', 'c');
    expect(cb.peekUrgent()?.observation).toBe('u1');
    // peek does NOT mutate
    expect(cb.peekUrgent()?.observation).toBe('u1');
  });

  it('consumeUrgent removes URGENT and returns undefined when empty', () => {
    const cb = new CreatorBot();
    cb.enqueue('URGENT', 'u1', 'c');
    cb.enqueue('URGENT', 'u2', 'c');
    expect(cb.consumeUrgent()?.observation).toBe('u1');
    expect(cb.peekUrgent()?.observation).toBe('u2');
    expect(cb.consumeUrgent()?.observation).toBe('u2');
    expect(cb.consumeUrgent()).toBeUndefined();
  });

  it('flushNotable removes NOTABLE but preserves URGENT', () => {
    const cb = new CreatorBot();
    cb.enqueue('URGENT', 'u', 'c');
    cb.enqueue('NOTABLE', 'n1', 'c');
    cb.enqueue('NOTABLE', 'n2', 'c');
    const notable = cb.flushNotable();
    expect(notable).toHaveLength(2);
    expect(notable.map(i => i.observation)).toEqual(['n1', 'n2']);
    expect(cb.peekUrgent()?.observation).toBe('u');
  });

  it('flushNotable returns [] when queue has no NOTABLE', () => {
    const cb = new CreatorBot();
    cb.enqueue('URGENT', 'u', 'c');
    expect(cb.flushNotable()).toEqual([]);
  });
});

describe('CreatorBot subagent lifecycle (agents/creatorbot.ts:145-181)', () => {
  it('spawnSubagent adds to activeSubagents, fires onComplete on resolve', async () => {
    const cb = new CreatorBot();
    let result: unknown;
    cb.spawnSubagent(
      { task: 't1', domain: 'd1', onComplete: r => { result = r; } },
      async () => 'work-result',
    );
    expect(cb.subagentCount).toBe(1);
    await new Promise(r => setTimeout(r, 20));
    expect(cb.subagentCount).toBe(0);
    expect(result).toBe('work-result');
  });

  it('spawnSubagent with throwing work + no onError enqueues NOTABLE', async () => {
    const cb = new CreatorBot();
    cb.spawnSubagent(
      { task: 'will-fail', domain: 'd-fail' },
      async () => { throw new Error('boom'); },
    );
    await new Promise(r => setTimeout(r, 20));
    const notable = cb.flushNotable();
    expect(notable).toHaveLength(1);
    expect(notable[0]?.observation).toContain('will-fail');
    expect(notable[0]?.observation).toContain('boom');
  });

  it('spawnSubagent with throwing work + onError invokes onError instead of enqueue', async () => {
    const cb = new CreatorBot();
    let caught: unknown;
    cb.spawnSubagent(
      { task: 't2', domain: 'd2', onError: e => { caught = e; } },
      async () => { throw new Error('handled'); },
    );
    await new Promise(r => setTimeout(r, 20));
    expect((caught as Error).message).toBe('handled');
    expect(cb.flushNotable()).toEqual([]);
  });

  it('spawnSubagent onComplete throwing is captured as NOTABLE', async () => {
    const cb = new CreatorBot();
    cb.spawnSubagent(
      { task: 't3', domain: 'd3', onComplete: () => { throw new Error('cb-boom'); } },
      async () => 'ok',
    );
    await new Promise(r => setTimeout(r, 20));
    const notable = cb.flushNotable();
    expect(notable).toHaveLength(1);
    expect(notable[0]?.observation).toContain('cb-boom');
  });
});

describe('CreatorBot scheduler (agents/creatorbot.ts:100-137)', () => {
  const bots: CreatorBot[] = [];
  function makeBot(): CreatorBot {
    const b = new CreatorBot();
    bots.push(b);
    return b;
  }
  afterEach(() => {
    for (const b of bots) b.stopScheduler();
    bots.length = 0;
  });

  it('registerScheduledJob + startScheduler fires the job at intervalMs', async () => {
    const cb = makeBot();
    let count = 0;
    cb.registerScheduledJob({ label: 'tick', intervalMs: 30, fn: async () => { count++; } });
    cb.startScheduler();
    await new Promise(r => setTimeout(r, 100));
    // ~3 fires in 100ms with 30ms interval (timing-tolerant: >=2 <=5)
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(5);
  });

  it('startScheduler is idempotent (jobs already running are skipped)', async () => {
    const cb = makeBot();
    let count = 0;
    cb.registerScheduledJob({ label: 't', intervalMs: 30, fn: async () => { count++; } });
    cb.startScheduler();
    cb.startScheduler(); // should be no-op
    await new Promise(r => setTimeout(r, 100));
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(5);
  });

  it('stopScheduler halts the interval (count stops growing)', async () => {
    const cb = makeBot();
    let count = 0;
    cb.registerScheduledJob({ label: 't', intervalMs: 30, fn: async () => { count++; } });
    cb.startScheduler();
    await new Promise(r => setTimeout(r, 80));
    cb.stopScheduler();
    const snapshot = count;
    await new Promise(r => setTimeout(r, 100));
    expect(count).toBe(snapshot);
  });

  it('scheduled job that throws enqueues NOTABLE (does not crash scheduler)', async () => {
    const cb = makeBot();
    cb.registerScheduledJob({
      label: 'flaky',
      intervalMs: 25,
      fn: async () => { throw new Error('sched-boom'); },
    });
    cb.startScheduler();
    await new Promise(r => setTimeout(r, 80));
    cb.stopScheduler();
    const notable = cb.flushNotable();
    expect(notable.length).toBeGreaterThan(0);
    expect(notable[0]?.observation).toContain('flaky');
    expect(notable[0]?.observation).toContain('sched-boom');
  });
});

describe('CreatorBot.systemPrompt (agents/creatorbot.ts:62-64)', () => {
  it('returns the loaded soul content', () => {
    const cb = new CreatorBot();
    expect(cb.systemPrompt()).toBe(cb.soul);
    expect(cb.soul.length).toBeGreaterThan(0);
  });
});
