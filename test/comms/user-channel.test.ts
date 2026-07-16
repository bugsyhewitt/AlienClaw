/**
 * user-channel.test.ts — direct unit tests for
 * `src/alienclaw/comms/user-channel.ts` (packet 085).
 *
 * Background:
 *   `user-channel.ts` (80 lines, 1 class) exposes 5 public methods on the
 *   `UserChannel` class:
 *     - status(msg: string): void
 *         (emits in normal + verbose modes; suppresses in silent)
 *     - required(msg: string): void
 *         (always emits — results, sign-off requests, Strike 3 alerts)
 *     - verbose(msg: string): void
 *         (emits only in verbose mode)
 *     - prompt(msg: string): Promise<string>
 *         (always prompts and awaits a single line from stdin)
 *     - strikeAlert(task: TaskEnvelope, fullLog: boolean): Promise<string>
 *         (Strike 3 surface; summary mode by default, full log on request)
 *     - close(): void
 *         (closes the readline interface and clears the cached ref)
 *
 *   Plus 1 module-internal helper (NOT exported, not part of the public surface):
 *     - readLine(promptStr: string): Promise<string>  (line 67)
 *
 *   The class is instantiated at CLI startup
 *   (`wiring/hierarchy-bootstrap.ts:68` — `new UserChannel(prefs)`)
 *   and is the canonical "what the user sees + what the user types" surface.
 *   It is consumed by governance/loop via `governance-loop.ts:86`
 *   (private readonly userChannel), and by both
 *   `governance/common/completion-handler.ts:40` and
 *   `governance/common/escalation-handler.ts:25`. A regression in:
 *     - the verbosity matrix (silent / normal / verbose) for status + verbose
 *     - the always-emit behavior of required
 *     - the prompt header prefix (`[AlienClaw] `)
 *     - the verbose-mode header prefix (`[AlienClaw:verbose] `)
 *     - the lazy readline-init-on-first-prompt + cached-Interface pattern
 *     - the strikeAlert attempt enumeration (numbered list, one per attempt)
 *     - the strikeAlert `fullLog` toggle (JSON dump of the full task state)
 *     - the strikeAlert footer text (budget:<N> / abandon instructions)
 *     - the close() lifecycle (closes the cached rl, clears the cached ref)
 *   …would silently break user-facing CLI behavior with no test catching it.
 *
 *   The only existing test for any caller of UserChannel is
 *   `test/agents/creatorbot-queue.test.ts` and the governance handlers
 *   (escalation-handler, completion-handler); those tests use a STUB of
 *   UserChannel — they do not exercise the real implementation. The real
 *   class has ZERO direct unit-test coverage on `origin/main @ e9c90204`
 *   (verified at packet authoring: `wc -l test/comms/*.test.ts` → 0 files).
 *
 * Wall discipline: no production code is modified. Test-only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── readline mock ────────────────────────────────────────────────────────────
// `user-channel.ts` lazily creates a readline.Interface on the first prompt
// and caches it on the instance. We mock the `readline` module so we can
// (a) assert the constructor is called with { input: process.stdin,
// output: process.stdout }, (b) control what the "user" types by capturing
// the `question` callback and invoking it with a chosen string, and
// (c) inspect the close() lifecycle.

type QuestionCb = (answer: string) => void;
interface FakeRl {
  question: ReturnType<typeof vi.fn>;
  close:    ReturnType<typeof vi.fn>;
}

let pendingCb: QuestionCb | null = null;
let capturedPrompt: string | null = null;
let fakeRl: FakeRl;

vi.mock('readline', () => {
  return {
    createInterface: vi.fn(() => {
      fakeRl = {
        question: vi.fn((promptStr: string, cb: QuestionCb) => {
          capturedPrompt = promptStr;
          pendingCb = cb;
        }),
        close: vi.fn(),
      };
      return fakeRl;
    }),
  };
});

// Import after vi.mock so the module picks up the mock.
import * as readline from 'readline';
import { UserChannel } from '../../src/alienclaw/comms/user-channel.js';
import type { UserPreferences, TaskEnvelope } from '../../src/alienclaw/types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePrefs(verbosity: 'silent' | 'normal' | 'verbose' = 'normal'): UserPreferences {
  return { verbosity, advisorPersistence: 'off' };
}

/** Capture every console.log call into a flat array of strings. */
function captureLog(): string[] {
  const out: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(' '));
  });
  return out;
}

/** Drain the pending readline callback with a chosen "user reply". */
function reply(answer: string): void {
  if (!pendingCb) throw new Error('no pending readline question');
  pendingCb(answer);
  pendingCb = null;
}

