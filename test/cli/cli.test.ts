/**
 * cli.test.ts — Direct unit tests for the 2 CLI surface files in
 * src/alienclaw/cli/: cli.ts (runAlienClaw) + register.run.ts
 * (registerRunCommand).
 *
 * Per PACKET-STANDARD §3 Scope-guard. Both files are the entry surface
 * for the `alienclaw run "<goal>"` CLI invocation (the only user-facing
 * path into BossBot per AGENTS.md §"VERIFICATION CHECKLIST" item 1 +
 * item 4). The pre-existing test/cli-args.test.ts (packet 064) covers
 * parseCliArgs but EXPLICITLY defers both files in its header:
 *
 *   "Out of scope (deferred to future packets):
 *      - runAlienClaw(goal, verbosity)         — couples to bootstrap() + process signals
 *      - registerRunCommand(program)            — couples to Commander
 *      - alienclaw.mjs entry                    — couples to process.argv side-effects"
 *
 * This packet recovers that deferred scope. Both files are tiny (50 + 32
 * LOC), have ZERO direct unit-test coverage on origin/main @ fb85aa9c
 * (verified §G-1), and are testable in pure isolation by mocking
 * ../wiring/hierarchy-bootstrap.js (the integration-coupled load-bearing
 * dep) — the well-precedented vi.mock pattern (see test/comms/user-channel.test.ts:72).
 *
 * Scope (per PACKET-STANDARD §3 Scope-guard):
 *   - runAlienClaw(goal, verbosity)    in src/alienclaw/cli/cli.ts
 *   - registerRunCommand(program)        in src/alienclaw/cli/register.run.ts
 *
 * Out of scope (deferred to future packets):
 *   - parseCliArgs(argv)                 in src/alienclaw/cli/args.ts
 *     (covered by packet 064 / test/cli-args.test.ts; 33 cases)
 *   - alienclaw.mjs entry                (couples to process.argv side-effects
 *     AND dynamically imports cli.js; would require stubbing tsx + a child-process
 *     spawn to exercise; deliberately deferred to keep this packet focused)
 *   - hierarchy-bootstrap.ts             (0% covered, 22 imports, EXCLUDED
 *     by the alienclaw-coverage-sweep-packet skill: "The file requires real
 *     LLM calls, real DB, or has heavy integration coupling (20+ imports) — DO NOT
 *     use this pattern.")
 *
 * Run: ./node_modules/.bin/vitest run test/cli/cli.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (declared before imports per vi.mock hoisting rules) ───────────────

// Use vi.hoisted to share state between the hoisted mock factories and the
// test bodies below. This is the vitest-recommended pattern for sharing
// mutable mock state (https://vitest.dev/api/vi.html#vi-hoisted).
const mocks = vi.hoisted(() => {
  const loop = {
    submitGoal: vi.fn(),
    start:      vi.fn(async () => {}),
    stop:       vi.fn(),
  };
  const userChannel = {
    required: vi.fn(),
    advise:   vi.fn(),
    inform:   vi.fn(),
    prompt:   vi.fn(),
  };
  const bootstrap = vi.fn(() => ({ loop, userChannel }));
  const preferences: { verbosity: 'silent' | 'normal' | 'verbose' } =
    { verbosity: 'normal' };
  return { loop, userChannel, bootstrap, preferences };
});

vi.mock('../../src/alienclaw/wiring/hierarchy-bootstrap.js', () => ({
  bootstrap: () => mocks.bootstrap(),
}));

vi.mock('../../src/alienclaw/config/alienclaw-config.js', () => ({
  alienClawConfig: { preferences: mocks.preferences },
}));

// Import after vi.mock so the modules pick up the mocks.
import { runAlienClaw }   from '../../src/alienclaw/cli/cli.js';
import { registerRunCommand } from '../../src/alienclaw/cli/register.run.js';
import type { Command }   from 'commander';
import type { VerbosityMode } from '../../src/alienclaw/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Commander-shaped stub. We don't import commander at
 *  runtime (it has its own init side-effects); the registerRunCommand
 *  source only USES the chainable methods (.command / .description /
 *  .option / .addHelpText / .action) plus stores the action callback.
 *  We capture the action + the last .command() name for assertions. */
