/**
 * cli-args.test.ts — Direct unit tests for parseCliArgs in
 * src/alienclaw/cli/args.ts.
 *
 * parseCliArgs is the entry point for every `alienclaw` CLI invocation:
 *   src/alienclaw/cli/alienclaw.mjs        → parseCliArgs(process.argv)
 *   src/alienclaw/cli/register.run.ts:29   → (uses Commander; calls runAlienClaw directly)
 *
 * The function has ZERO direct unit tests on origin/main (verified 2026-06-19T21:15Z,
 * see packet 064 Grounding Ledger §G-1). It is a pure function (string[] → discriminated
 * union), so it is testable in pure isolation — no DB, no env-var, no filesystem, no LLM.
 *
 * Scope (per PACKET-STANDARD §3 Scope-guard):
 *   - parseCliArgs(argv) — the single export of src/alienclaw/cli/args.ts.
 *
 * Out of scope (deferred to future packets):
 *   - runAlienClaw(goal, verbosity)         — couples to bootstrap() + process signals
 *   - registerRunCommand(program)            — couples to Commander
 *   - alienclaw.mjs entry                    — couples to process.argv side-effects
 *
 * Run: ./node_modules/.bin/vitest run test/cli-args.test.ts
 */

import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../src/alienclaw/cli/args.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a CLI argv with the [node, script] interpreter prefix stripped (matches
 *  the alienclaw.mjs entry path that calls `parseCliArgs(process.argv)`). */
const cli = (...args: string[]): string[] => ['node', '/usr/local/bin/alienclaw', ...args];

// ── 1. version / help branches (highest priority — short-circuit on first match) ─

describe('parseCliArgs — --version / --help short-circuit', () => {
  it('R-001: returns version type for --version flag (alone)', () => {
    expect(parseCliArgs(cli('--version'))).toEqual({ type: 'version' });
  });

  it('R-001: returns version type for -V short flag', () => {
    expect(parseCliArgs(cli('-V'))).toEqual({ type: 'version' });
  });

  it('R-002: returns help type for --help flag (alone)', () => {
    expect(parseCliArgs(cli('--help'))).toEqual({ type: 'help' });
  });

  it('R-002: returns help type for -h short flag', () => {
    expect(parseCliArgs(cli('-h'))).toEqual({ type: 'help' });
  });

  it('R-001/002: --version takes priority over --help when both present', () => {
    // Documented behavior: the parser checks --version FIRST, so --help is shadowed.
    // This is the production branch order at src/alienclaw/cli/args.ts:42-46.
    expect(parseCliArgs(cli('--version', '--help'))).toEqual({ type: 'version' });
  });

  it('R-001: --version short-circuits even when followed by other args', () => {
    expect(parseCliArgs(cli('--version', 'run', 'something'))).toEqual({ type: 'version' });
  });
});

// ── 2. unknown / empty argv ───────────────────────────────────────────────────

describe('parseCliArgs — unknown / empty', () => {
  it('R-003: returns unknown with raw [] for empty argv', () => {
    expect(parseCliArgs(cli())).toEqual({ type: 'unknown', raw: [] });
  });

  it('R-003: returns unknown with raw for unrecognized subcommand', () => {
    expect(parseCliArgs(cli('install'))).toEqual({ type: 'unknown', raw: ['install'] });
  });

  it('R-003: returns unknown with raw [] for completely empty argv (no interpreter prefix)', () => {
    // Triggers branch 0 arm1 (L55): argv[0] is undefined → argv[0] ?? '' fires
    expect(parseCliArgs([])).toEqual({ type: 'unknown', raw: [] });
  });

  it('R-004: returns unknown for `run` with no goal', () => {
    expect(parseCliArgs(cli('run'))).toEqual({ type: 'unknown', raw: ['run'] });
  });

  it('R-004: returns unknown for `run ""` (empty string goal)', () => {
    expect(parseCliArgs(cli('run', ''))).toEqual({ type: 'unknown', raw: ['run', ''] });
  });

  it('R-004: returns unknown for `run "   "` (whitespace-only goal)', () => {
    expect(parseCliArgs(cli('run', '   '))).toEqual({ type: 'unknown', raw: ['run', '   '] });
  });
});

// ── 3. run subcommand — happy path + flags ────────────────────────────────────

