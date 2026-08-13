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
import { parseCliArgs, isValidMartianType, MARTIAN_TYPE_RE } from '../src/alienclaw/cli/args.js';

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

// ── 5. isValidMartianType / MARTIAN_TYPE_RE (PKT-506) ────────────────────────

describe('isValidMartianType', () => {
  it.each([
    // valid — all seed martian types match ^[a-z][a-z0-9_]{0,31}$
    ['compute_alone',             true],
    ['search_web_then_summarize', true],
    ['hermes_outbox_send',        true],
    ['hermes_echo_brief',         true],
    ['a',                         true],   // single char — minimum valid
    // invalid — path traversal attempts
    ['../../../tmp/evil',         false],
    ['../etc/passwd',             false],
    ['../',                       false],
    ['../foo',                    false],
    // invalid — disallowed characters
    ['compute-alone',             false],   // hyphen not in [a-z0-9_]
    ['compute alone',             false],   // space not allowed
    ['Compute_Alone',             false],   // uppercase not allowed
    ['COMPUTE_ALONE',             false],   // uppercase not allowed
    ['compute/alone',             false],   // slash not allowed
    ['compute.alone',             false],   // dot not allowed
    // invalid — length / empty
    ['',                          false],   // empty string rejected
    ['a'.repeat(33),              false],   // 33 chars > 32-char max
  ])('isValidMartianType(%j) === %j', (input, expected) => {
    expect(isValidMartianType(input)).toBe(expected);
  });

  it('MARTIAN_TYPE_RE matches same set as isValidMartianType for representative inputs', () => {
    expect(MARTIAN_TYPE_RE.test('compute_alone')).toBe(true);
    expect(MARTIAN_TYPE_RE.test('../etc/passwd')).toBe(false);
    expect(MARTIAN_TYPE_RE.test('')).toBe(false);
  });
});

// ── 6. parseCliArgs path-traversal guard (PKT-506) ───────────────────────────

describe('parseCliArgs — evolve rejects path-traversal --type', () => {
  it('R-014: returns unknown when --type is a path-traversal string (evolve)', () => {
    const r = parseCliArgs(cli('evolve', '--type', '../../../tmp/evil', '--generations', '5', '--population', '8'));
    expect(r.type).toBe('unknown');
  });

  it('R-015: returns unknown when --type contains a slash (evolve)', () => {
    const r = parseCliArgs(cli('evolve', '--type', 'compute/evil', '--generations', '5', '--population', '8'));
    expect(r.type).toBe('unknown');
  });

  it('R-016: returns unknown when --type contains uppercase (evolve)', () => {
    const r = parseCliArgs(cli('evolve', '--type', 'ComputeAlone', '--generations', '5', '--population', '8'));
    expect(r.type).toBe('unknown');
  });

  it('R-017: still accepts valid martian type (evolve — regression guard)', () => {
    const r = parseCliArgs(cli('evolve', '--type', 'compute_alone', '--generations', '5', '--population', '8'));
    expect(r).toEqual({ type: 'evolve', args: { martianType: 'compute_alone', generations: 5, population: 8, seed: undefined, inputs: undefined } });
  });
});

describe('parseCliArgs — submit rejects path-traversal --type', () => {
  it('R-018: returns unknown when --type is a path-traversal string (submit)', () => {
    const r = parseCliArgs(cli('submit', '--type', '../../../tmp/evil', '--yes'));
    expect(r.type).toBe('unknown');
  });

  it('R-019: returns unknown when --type contains a dot (submit)', () => {
    const r = parseCliArgs(cli('submit', '--type', 'compute.evil', '--yes'));
    expect(r.type).toBe('unknown');
  });

  it('R-020: still accepts valid martian type (submit — regression guard)', () => {
    const r = parseCliArgs(cli('submit', '--type', 'hermes_echo', '--yes'));
    expect(r).toEqual({ type: 'submit', args: { martianType: 'hermes_echo', yes: true, force: false, name: undefined } });
  });
});

// ── 7. parseCliArgs — non-integer flag values (PKT-629) ──────────────────────

describe('parseCliArgs — non-integer flag values (PKT-629)', () => {
  it('R-101: --generations 1.5 returns unknown (non-integer rejected at TS boundary)', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute_alone', '--generations', '1.5')).type).toBe('unknown');
  });

  it('R-102: --seed 3.14 returns unknown (non-integer rejected at TS boundary)', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute_alone', '--seed', '3.14')).type).toBe('unknown');
  });

  it('R-103: --population 32.0 returns evolve with population=32 (JS Number collapse, benign parity)', () => {
    const r = parseCliArgs(cli('evolve', '--type', 'compute_alone', '--population', '32.0'));
    expect(r.type).toBe('evolve');
    if (r.type === 'evolve') expect(r.args.population).toBe(32);
  });

  it('R-104: --generations NaN returns unknown (NaN rejected by isInteger)', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute_alone', '--generations', 'NaN')).type).toBe('unknown');
  });

  it('R-105: --generations Infinity returns unknown (Infinity rejected by isInteger)', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute_alone', '--generations', 'Infinity')).type).toBe('unknown');
  });

  it('R-106: --generations 1e100 returns evolve (documented decision: isInteger passes; Python argparse is second defense)', () => {
    const r = parseCliArgs(cli('evolve', '--type', 'compute_alone', '--generations', '1e100'));
    expect(r.type).toBe('evolve');
    if (r.type === 'evolve') expect(r.args.generations).toBe(1e100);
  });

  it('R-107: --seed -5 returns unknown (negative seed rejected)', () => {
    expect(parseCliArgs(cli('evolve', '--type', 'compute_alone', '--seed', '-5')).type).toBe('unknown');
  });
});