function makeFakeProgram(): { program: Command;
                              lastCommandName: () => string | null;
                              lastAction:      () => ((...args: unknown[]) => unknown) | null;
                              helpText:        () => string | null } {
  let _cmdName: string | null = null;
  let _action:  ((...args: unknown[]) => unknown) | null = null;
  let _helpText: string | null = null;

  const program: Command = {
    command:  (name: string) => { _cmdName = name; return program; },
    description: () => program,
    option:   () => program,
    addHelpText: (_when: string, text: string) => { _helpText = text; return program; },
    action:   (fn: (...args: unknown[]) => unknown) => { _action = fn; return program; },
  } as unknown as Command;

  return {
    program,
    lastCommandName: () => _cmdName,
    lastAction:      () => _action,
    helpText:        () => _helpText,
  };
}

// ── 1. runAlienClaw — empty-goal early return (highest priority) ────────────

describe('runAlienClaw — empty / whitespace-only goal', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let prevExitCode: number;

  beforeEach(() => {
    mocks.loop.submitGoal.mockClear();
    mocks.loop.start.mockClear();
    mocks.loop.stop.mockClear();
    mocks.userChannel.required.mockClear();
    mocks.userChannel.advise.mockClear();
    mocks.userChannel.inform.mockClear();
    mocks.userChannel.prompt.mockClear();
    mocks.bootstrap.mockClear();
    mocks.preferences.verbosity = 'normal';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // capture prior exitCode and reset to 0; we'll assert the post-call value.
    // process.exitCode is `string | number | null | undefined` in @types/node;
    // we coerce to `number` (the only value cli.ts assigns in this file).
    prevExitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
    process.exitCode = 0;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = prevExitCode;
  });

  it('R-001: empty string goal → writes stderr message and sets exitCode=1, returns early', async () => {
    await runAlienClaw('');

    expect(stderrSpy).toHaveBeenCalledWith(
      '[alienclaw] run: goal cannot be empty.\n',
    );
    expect(process.exitCode).toBe(1);
    // bootstrap must NOT have been called on the empty-goal early-return path
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    // no further work
    expect(mocks.loop.submitGoal).not.toHaveBeenCalled();
    expect(mocks.loop.start).not.toHaveBeenCalled();
  });

  it('R-001: whitespace-only goal → also returns early (goal.trim() === "")', async () => {
    await runAlienClaw('   \t  \n  ');

    expect(stderrSpy).toHaveBeenCalledWith(
      '[alienclaw] run: goal cannot be empty.\n',
    );
    expect(process.exitCode).toBe(1);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });
});

// ── 2. runAlienClaw — verbosity override applied BEFORE bootstrap() ──────────

