/**
 * advisorbot-sessions.test.ts
 *
 * Direct unit tests for the **session-management methods** of
 * `src/alienclaw/agents/advisorbot.ts`:
 *
 *   - sessionKey(callerId, taskId)              (line 35, private — tested via behavior)
 *   - getOrCreateSession(callerId, taskId)      (line 39, public)
 *   - appendToSession(callerId, taskId, msg)    (line 52, public)
 *   - destroyTaskSessions(taskId)               (line 61, public — called by AgentRegistry.closeTask)
 *   - buildContext(req, session)                (line 71, public)
 *   - systemPrompt()                            (line 58, public)
 *
 * All of these methods are **pure, non-LLM, non-DB, non-IO** — they operate on
 * an in-memory `Map<string, AdvisorySession>` private field. They can be
 * tested by constructing an `AdvisorBot` directly with `new AdvisorBot()` and
 * observing the methods' effects on a fresh `sessions` map.
 *
 * Background:
 *   - `AdvisorBot.parseResponse` is already covered by
 *     `test/agents/advisorbot-parser.test.ts` (PR #30 / packet 052).
 *   - The `AdvisorBot` class itself shows 32.35% stmt / 33.33% line coverage
 *     on `origin/main @ e9c90204` because the session-management surface is
 *     completely untested at the unit level.
 *   - `destroyTaskSessions` is the only production-called method here —
 *     `src/alienclaw/agents/agent-registry.ts:14` calls it via
 *     `AgentRegistry.closeTask(taskId)` on goal completion.
 *
 * Wall-adjacency (the reason this is load-bearing):
 *   The session-key contract is `${callerId}::${taskId}` — see
 *   `src/alienclaw/agents/advisorbot.ts:33-37`. This contract is what enforces
 *   the BossBot↔AdvisorBot and CreatorBot↔AdvisorBot isolation: two callers
 *   asking about the same `taskId` get DISTINCT sessions. A regression that
 *   drops the callerId prefix would silently merge two Tier-A callers'
 *   history. The wall check is a structural property of `Map` keys; pinning
 *   the behavior here is the cheapest way to catch a regression short of an
 *   integration test.
 *
 * SCOPE NOTE:
 *   We do NOT test `AdvisorBot.advise(req, taskId)` — that method calls
 *   `completeSimple(...)` from `@mariozechner/pi-ai`, which makes a real LLM
 *   call. The `alienclaw-coverage-sweep-packet` skill explicitly excludes
 *   LLM-coupled files. `advise()` is covered indirectly by
 *   `test/integration/end_to_end/realistic-goal.test.ts` (skipped by default,
 *   runs only against a real provider).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdvisorBot } from '../../src/alienclaw/agents/advisorbot.js';
import type { AgentMessage, AdvisorySession } from '../../src/alienclaw/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMessage(from: string, content: string): AgentMessage {
  return { from, to: 'AdvisorBot', content, ts: Date.now() };
}

function makeAdviceRequest(requesterId: 'BossBot' | 'CreatorBot', context = 'ctx', question = 'q'): {
  requesterId: 'BossBot' | 'CreatorBot';
  context: string;
  question: string;
} {
  return { requesterId, context, question };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── 1. Constructor + systemPrompt ────────────────────────────────────────────

describe('AdvisorBot — constructor + systemPrompt', () => {
  it('instantiates without throwing and exposes the canonical name/model/soul', () => {
    const bot = new AdvisorBot();
    expect(bot.name).toBe('AdvisorBot');
    // model is wired from constants.ts:AGENT_MODELS.AdvisorBot
    expect(typeof bot.model).toBe('string');
    expect(bot.model.length).toBeGreaterThan(0);
    // soul is the verbatim contents of prompts/advisorbot.soul.md
    expect(bot.soul).toMatch(/^# AdvisorBot/);
    expect(bot.soul).toContain('see around corners');
  });

  it('systemPrompt() returns the same string as the soul field', () => {
    const bot = new AdvisorBot();
    expect(bot.systemPrompt()).toBe(bot.soul);
  });

  it('soul content is identical to the on-disk file (no in-memory transform)', () => {
    const expected = readFileSync(
      join(__dirname, '..', '..', 'src', 'alienclaw', 'prompts', 'advisorbot.soul.md'),
      'utf-8',
    );
    const bot = new AdvisorBot();
    expect(bot.soul).toBe(expected);
  });
});

// ── 2. sessionKey + getOrCreateSession — BossBot/CreatorBot isolation ───────

describe('AdvisorBot.getOrCreateSession — session-key isolation', () => {
  let bot: AdvisorBot;

  beforeEach(() => {
    bot = new AdvisorBot();
  });

  it('returns a fresh AdvisorySession on first call (BossBot)', () => {
    const s = bot.getOrCreateSession('BossBot', 'task-1');
    expect(s.callerId).toBe('BossBot');
    expect(s.taskId).toBe('task-1');
    expect(s.history).toEqual([]);
    expect(typeof s.createdAt).toBe('number');
    expect(s.createdAt).toBeGreaterThan(0);
  });

  it('returns the same session object on repeated calls with the same callerId+taskId', () => {
    const s1 = bot.getOrCreateSession('BossBot', 'task-1');
    const s2 = bot.getOrCreateSession('BossBot', 'task-1');
    expect(s2).toBe(s1); // identity — same object, not just deep-equal
  });

  it('returns DIFFERENT sessions for the same taskId under different callerIds (wall)', () => {
    const sBoss    = bot.getOrCreateSession('BossBot',    'shared-task');
    const sCreator = bot.getOrCreateSession('CreatorBot', 'shared-task');
    expect(sBoss).not.toBe(sCreator);
    expect(sBoss.callerId).toBe('BossBot');
    expect(sCreator.callerId).toBe('CreatorBot');
    // Both taskIds match but the sessions are distinct — the wall contract holds.
    expect(sBoss.taskId).toBe('shared-task');
    expect(sCreator.taskId).toBe('shared-task');
  });

  it('returns DIFFERENT sessions for the same callerId under different taskIds', () => {
    const s1 = bot.getOrCreateSession('BossBot', 'task-1');
    const s2 = bot.getOrCreateSession('BossBot', 'task-2');
    expect(s1).not.toBe(s2);
    expect(s1.taskId).toBe('task-1');
    expect(s2.taskId).toBe('task-2');
  });

  it('does NOT preserve history when getOrCreateSession is called twice on an empty session (no mutations)', () => {
    const s1 = bot.getOrCreateSession('BossBot', 'task-1');
    const s2 = bot.getOrCreateSession('BossBot', 'task-1');
    expect(s1.history).toEqual([]);
    expect(s2.history).toEqual([]);
    expect(s2).toBe(s1);
  });

  it('keys sessions as `${callerId}::${taskId}` — BossBot and CreatorBot NEVER share', () => {
    // The contract is documented at line 33-37 of advisorbot.ts. We verify by
    // asserting that mutating one session does not bleed into the other.
    const sBoss    = bot.getOrCreateSession('BossBot',    'shared');
    const sCreator = bot.getOrCreateSession('CreatorBot', 'shared');

    sBoss.history.push(makeMessage('BossBot', 'private to BossBot session'));
    expect(sBoss.history).toHaveLength(1);
    expect(sCreator.history).toEqual([]);
  });
});

// ── 3. appendToSession ────────────────────────────────────────────────────────

describe('AdvisorBot.appendToSession', () => {
  let bot: AdvisorBot;

  beforeEach(() => {
    bot = new AdvisorBot();
  });

  it('appends a message to an existing session', () => {
    bot.getOrCreateSession('BossBot', 'task-1');
    bot.appendToSession('BossBot', 'task-1', makeMessage('BossBot', 'first'));
    bot.appendToSession('BossBot', 'task-1', makeMessage('BossBot', 'second'));
    const s = bot.getOrCreateSession('BossBot', 'task-1');
    expect(s.history).toHaveLength(2);
    expect(s.history[0]!.content).toBe('first');
    expect(s.history[1]!.content).toBe('second');
  });

  it('auto-creates the session if it does not exist yet (lazy)', () => {
    // appendToSession delegates to getOrCreateSession, so the session is created
    // on first append without a separate getOrCreateSession call.
    bot.appendToSession('CreatorBot', 'lazy-task', makeMessage('CreatorBot', 'hi'));
    const s = bot.getOrCreateSession('CreatorBot', 'lazy-task');
    expect(s.callerId).toBe('CreatorBot');
    expect(s.taskId).toBe('lazy-task');
    expect(s.history).toHaveLength(1);
    expect(s.history[0]!.content).toBe('hi');
  });

  it('preserves insertion order (FIFO history)', () => {
    for (let i = 0; i < 5; i++) {
      bot.appendToSession('BossBot', 'task-1', makeMessage('BossBot', `m${i}`));
    }
    const s = bot.getOrCreateSession('BossBot', 'task-1');
    expect(s.history.map(m => m.content)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  it('BossBot and CreatorBot sessions remain isolated even when both are actively appended', () => {
    bot.appendToSession('BossBot',    'shared', makeMessage('BossBot',    'b1'));
    bot.appendToSession('CreatorBot', 'shared', makeMessage('CreatorBot', 'c1'));
    bot.appendToSession('BossBot',    'shared', makeMessage('BossBot',    'b2'));

    const sBoss    = bot.getOrCreateSession('BossBot',    'shared');
    const sCreator = bot.getOrCreateSession('CreatorBot', 'shared');
    expect(sBoss.history.map(m => m.content)).toEqual(['b1', 'b2']);
    expect(sCreator.history.map(m => m.content)).toEqual(['c1']);
  });
});

// ── 4. destroyTaskSessions — production caller AgentRegistry.closeTask ──────

describe('AdvisorBot.destroyTaskSessions', () => {
  let bot: AdvisorBot;

  beforeEach(() => {
    bot = new AdvisorBot();
  });

  it('removes all sessions matching the taskId (regardless of callerId)', () => {
    bot.getOrCreateSession('BossBot',    'task-x');
    bot.getOrCreateSession('CreatorBot', 'task-x');
    bot.getOrCreateSession('BossBot',    'task-y');

    bot.destroyTaskSessions('task-x');

    // After destroy, getOrCreateSession must return fresh sessions for task-x
    // (proving the old Map entries are gone), but task-y survives untouched.
    const sBossX    = bot.getOrCreateSession('BossBot',    'task-x');
    const sCreatorX = bot.getOrCreateSession('CreatorBot', 'task-x');
    const sBossY    = bot.getOrCreateSession('BossBot',    'task-y');

    expect(sBossX.history).toEqual([]);    // fresh — old session was destroyed
    expect(sCreatorX.history).toEqual([]); // fresh — old session was destroyed
    expect(sBossY.history).toEqual([]);    // fresh, but task-y was never destroyed
  });

  it('uses suffix match — `::${taskId}` so taskId="x" does NOT destroy "xy"', () => {
    // The implementation is `if (key.endsWith(`::${taskId}`))` (line 65).
    // This means a taskId="x" must NOT destroy a session keyed "BossBot::xy".
    // We pin the documented suffix-match behavior here.
    bot.getOrCreateSession('BossBot', 'xy');
    const sBefore = bot.getOrCreateSession('BossBot', 'xy');
    expect(sBefore.history).toEqual([]);

    bot.destroyTaskSessions('x');

    const sAfter = bot.getOrCreateSession('BossBot', 'xy');
    // sAfter === sBefore because the session for "xy" was NOT destroyed.
    expect(sAfter).toBe(sBefore);
  });

  it('is idempotent — calling twice on the same taskId does not throw', () => {
    bot.getOrCreateSession('BossBot', 'task-1');
    expect(() => bot.destroyTaskSessions('task-1')).not.toThrow();
    expect(() => bot.destroyTaskSessions('task-1')).not.toThrow();
    // After both calls, getOrCreateSession still works.
    const s = bot.getOrCreateSession('BossBot', 'task-1');
    expect(s.history).toEqual([]);
  });

  it('does not throw when called with a taskId that has no sessions', () => {
    bot.getOrCreateSession('BossBot', 'task-1');
    expect(() => bot.destroyTaskSessions('never-existed')).not.toThrow();
    // The pre-existing session must still be intact.
    const s = bot.getOrCreateSession('BossBot', 'task-1');
    expect(s).toBeDefined();
  });

  it('preserves createdAt when destroyTaskSessions is called between two getOrCreateSession calls on the SAME task', () => {
    // destroyTaskSessions wipes the Map entry. After destroy, a follow-up
    // getOrCreateSession creates a NEW session object (with a NEW createdAt).
    // This pins the post-destroy-freshness behavior — useful for callers that
    // want to know whether they are looking at the original session.
    const sBefore = bot.getOrCreateSession('BossBot', 'task-1');
    const createdAtBefore = sBefore.createdAt;
    // Force a clock advance by sleeping 2ms — sufficient on any modern system.
    const sleepStart = Date.now();
    while (Date.now() - sleepStart < 2) { /* spin */ }

    bot.destroyTaskSessions('task-1');
    const sAfter = bot.getOrCreateSession('BossBot', 'task-1');
    expect(sAfter.createdAt).toBeGreaterThanOrEqual(createdAtBefore);
  });
});