function makeTask(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  const baseAttempts = [
    { attemptNumber: 1, subagentId: 'sa1', failureReason: 'timeout',      advisorVerdict: 'fail', ts: 1000 },
    { attemptNumber: 2, subagentId: 'sa2', failureReason: '404 not found', advisorVerdict: 'fail', ts: 2000 },
    { attemptNumber: 3, subagentId: 'sa3', failureReason: 'parse error',   advisorVerdict: 'fail', ts: 3000 },
  ];
  return {
    taskId:      't1',
    description: 'Find a paper',
    domain:      'research',
    priority:    'normal',
    createdAt:   0,
    strikeCount: 3,
    attempts:    baseAttempts,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('UserChannel — output methods (verbosity matrix)', () => {
  let log: string[];
  beforeEach(() => { log = captureLog(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('status()', () => {
    it('emits in normal mode with [AlienClaw] prefix', () => {
      const ch = new UserChannel(makePrefs('normal'));
      ch.status('phase 1 done');
      expect(log).toEqual(['[AlienClaw] phase 1 done']);
    });

    it('emits in verbose mode with [AlienClaw] prefix', () => {
      const ch = new UserChannel(makePrefs('verbose'));
      ch.status('phase 1 done');
      expect(log).toEqual(['[AlienClaw] phase 1 done']);
    });

    it('suppresses in silent mode', () => {
      const ch = new UserChannel(makePrefs('silent'));
      ch.status('phase 1 done');
      expect(log).toEqual([]);
    });
  });

  describe('required()', () => {
    it('always emits in normal mode', () => {
      const ch = new UserChannel(makePrefs('normal'));
      ch.required('Approve?');
      expect(log).toEqual(['[AlienClaw] Approve?']);
    });

    it('always emits in verbose mode', () => {
      const ch = new UserChannel(makePrefs('verbose'));
      ch.required('Approve?');
      expect(log).toEqual(['[AlienClaw] Approve?']);
    });

    it('always emits in silent mode (overrides verbosity)', () => {
      const ch = new UserChannel(makePrefs('silent'));
      ch.required('Approve?');
      expect(log).toEqual(['[AlienClaw] Approve?']);
    });
  });

  describe('verbose()', () => {
    it('emits in verbose mode with [AlienClaw:verbose] prefix', () => {
      const ch = new UserChannel(makePrefs('verbose'));
      ch.verbose('debug: rewrote X');
      expect(log).toEqual(['[AlienClaw:verbose] debug: rewrote X']);
    });

    it('suppresses in normal mode', () => {
      const ch = new UserChannel(makePrefs('normal'));
      ch.verbose('debug: rewrote X');
      expect(log).toEqual([]);
    });

    it('suppresses in silent mode', () => {
      const ch = new UserChannel(makePrefs('silent'));
      ch.verbose('debug: rewrote X');
      expect(log).toEqual([]);
    });
  });
});

describe('UserChannel.prompt() — input flow', () => {
  let log: string[];
  beforeEach(() => {
    log = captureLog();
    capturedPrompt = null;
    pendingCb = null;
    // Reset the createInterface mock call count (the readline module is
    // mocked once at module load; per-test we need a fresh count).
    vi.mocked(readline.createInterface).mockClear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('emits the message via required() (always, regardless of verbosity)', async () => {
    const ch = new UserChannel(makePrefs('silent'));
    const p = ch.prompt('Enter goal:');
    expect(log).toEqual(['[AlienClaw] Enter goal:']);
    reply('my goal');
    await p;
  });

  it('lazily creates the readline interface on first prompt', async () => {
    const createSpy = vi.mocked(readline.createInterface);
    expect(createSpy).not.toHaveBeenCalled();

    const ch = new UserChannel(makePrefs());
    const p = ch.prompt('Enter goal:');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      input:  process.stdin,
      output: process.stdout,
    });
    reply('hello');
    await p;
  });

  it('reuses the cached readline interface on subsequent prompts', async () => {
    const createSpy = vi.mocked(readline.createInterface);
    const ch = new UserChannel(makePrefs());

    const p1 = ch.prompt('first:');
    reply('a');
    await p1;

    const p2 = ch.prompt('second:');
    reply('b');
    await p2;

    // Only one createInterface call across both prompts.
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('uses "> " as the readline prompt string', async () => {
    const ch = new UserChannel(makePrefs());
    const p = ch.prompt('Enter goal:');
    expect(capturedPrompt).toBe('> ');
    reply('typed');
    await p;
  });

  it('resolves with the user reply (verbatim, no trim)', async () => {
    const ch = new UserChannel(makePrefs());
    const p = ch.prompt('Enter goal:');
    reply('  goal with spaces  ');
    await expect(p).resolves.toBe('  goal with spaces  ');
  });

  it('resolves with an empty string if the user submits nothing', async () => {
    const ch = new UserChannel(makePrefs());
    const p = ch.prompt('Enter goal:');
    reply('');
    await expect(p).resolves.toBe('');
  });
});

describe('UserChannel.strikeAlert() — Strike 3 surface', () => {
  let log: string[];
  beforeEach(() => {
    log = captureLog();
    capturedPrompt = null;
    pendingCb = null;
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('emits a header with the task description and strike count (summary mode)', async () => {
    const ch = new UserChannel(makePrefs('silent'));   // silent — proves required() overrides verbosity
    const p = ch.strikeAlert(makeTask(), /* fullLog */ false);
    const out = log.join('\n');
    expect(out).toContain('Task "Find a paper" has failed 3 time(s).');
    reply('budget:5');
    await p;
  });

  it('enumerates the prior attempts in numbered order (summary mode)', async () => {
    const ch = new UserChannel(makePrefs());
    const p = ch.strikeAlert(makeTask(), /* fullLog */ false);
    const out = log.join('\n');
    expect(out).toContain('1. [sa1] timeout');
    expect(out).toContain('2. [sa2] 404 not found');
    expect(out).toContain('3. [sa3] parse error');
    reply('abandon');
    await p;
  });

  it('does NOT include the full task-state JSON in summary mode', async () => {
    const ch = new UserChannel(makePrefs());
    const p = ch.strikeAlert(makeTask(), /* fullLog */ false);
    const out = log.join('\n');
    expect(out).not.toContain('"taskId": "t1"');
    expect(out).not.toContain('"description": "Find a paper"');
    reply('abandon');
    await p;
  });

  it('includes the full task-state JSON dump in fullLog mode', async () => {
    const ch = new UserChannel(makePrefs());
    const p = ch.strikeAlert(makeTask(), /* fullLog */ true);
    const out = log.join('\n');
    expect(out).toContain('Full task state:');
    expect(out).toContain('"taskId": "t1"');
    expect(out).toContain('"description": "Find a paper"');
    reply('abandon');
    await p;
  });

  it('includes the recovery footer in both summary and fullLog modes', async () => {
    for (const fullLog of [false, true]) {
      log = captureLog();
      const ch = new UserChannel(makePrefs());
      const p = ch.strikeAlert(makeTask(), fullLog);
      const out = log.join('\n');
      expect(out).toContain('How to proceed?');
      expect(out).toContain('budget:<N>');
      expect(out).toContain('abandon');
      reply('abandon');
      await p;
    }
  });

  it('resolves with the user reply (verbatim)', async () => {
    const ch = new UserChannel(makePrefs());
    const p = ch.strikeAlert(makeTask(), /* fullLog */ false);
    reply('  please try with a different query  ');
    await expect(p).resolves.toBe('  please try with a different query  ');
  });

  it('uses the [AlienClaw] required() channel (overrides silent verbosity)', async () => {
    const ch = new UserChannel(makePrefs('silent'));
    const p = ch.strikeAlert(makeTask(), /* fullLog */ false);
    // Even in silent mode, the strike alert MUST surface to the user.
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]).toMatch(/^\[AlienClaw\]/);
    reply('abandon');
    await p;
  });
});

describe('UserChannel.close() — lifecycle', () => {
  beforeEach(() => {
    vi.mocked(readline.createInterface).mockClear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('is a no-op when no readline interface was ever created', () => {
    const ch = new UserChannel(makePrefs());
    // Should not throw, should not create an interface.
    expect(() => ch.close()).not.toThrow();
  });

  it('closes the cached readline interface when one was created', async () => {
    const ch = new UserChannel(makePrefs());
    const p = ch.prompt('first:');
    reply('a');
    await p;

    ch.close();
    expect(fakeRl.close).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: calling close() twice is safe', async () => {
    const ch = new UserChannel(makePrefs());
    const p = ch.prompt('first:');
    reply('a');
    await p;

    ch.close();
    expect(() => ch.close()).not.toThrow();
  });

  it('creates a fresh interface on the next prompt after close()', async () => {
    const createSpy = vi.mocked(readline.createInterface);
    const ch = new UserChannel(makePrefs());

    const p1 = ch.prompt('first:');
    reply('a');
    await p1;

    ch.close();
    expect(createSpy).toHaveBeenCalledTimes(1);

    const p2 = ch.prompt('second:');
    expect(createSpy).toHaveBeenCalledTimes(2);
    reply('b');
    await p2;
  });
});
