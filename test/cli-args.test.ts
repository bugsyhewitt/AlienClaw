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

// ── 4. evolve subcommand — happy path + numeric validation (PKT-492) ─────────

describe('parseCliArgs — evolve subcommand happy path', () => {
  it('E-001: returns evolve with defaults for minimal valid invocation', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute'))).toEqual({
      type: 'evolve',
      args: { martianType: 'compute', generations: 10, population: 32 },
    });
  });

  it('E-002: parses plain decimal --generations', () => {
    const result = parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '100'));
    expect(result).toEqual({
      type: 'evolve',
      args: { martianType: 'compute', generations: 100, population: 32 },
    });
  });

  it('E-003: parses plain decimal --population', () => {
    const result = parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '10', '--population', '64'));
    expect(result).toEqual({
      type: 'evolve',
      args: { martianType: 'compute', generations: 10, population: 64 },
    });
  });

  it('E-004: parses plain decimal --seed', () => {
    const result = parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '10', '--population', '32', '--seed', '42'));
    expect(result).toEqual({
      type: 'evolve',
      args: { martianType: 'compute', generations: 10, population: 32, seed: 42 },
    });
  });

  it('E-005: parses --inputs JSON string when non-empty', () => {
    const result = parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '10', '--population', '32', '--inputs', '{"x":1}'));
    expect(result).toEqual({
      type: 'evolve',
      args: { martianType: 'compute', generations: 10, population: 32, inputs: '{"x":1}' },
    });
  });
});

// ── 5. evolve — D1 scientific-notation bypass (PKT-492) ──────────────────────

describe('parseCliArgs — evolve D1: scientific notation rejected', () => {
  it('E-101: rejects 1e3 for --generations (sci-notation bypass)', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '1e3'))).toEqual({
      type: 'unknown',
      raw: ['evolve', '--type', 'compute', '--generations', '1e3'],
    });
  });

  it('E-102: rejects 1e10 for --population (OOM-vector)', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '10', '--population', '1e10'))).toEqual({
      type: 'unknown',
      raw: ['evolve', '--type', 'compute', '--generations', '10', '--population', '1e10'],
    });
  });

  it('E-103: rejects 2e5 for --seed', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '10', '--population', '32', '--seed', '2e5'))).toEqual({
      type: 'unknown',
      raw: ['evolve', '--type', 'compute', '--generations', '10', '--population', '32', '--seed', '2e5'],
    });
  });

  it('E-104: rejects hex notation 0x10 for --generations', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '0x10'))).toEqual({
      type: 'unknown',
      raw: ['evolve', '--type', 'compute', '--generations', '0x10'],
    });
  });

  it('E-105: rejects binary notation 0b10 for --generations', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '0b10'))).toEqual({
      type: 'unknown',
      raw: ['evolve', '--type', 'compute', '--generations', '0b10'],
    });
  });

  it('E-106: rejects positive-sign prefix +5 for --generations', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '+5'))).toEqual({
      type: 'unknown',
      raw: ['evolve', '--type', 'compute', '--generations', '+5'],
    });
  });

  it('E-107: rejects whitespace-padded " 5 " for --generations', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute', '--generations', ' 5 '))).toEqual({
      type: 'unknown',
      raw: ['evolve', '--type', 'compute', '--generations', ' 5 '],
    });
  });

  it('E-108: rejects fractional 1.5 for --generations (regression against PKT-380)', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '1.5'))).toEqual({
      type: 'unknown',
      raw: ['evolve', '--type', 'compute', '--generations', '1.5'],
    });
  });

  it('E-109: rejects negative -1 for --generations', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '-1'))).toEqual({
      type: 'unknown',
      raw: ['evolve', '--type', 'compute', '--generations', '-1'],
    });
  });

  it('E-110: rejects zero 0 for --generations (below >= 1 threshold)', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '0'))).toEqual({
      type: 'unknown',
      raw: ['evolve', '--type', 'compute', '--generations', '0'],
    });
  });
});