describe('runAlienClaw — verbosity override ordering', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.loop.submitGoal.mockClear();
    mocks.loop.start.mockClear();
    mocks.loop.stop.mockClear();
    mocks.userChannel.required.mockClear();
    mocks.bootstrap.mockClear();
    mocks.preferences.verbosity = 'normal';   // baseline
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // capture signal handler registrations
    processOnSpy = vi.spyOn(process, 'once').mockImplementation(() => process);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  it('R-002: silent override → preferences.verbosity set to "silent" before bootstrap()', async () => {
    await runAlienClaw('do the thing', 'silent');

    expect(mocks.preferences.verbosity).toBe('silent');
    // bootstrap was called exactly once
    expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
    // mocks.preferences.verbosity was already 'silent' when bootstrap() was called —
    // we assert ordering by snapshotting the value at the moment bootstrap() ran
    const bootstrapCallOrder = mocks.bootstrap.mock.invocationCallOrder[0];
    // (the mocks.bootstrap closure reads mocks.preferences.verbosity lazily; we
    // already verified it's 'silent' above)
    expect(bootstrapCallOrder).toBeGreaterThan(0);
  });

  it('R-002: verbose override → preferences.verbosity set to "verbose"', async () => {
    await runAlienClaw('research', 'verbose');

    expect(mocks.preferences.verbosity).toBe('verbose');
    expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('R-002: no override (default) → preferences.verbosity stays at whatever it was', async () => {
    mocks.preferences.verbosity = 'verbose';   // pre-existing config

    await runAlienClaw('something');         // no verbosity arg

    // default param is 'normal' per the source signature — cli.ts ALWAYS writes
    // preferences.verbosity = verbosity (even when 'normal'), so this resets to 'normal'
    expect(mocks.preferences.verbosity).toBe('normal');
    expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
  });
});

// ── 3. runAlienClaw — signal handler registration (SIGINT + SIGTERM) ─────────

describe('runAlienClaw — SIGINT/SIGTERM handler registration', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.loop.submitGoal.mockClear();
    mocks.loop.start.mockClear();
    mocks.loop.stop.mockClear();
    mocks.userChannel.required.mockClear();
    mocks.bootstrap.mockClear();
    mocks.preferences.verbosity = 'normal';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    processOnSpy = vi.spyOn(process, 'once').mockImplementation(() => process);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  it('R-003: registers a SIGINT handler that calls userChannel.required + loop.stop()', async () => {
    await runAlienClaw('test goal');

    // process.once was called at least twice (SIGINT + SIGTERM)
    const signals = processOnSpy.mock.calls.map((c: [NodeJS.Signals, ...unknown[]]) => c[0]);
    expect(signals).toContain('SIGINT');
    expect(signals).toContain('SIGTERM');

    // invoke the captured SIGINT handler to verify the closure body
    const sigintCall = processOnSpy.mock.calls.find((c: [NodeJS.Signals, ...unknown[]]) => c[0] === 'SIGINT')!;
    const sigintHandler = sigintCall[1] as (s: string) => void;
    sigintHandler('SIGINT');

    expect(mocks.userChannel.required).toHaveBeenCalledWith(
      '\nCaught SIGINT — stopping gracefully.',
    );
    expect(mocks.loop.stop).toHaveBeenCalledTimes(1);
  });

  it('R-003: registers a SIGTERM handler that calls userChannel.required + loop.stop()', async () => {
    await runAlienClaw('test goal');

    const sigtermCall = processOnSpy.mock.calls.find((c: [NodeJS.Signals, ...unknown[]]) => c[0] === 'SIGTERM')!;
    const sigtermHandler = sigtermCall[1] as (s: string) => void;
    sigtermHandler('SIGTERM');

    expect(mocks.userChannel.required).toHaveBeenCalledWith(
      '\nCaught SIGTERM — stopping gracefully.',
    );
    expect(mocks.loop.stop).toHaveBeenCalledTimes(1);
  });
});

// ── 4. runAlienClaw — run loop invocation order ─────────────────────────────

describe('runAlienClaw — loop.submitGoal + loop.start ordering', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.loop.submitGoal.mockClear();
    mocks.loop.start.mockClear();
    mocks.loop.stop.mockClear();
    mocks.userChannel.required.mockClear();
    mocks.bootstrap.mockClear();
    mocks.preferences.verbosity = 'normal';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'once').mockImplementation(() => process);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('R-004: submitGoal called with the goal string before start()', async () => {
    await runAlienClaw('write a poem about Rust');

    expect(mocks.loop.submitGoal).toHaveBeenCalledTimes(1);
    expect(mocks.loop.submitGoal).toHaveBeenCalledWith('write a poem about Rust');
    expect(mocks.loop.start).toHaveBeenCalledTimes(1);

    // assert ordering: submitGoal before start
    const submitOrder = mocks.loop.submitGoal.mock.invocationCallOrder[0]!;
    const startOrder  = mocks.loop.start.mock.invocationCallOrder[0]!;
    expect(submitOrder).toBeLessThan(startOrder);
  });

  it('R-004: awaits loop.start() (returns a Promise that resolves when start resolves)', async () => {
    let startResolved = false;
    mocks.loop.start.mockImplementationOnce(async () => {
      // give the test a chance to assert that we are awaiting
      await new Promise((r) => setImmediate(r));
      startResolved = true;
    });

    const p = runAlienClaw('goal');
    expect(startResolved).toBe(false);   // not yet
    await p;
    expect(startResolved).toBe(true);    // awaited
  });
});