describe('parseCliArgs — run subcommand', () => {
  it('R-005: returns run with default verbosity=normal for `run "<goal>"`', () => {
    expect(parseCliArgs(cli('run', 'research quantum computing'))).toEqual({
      type: 'run',
      args: { goal: 'research quantum computing', verbosity: 'normal' },
    });
  });

  it('R-005: returns run for `run <single-word-goal>`', () => {
    expect(parseCliArgs(cli('run', 'hello'))).toEqual({
      type: 'run',
      args: { goal: 'hello', verbosity: 'normal' },
    });
  });

  it('R-006: returns run with verbosity=verbose when --verbose flag present', () => {
    expect(parseCliArgs(cli('run', 'do the thing', '--verbose'))).toEqual({
      type: 'run',
      args: { goal: 'do the thing', verbosity: 'verbose' },
    });
  });

  it('R-007: returns run with verbosity=silent when --silent flag present', () => {
    expect(parseCliArgs(cli('run', 'do the thing', '--silent'))).toEqual({
      type: 'run',
      args: { goal: 'do the thing', verbosity: 'silent' },
    });
  });

  it('R-008: --verbose wins over --silent when both are present (documented order)', () => {
    // Documented behavior at args.ts:54-56: verbose ? 'verbose' : silent ? 'silent' : 'normal'.
    // --verbose is checked first, so it shadows --silent. This test locks the precedence.
    expect(parseCliArgs(cli('run', 'do the thing', '--silent', '--verbose'))).toEqual({
      type: 'run',
      args: { goal: 'do the thing', verbosity: 'verbose' },
    });
  });

  it('R-009: trims surrounding whitespace from the joined goal', () => {
    // Documented at args.ts:63: `positionals.slice(1).join(' ').trim()`.
    expect(parseCliArgs(cli('run', '   research', 'quantum', 'computing   '))).toEqual({
      type: 'run',
      args: { goal: 'research quantum computing', verbosity: 'normal' },
    });
  });

  it('R-010: joins multi-token goals with single spaces', () => {
    expect(parseCliArgs(cli('run', 'a', 'b', 'c', 'd'))).toEqual({
      type: 'run',
      args: { goal: 'a b c d', verbosity: 'normal' },
    });
  });

  it('R-011: accepts --verbose in flag position (after positional args)', () => {
    // Flag detection at args.ts:51 uses `startsWith('-')`, so flags can appear in any order.
    expect(parseCliArgs(cli('run', 'do the thing'))).toEqual({
      type: 'run',
      args: { goal: 'do the thing', verbosity: 'normal' },
    });
    // Re-assert with the flag at the end:
    const withFlag = parseCliArgs(cli('run', 'do the thing', '--verbose'));
    expect(withFlag).toEqual({
      type: 'run',
      args: { goal: 'do the thing', verbosity: 'verbose' },
    });
  });
});

// ── 4. interpreter-prefix handling ────────────────────────────────────────────

describe('parseCliArgs — interpreter-prefix handling', () => {
  it('R-012: strips [node, script] prefix when argv[0] is "node"', () => {
    expect(parseCliArgs(['node', '/usr/local/bin/alienclaw', '--version'])).toEqual({
      type: 'version',
    });
  });

  it('R-012: strips [node, script] prefix when argv[0] is "tsx"', () => {
    expect(parseCliArgs(['tsx', './src/alienclaw/cli/alienclaw.mjs', 'run', 'hello'])).toEqual({
      type: 'run',
      args: { goal: 'hello', verbosity: 'normal' },
    });
  });

  it('R-012: strips [node, script] prefix when argv[0] is "bun"', () => {
    expect(parseCliArgs(['bun', 'alienclaw.mjs', '--help'])).toEqual({ type: 'help' });
  });

  it('R-013: does NOT strip when argv[0] is a non-interpreter (direct invocation)', () => {
    // alienclaw.mjs already strips the [node, script] prefix and passes the rest directly.
    // parseCliArgs is called with that already-stripped argv. When called directly (no prefix),
    // the parser does NOT strip (the prefix-detection only matches node/tsx/bun).
    expect(parseCliArgs(['--version'])).toEqual({ type: 'version' });
    expect(parseCliArgs(['run', 'hello'])).toEqual({
      type: 'run',
      args: { goal: 'hello', verbosity: 'normal' },
    });
  });
});