// ── 6. evolve — D2 empty --inputs bypass (PKT-492) ───────────────────────────

describe('parseCliArgs — evolve D2: empty inputs rejected', () => {
  it('E-201: empty string --inputs results in inputs=undefined', () => {
    const result = parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '10', '--population', '32', '--inputs', ''));
    expect(result).toEqual({
      type: 'evolve',
      args: { martianType: 'compute', generations: 10, population: 32 },
    });
  });

  it('E-202: whitespace-only --inputs results in inputs=undefined', () => {
    const result = parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '10', '--population', '32', '--inputs', '   '));
    expect(result).toEqual({
      type: 'evolve',
      args: { martianType: 'compute', generations: 10, population: 32 },
    });
  });

  it('E-203: non-empty --inputs string is preserved verbatim', () => {
    const result = parseCliArgs(cli('evolve', '--type', 'compute', '--generations', '10', '--population', '32', '--inputs', '{"key":"val"}'));
    expect(result).toEqual({
      type: 'evolve',
      args: { martianType: 'compute', generations: 10, population: 32, inputs: '{"key":"val"}' },
    });
  });
});

// ── 7. submit subcommand — happy path + D3 name validation (PKT-492) ─────────

describe('parseCliArgs — submit subcommand', () => {
  it('S-001: returns submit for minimal valid invocation', () => {
    expect(parseCliArgs(cli('submit', '--type', 'compute'))).toEqual({
      type: 'submit',
      args: { martianType: 'compute', yes: false, force: false },
    });
  });

  it('S-002: parses valid 8-uppercase-letter --name', () => {
    expect(parseCliArgs(cli('submit', '--type', 'compute', '--name', 'ABCDEFGH'))).toEqual({
      type: 'submit',
      args: { martianType: 'compute', name: 'ABCDEFGH', yes: false, force: false },
    });
  });

  it('S-003: parses --yes flag', () => {
    expect(parseCliArgs(cli('submit', '--type', 'compute', '--yes'))).toEqual({
      type: 'submit',
      args: { martianType: 'compute', yes: true, force: false },
    });
  });

  it('S-004: parses --force flag', () => {
    expect(parseCliArgs(cli('submit', '--type', 'compute', '--force'))).toEqual({
      type: 'submit',
      args: { martianType: 'compute', yes: false, force: true },
    });
  });

  it('S-101: rejects --name with lowercase (D3 — early validation)', () => {
    expect(parseCliArgs(cli('submit', '--type', 'compute', '--name', 'abcdefgh'))).toEqual({
      type: 'unknown',
      raw: ['submit', '--type', 'compute', '--name', 'abcdefgh'],
    });
  });

  it('S-102: rejects --name with whitespace (D3)', () => {
    expect(parseCliArgs(cli('submit', '--type', 'compute', '--name', 'ABCD EFGH'))).toEqual({
      type: 'unknown',
      raw: ['submit', '--type', 'compute', '--name', 'ABCD EFGH'],
    });
  });

  it('S-103: rejects --name with digits (D3)', () => {
    expect(parseCliArgs(cli('submit', '--type', 'compute', '--name', 'ABCD1234'))).toEqual({
      type: 'unknown',
      raw: ['submit', '--type', 'compute', '--name', 'ABCD1234'],
    });
  });

  it('S-104: rejects --name shorter than 8 chars (D3)', () => {
    expect(parseCliArgs(cli('submit', '--type', 'compute', '--name', 'ABCDE'))).toEqual({
      type: 'unknown',
      raw: ['submit', '--type', 'compute', '--name', 'ABCDE'],
    });
  });

  it('S-105: rejects --name longer than 8 chars (D3)', () => {
    expect(parseCliArgs(cli('submit', '--type', 'compute', '--name', 'ABCDEFGHI'))).toEqual({
      type: 'unknown',
      raw: ['submit', '--type', 'compute', '--name', 'ABCDEFGHI'],
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