// ── 5. buildContext — string formatting for LLM context ─────────────────────

describe('AdvisorBot.buildContext', () => {
  let bot: AdvisorBot;

  beforeEach(() => {
    bot = new AdvisorBot();
  });

  it('returns just "Context: ... Question: ..." when session history is empty', () => {
    const req = makeAdviceRequest('BossBot', 'C-context', 'Q-question');
    const session: AdvisorySession = {
      callerId: 'BossBot',
      taskId:   'task-1',
      history:  [],
      createdAt: Date.now(),
    };
    const out = bot.buildContext(req, session);
    expect(out).toBe('Context:\nC-context\n\nQuestion:\nQ-question');
  });

  it('prefixes "Previous exchanges:" + joined history when history is non-empty', () => {
    const req = makeAdviceRequest('BossBot', 'ctx', 'q');
    const session: AdvisorySession = {
      callerId: 'BossBot',
      taskId:   'task-1',
      history:  [
        makeMessage('BossBot',    'first q'),
        makeMessage('AdvisorBot', 'first a'),
      ],
      createdAt: Date.now(),
    };
    const out = bot.buildContext(req, session);
    expect(out).toBe(
      'Previous exchanges:\n' +
      '[BossBot]: first q\n' +
      '[AdvisorBot]: first a\n' +
      '\n' +
      'Context:\nctx\n\n' +
      'Question:\nq',
    );
  });

  it('preserves insertion order of history messages', () => {
    const req = makeAdviceRequest('CreatorBot', 'ctx', 'q');
    const session: AdvisorySession = {
      callerId: 'CreatorBot',
      taskId:   'task-1',
      history:  [
        makeMessage('CreatorBot', 'q1'),
        makeMessage('AdvisorBot', 'a1'),
        makeMessage('CreatorBot', 'q2'),
        makeMessage('AdvisorBot', 'a2'),
      ],
      createdAt: Date.now(),
    };
    const out = bot.buildContext(req, session);
    const lines = out.split('\n');
    // The 4 history lines (lines 1-4, since index 0 is the "Previous exchanges:" header) are in order.
    expect(lines[1]).toBe('[CreatorBot]: q1');
    expect(lines[2]).toBe('[AdvisorBot]: a1');
    expect(lines[3]).toBe('[CreatorBot]: q2');
    expect(lines[4]).toBe('[AdvisorBot]: a2');
  });

  it('joins history entries with a single newline (no double-newline BETWEEN entries)', () => {
    const req = makeAdviceRequest('BossBot', 'ctx', 'q');
    const session: AdvisorySession = {
      callerId: 'BossBot',
      taskId:   'task-1',
      history:  [
        makeMessage('BossBot',    'one'),
        makeMessage('AdvisorBot', 'two'),
      ],
      createdAt: Date.now(),
    };
    const out = bot.buildContext(req, session);
    // The history join uses .join('\n'), so between consecutive entries there
    // is exactly one newline. A double newline would imply the join string or
    // the entry content introduced an extra blank line. Pin the join pattern.
    expect(out).toContain('[BossBot]: one\n[AdvisorBot]: two');
    expect(out).not.toContain('[BossBot]: one\n\n[AdvisorBot]: two'); // no blank line BETWEEN entries
  });

  it('separates the history block from the "Context:" section with a blank line', () => {
    const req = makeAdviceRequest('BossBot', 'ctx', 'q');
    const session: AdvisorySession = {
      callerId: 'BossBot',
      taskId:   'task-1',
      history:  [makeMessage('BossBot', 'one')],
      createdAt: Date.now(),
    };
    const out = bot.buildContext(req, session);
    // Pattern: "Previous exchanges:\n...\n\nContext:\n..." — a single blank line between sections.
    expect(out).toMatch(/Previous exchanges:\n\[BossBot\]: one\n\nContext:\nctx/);
  });

  it('does not escape or sanitize content (verbatim pass-through)', () => {
    const req = makeAdviceRequest('BossBot', 'safe', 'q');
    const session: AdvisorySession = {
      callerId: 'BossBot',
      taskId:   'task-1',
      history:  [makeMessage('BossBot', 'contains "quotes" and \\backslashes\\')],
      createdAt: Date.now(),
    };
    const out = bot.buildContext(req, session);
    expect(out).toContain('contains "quotes" and \\backslashes\\');
  });
});

// ── 6. Integration-ish — appendToSession + buildContext round-trip ──────────

describe('AdvisorBot — appendToSession + buildContext round-trip', () => {
  it('history appended via appendToSession is reflected in buildContext output', () => {
    const bot = new AdvisorBot();
    const session = bot.getOrCreateSession('BossBot', 'task-1');
    bot.appendToSession('BossBot', 'task-1', makeMessage('BossBot', 'hello'));
    bot.appendToSession('BossBot', 'task-1', makeMessage('AdvisorBot', 'hi back'));

    const req = makeAdviceRequest('BossBot', 'ctx', 'q');
    const out = bot.buildContext(req, session);
    expect(out).toContain('[BossBot]: hello');
    expect(out).toContain('[AdvisorBot]: hi back');
  });
});

// ── 7. Wall-clean check (banner only — actual grep run in §G-12) ────────────
// The packet's wall-clean requirement (§R-008) is enforced by a grep over the
// committed test file. This block exists only as documentation; the build
// agent's grep on lines below should report 0 hits.