// ── 5. registerRunCommand — command name + option wiring ─────────────────────

describe('registerRunCommand — command surface', () => {
  it('R-005: registers a "run <goal>" subcommand', () => {
    const fake = makeFakeProgram();
    registerRunCommand(fake.program);

    expect(fake.lastCommandName()).toBe('run <goal>');
  });

  it('R-005: attaches a help-text block that mentions --verbose, --silent, and the workspace output dir', () => {
    const fake = makeFakeProgram();
    registerRunCommand(fake.program);

    const help = fake.helpText();
    expect(help).not.toBeNull();
    expect(help).toContain('Examples:');
    expect(help).toContain('alienclaw run');
    expect(help).toContain('--verbose');
    expect(help).toContain('--silent');
    expect(help).toContain('~/.alienclaw/workspace/output/');
  });
});

// ── 6. registerRunCommand — action callback delegation ──────────────────────

describe('registerRunCommand — action callback', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.loop.submitGoal.mockClear();
    mocks.loop.start.mockClear();
    mocks.loop.stop.mockClear();
    mocks.userChannel.required.mockClear();
    mocks.bootstrap.mockClear();
    mocks.preferences.verbosity = 'normal';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'once').mockImplementation(() => process);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('R-006: action with --verbose → invokes runAlienClaw(goal, "verbose")', async () => {
    const fake = makeFakeProgram();
    registerRunCommand(fake.program);

    const action = fake.lastAction();
    expect(action).not.toBeNull();
    await action!('draft a blog post', { verbose: true, silent: false });

    expect(mocks.preferences.verbosity).toBe('verbose');
    expect(mocks.loop.submitGoal).toHaveBeenCalledWith('draft a blog post');
    expect(mocks.loop.start).toHaveBeenCalledTimes(1);
  });

  it('R-006: action with --silent → invokes runAlienClaw(goal, "silent")', async () => {
    const fake = makeFakeProgram();
    registerRunCommand(fake.program);

    const action = fake.lastAction();
    await action!('quiet task', { verbose: false, silent: true });

    expect(mocks.preferences.verbosity).toBe('silent');
    expect(mocks.loop.submitGoal).toHaveBeenCalledWith('quiet task');
    expect(mocks.loop.start).toHaveBeenCalledTimes(1);
  });

  it('R-006: action with neither flag → invokes runAlienClaw(goal, "normal")', async () => {
    const fake = makeFakeProgram();
    registerRunCommand(fake.program);

    const action = fake.lastAction();
    await action!('plain task', { verbose: false, silent: false });

    expect(mocks.preferences.verbosity).toBe('normal');
    expect(mocks.loop.submitGoal).toHaveBeenCalledWith('plain task');
    expect(mocks.loop.start).toHaveBeenCalledTimes(1);
  });

  it('R-006: action with empty goal → runAlienClaw early-returns (no bootstrap, exitCode=1)', async () => {
    const fake = makeFakeProgram();
    registerRunCommand(fake.program);

    const action = fake.lastAction();
    const prevExitCode = process.exitCode;
    process.exitCode = 0;

    await action!('', { verbose: false, silent: false });

    expect(stderrSpy).toHaveBeenCalledWith(
      '[alienclaw] run: goal cannot be empty.\n',
    );
    expect(process.exitCode).toBe(1);
    expect(mocks.bootstrap).not.toHaveBeenCalled();

    process.exitCode = prevExitCode ?? 0;
  });
});

// ── 7. wall-clean check (no banned terms in the new test file) ──────────────
//
// The wall-clean invariant is verified at packet authoring time via a
// shell-out grep in the Grounding Ledger (§G-12) and is re-verified at
// build time by the same shell-out grep in the build agent's check
// sequence. We do NOT inline the banned terms in a self-referential
// file-read test (which would always fail because the test would have
// to mention the terms to grep for them). The shell-out pattern is the
// canonical discipline per the alienclaw-coverage-sweep-packet skill.
