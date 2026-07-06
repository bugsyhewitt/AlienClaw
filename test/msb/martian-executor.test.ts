/**
 * martian-executor.test.ts
 *
 * Unit tests for executeMartian() — the MSB execution entry point that enforces
 * the project's hardest runtime invariants. Previously ZERO TypeScript coverage.
 *
 * Covered invariants (src/alienclaw/msb/martian-executor.ts):
 *   - Hard invariant: no nested Martian — ctx.depth > 0 throws (L148-152)
 *   - Empty tools list -> outcome FAILURE, never executes (L162-169)
 *   - Tool success path: single result returned bare, multiple as array (L201-206)
 *   - Retry exhaustion: lastError from the final failed attempt surfaces (L114-127)
 *   - Escalation policy from genome section 2 (BEHAVIOR char 0):
 *       failForward true  -> outcome ESCALATED
 *       failForward false -> outcome FAILURE
 *   - Retry config parsed from genome section 1 (EXECUTION chars 0-1):
 *       maxAttempts honored (adapter invoked exactly that many times)
 *
 * These paths are driven deterministically by registering fake ToolFns via
 * registerToolAdapter() and by writing minimal-but-valid .msb conditioning
 * files into a temp directory that is passed explicitly as the msbDir argument
 * (so the test never touches ALIENCLAW_HOME or any real registry).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import {
  executeMartian,
  registerToolAdapter,
  getToolAdapter,
  type ToolFn,
} from '../../src/alienclaw/msb/martian-executor.js';
import { clearMsbCache } from '../../src/alienclaw/msb/msb-loader.js';
import { assembleGenome } from '../../src/alienclaw/registry/genome-codec.js';
import type {
  MartianSpec,
  MartianExecutionInput,
} from '../../src/alienclaw/registry/ms-types.js';

// ---------------------------------------------------------------------------
// Genome construction helpers
//
// A genome is 4 x 64 chars. assembleGenome() takes the 3 mutable sections and
// appends the FNV-1a checksum, guaranteeing exactly 256 valid Base62 chars so
// parseGenome() inside executeMartian() never rejects our fixtures.
//
// parseExecutionSection() reads section 1:
//   maxAttempts = clamp(1..5, (charCodeAt(0) - 48) % 5 + 1)
//   backoffMs   = max(100, ((charCodeAt(1) - 48) % 10) * 500)
// parseBehaviorSection() reads section 2:
//   failForward = section[0] === 'F'
//
// Verified char mappings (Base62 alphabet):
//   exec char0 '0' -> maxAttempts 1 ; '1' -> 2 ; '2' -> 3
//   exec char1 '0' -> backoffMs 100  (kept minimal so retry sleeps are fast)
//   behavior  'F'  -> failForward true ; 'E' -> false
// ---------------------------------------------------------------------------

const PAD = '0'.repeat(64);

/** A neutral 64-char identity section (content is irrelevant to execution). */
const IDENTITY = ('ID' + PAD).slice(0, 64);

/**
 * Build an EXECUTION section (genome section 1) whose first two chars encode
 * the desired retry config. Remaining chars are padded with Base62 zeros.
 */
function execSection(maxAttemptsChar: string, backoffChar = '0'): string {
  return (maxAttemptsChar + backoffChar + PAD).slice(0, 64);
}

/** Build a BEHAVIOR section (genome section 2): 'F' => failForward, else not. */
function behaviorSection(failForward: boolean): string {
  return ((failForward ? 'F' : 'E') + PAD).slice(0, 64);
}

/**
 * Assemble a full, checksum-valid genome from retry + escalation intent.
 * maxAttemptsChar: '0' -> 1 attempt, '1' -> 2, '2' -> 3.
 */
function makeGenome(opts: {
  maxAttemptsChar?: string;
  backoffChar?: string;
  failForward?: boolean;
}): string {
  const exec = execSection(opts.maxAttemptsChar ?? '0', opts.backoffChar ?? '0');
  const beh = behaviorSection(opts.failForward ?? false);
  return assembleGenome(IDENTITY, exec, beh);
}

// ---------------------------------------------------------------------------
// MartianSpec + .msb fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal MartianSpec. Only the fields executeMartian() reads matter:
 * genome (for retry/escalation), tools, msbRefs, id (for the empty-tools msg).
 */
function makeMartian(overrides: Partial<MartianSpec> = {}): MartianSpec {
  return {
    id: 'MS_TEST00001',
    description: 'unit-test martian',
    generation: 1,
    status: 'active',
    fitness: 0.5,
    tools: [],
    msbRefs: [],
    toolTags: [],
    genome: makeGenome({}),
    graveyard: [],
    ...overrides,
  };
}

function makeInput(
  martian: MartianSpec,
  task = 'do the thing',
  context: Record<string, unknown> = {},
): MartianExecutionInput {
  return { martian, task, context };
}

/**
 * A minimal but schema-valid .msb conditioning file. It satisfies every
 * REQUIRED_SECTIONS entry the loader enforces (TOOL..VARIABLES) and parses
 * cleanly. Content is documentation-only — it carries no control logic, per
 * the MSB hard invariant.
 */
function minimalMsb(tool: string): string {
  return `TOOL: ${tool}
VERSION: 1.0

CAPABILITIES:
Deterministic test tool used to drive executeMartian() paths.

LIMITATIONS:
Exists only inside the unit-test temp registry.

FAILURE MODES:
Throws when the registered fake adapter is configured to fail.

BEST PRACTICES:
Register a deterministic ToolFn before invoking.

EXECUTION ORDER:
1. Validate input
2. Return canned output

OUTPUT CONTRACT:
{ "result": "any" }

GENOME SECTIONS:
IDENTITY: Test identity bits.
EXECUTION: Char 0 = maxAttempts encoding. Char 1 = backoff encoding.
BEHAVIOR: Char 0 = escalation mode ('F' = failForward).
CHECKSUM: FNV-1a checksum of sections 0-2.

VARIABLES:
task: The task string passed to this Martian.
context: Extra key-value pairs from the execution context.
`;
}

// ---------------------------------------------------------------------------
// Test harness — temp msb dir + adapter-registry isolation
// ---------------------------------------------------------------------------

describe('executeMartian()', () => {
  let msbDir: string;
  // Tool names registered during a test, so afterEach can deregister them and
  // keep the module-level _toolAdapters map clean between cases.
  let registered: string[];

  /** Register a fake adapter and remember it for teardown. */
  function register(tool: string, fn: ToolFn): void {
    registerToolAdapter(tool, fn);
    registered.push(tool);
  }

  /** Write a minimal valid .msb for `tool` into the temp registry dir. */
  function writeMsb(tool: string): void {
    writeFileSync(path.join(msbDir, `${tool}.msb`), minimalMsb(tool), 'utf-8');
  }

  beforeEach(() => {
    msbDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-msb-exec-'));
    registered = [];
    clearMsbCache();
  });

  afterEach(() => {
    // Deregister fake adapters by overwriting with a thrower would leak; instead
    // delete from the registry via re-registering a removal sentinel is not
    // supported, so we clear the underlying map indirectly: the public surface
    // only exposes register/get. We rely on unique tool names per test plus a
    // best-effort overwrite to a noop to avoid cross-test bleed.
    for (const tool of registered) {
      // Overwrite with a noop so a stale name can't accidentally satisfy a
      // later test that forgot to register. Unique names already prevent this,
      // but this is belt-and-suspenders.
      registerToolAdapter(tool, async () => undefined);
    }
    clearMsbCache();
    rmSync(msbDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. Hard invariant: no nested Martian (depth > 0 throws)
  // -------------------------------------------------------------------------

  describe('hard invariant: no nested Martian', () => {
    it('throws when ctx.depth > 0', async () => {
      const martian = makeMartian({
        tools: ['noop_a'],
        msbRefs: ['noop_a.msb'],
      });
      writeMsb('noop_a');
      register('noop_a', async () => ({ ok: true }));

      await expect(
        executeMartian(makeInput(martian), msbDir, { depth: 1 }),
      ).rejects.toThrow(/Martian cannot spawn other Martian/);
    });

    it('reports the offending depth in the error message', async () => {
      const martian = makeMartian({ tools: ['noop_b'], msbRefs: ['noop_b.msb'] });
      await expect(
        executeMartian(makeInput(martian), msbDir, { depth: 3 }),
      ).rejects.toThrow(/depth=3/);
    });

    it('throws before any tool adapter is invoked', async () => {
      let invoked = false;
      const martian = makeMartian({ tools: ['noop_c'], msbRefs: ['noop_c.msb'] });
      writeMsb('noop_c');
      register('noop_c', async () => {
        invoked = true;
        return { ok: true };
      });

      await expect(
        executeMartian(makeInput(martian), msbDir, { depth: 2 }),
      ).rejects.toThrow();
      expect(invoked).toBe(false);
    });

    it('proceeds normally at the default depth of 0', async () => {
      const martian = makeMartian({ tools: ['noop_d'], msbRefs: ['noop_d.msb'] });
      writeMsb('noop_d');
      register('noop_d', async () => ({ ok: true }));

      // No explicit ctx -> defaults to { depth: 0 } -> must not throw.
      const result = await executeMartian(makeInput(martian), msbDir);
      expect(result.outcome).toBe('SUCCESS');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Empty tools -> FAILURE
  // -------------------------------------------------------------------------

  describe('empty tools list', () => {
    it('returns FAILURE with a descriptive error and never escalates', async () => {
      const martian = makeMartian({ tools: [], msbRefs: [] });

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(result.outcome).toBe('FAILURE');
      expect(result.output).toBeNull();
      expect(result.failForward).toBe(false);
      expect(result.error).toContain('MS_TEST00001');
      expect(result.error).toMatch(/no tools declared/);
    });

    it('returns FAILURE even when the genome requests fail-forward', async () => {
      // Empty-tools rejection is unconditional and precedes escalation policy.
      const martian = makeMartian({
        tools: [],
        msbRefs: [],
        genome: makeGenome({ failForward: true }),
      });

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(result.outcome).toBe('FAILURE');
      expect(result.failForward).toBe(false);
    });

    it('uses DEFAULT_MSB_DIR when msbDir is omitted', async () => {
      const martian = makeMartian({ tools: [], msbRefs: [] });
      // Omit msbDir so L155 resolves to DEFAULT_MSB_DIR (arm 1).
      // Empty-tools guard at L162 fires before any file-system access.
      const result = await executeMartian(makeInput(martian));
      expect(result.outcome).toBe('FAILURE');
      expect(result.error).toMatch(/no tools declared/);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Tool success path — single vs array output (L204)
  // -------------------------------------------------------------------------

  describe('successful execution output shaping', () => {
    it('returns a single tool result bare (not wrapped in an array)', async () => {
      const martian = makeMartian({ tools: ['solo'], msbRefs: ['solo.msb'] });
      writeMsb('solo');
      const payload = { value: 42, label: 'answer' };
      register('solo', async () => payload);

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(result.outcome).toBe('SUCCESS');
      expect(result.failForward).toBe(false);
      expect(result.error).toBeUndefined();
      // Exactly one tool -> output is the value itself, not [value].
      expect(result.output).toEqual(payload);
      expect(Array.isArray(result.output)).toBe(false);
    });

    it('returns an array of results when multiple tools run', async () => {
      const martian = makeMartian({
        tools: ['first', 'second'],
        msbRefs: ['first.msb', 'second.msb'],
      });
      writeMsb('first');
      writeMsb('second');
      register('first', async () => 'r1');
      register('second', async () => 'r2');

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(result.outcome).toBe('SUCCESS');
      expect(Array.isArray(result.output)).toBe(true);
      expect(result.output).toEqual(['r1', 'r2']);
    });

    it('forwards task and context into the tool input', async () => {
      const martian = makeMartian({ tools: ['echo'], msbRefs: ['echo.msb'] });
      writeMsb('echo');
      let seen: Record<string, unknown> | undefined;
      register('echo', async (input) => {
        seen = input;
        return 'ok';
      });

      await executeMartian(
        makeInput(martian, 'analyze target', { region: 'us-east', retries: 2 }),
        msbDir,
      );

      expect(seen).toBeDefined();
      expect(seen!['task']).toBe('analyze target');
      expect(seen!['region']).toBe('us-east');
      expect(seen!['retries']).toBe(2);
    });

    it('preserves a falsy (0) tool output instead of coercing it', async () => {
      // results.length === 1 ? results[0] : results — 0 must survive as 0.
      const martian = makeMartian({ tools: ['zero'], msbRefs: ['zero.msb'] });
      writeMsb('zero');
      register('zero', async () => 0);

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(result.outcome).toBe('SUCCESS');
      expect(result.output).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Retry exhaustion -> lastError surfaced
  // -------------------------------------------------------------------------

  describe('retry behavior', () => {
    it('retries up to maxAttempts then surfaces the final error', async () => {
      // Genome encodes maxAttempts = 3 (exec char0 '2'), backoff 100ms.
      const martian = makeMartian({
        tools: ['flaky'],
        msbRefs: ['flaky.msb'],
        genome: makeGenome({ maxAttemptsChar: '2', failForward: false }),
      });
      writeMsb('flaky');

      let attempts = 0;
      register('flaky', async () => {
        attempts += 1;
        throw new Error(`boom #${attempts}`);
      });

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(attempts).toBe(3); // exhausted all configured attempts
      expect(result.outcome).toBe('FAILURE');
      expect(result.output).toBeNull();
      // lastError is from the final attempt.
      expect(result.error).toBe('boom #3');
    });

    it('succeeds on a later attempt without exhausting retries', async () => {
      // maxAttempts = 3; fail twice, succeed on the third.
      const martian = makeMartian({
        tools: ['recovers'],
        msbRefs: ['recovers.msb'],
        genome: makeGenome({ maxAttemptsChar: '2' }),
      });
      writeMsb('recovers');

      let attempts = 0;
      register('recovers', async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('transient');
        return { recovered: true, onAttempt: attempts };
      });

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(attempts).toBe(3);
      expect(result.outcome).toBe('SUCCESS');
      expect(result.output).toEqual({ recovered: true, onAttempt: 3 });
    });

    it('invokes the tool exactly once when maxAttempts resolves to 1', async () => {
      // exec char0 '0' -> maxAttempts 1: a single throw fails immediately.
      const martian = makeMartian({
        tools: ['once'],
        msbRefs: ['once.msb'],
        genome: makeGenome({ maxAttemptsChar: '0', failForward: false }),
      });
      writeMsb('once');

      let attempts = 0;
      register('once', async () => {
        attempts += 1;
        throw new Error('single-shot failure');
      });

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(attempts).toBe(1);
      expect(result.outcome).toBe('FAILURE');
      expect(result.error).toBe('single-shot failure');
    });

    it('surfaces a clear error when no adapter is registered for a tool', async () => {
      // No register() call for this tool name -> invokeToolWithRetry reports it.
      const martian = makeMartian({
        tools: ['unregistered_tool'],
        msbRefs: ['unregistered_tool.msb'],
      });
      writeMsb('unregistered_tool');

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(result.outcome).toBe('FAILURE');
      expect(result.error).toContain('unregistered_tool');
      expect(result.error).toMatch(/No tool adapter registered/);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Escalation policy: failForward true -> ESCALATED, false -> FAILURE
  // -------------------------------------------------------------------------

  describe('escalation policy from genome section 2', () => {
    it('escalates (ESCALATED) on failure when failForward is true', async () => {
      const martian = makeMartian({
        tools: ['fails'],
        msbRefs: ['fails.msb'],
        genome: makeGenome({ maxAttemptsChar: '0', failForward: true }),
      });
      writeMsb('fails');
      register('fails', async () => {
        throw new Error('downstream blew up');
      });

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(result.outcome).toBe('ESCALATED');
      expect(result.failForward).toBe(true);
      expect(result.output).toBeNull();
      expect(result.error).toBe('downstream blew up');
    });

    it('returns FAILURE on failure when failForward is false', async () => {
      const martian = makeMartian({
        tools: ['fails2'],
        msbRefs: ['fails2.msb'],
        genome: makeGenome({ maxAttemptsChar: '0', failForward: false }),
      });
      writeMsb('fails2');
      register('fails2', async () => {
        throw new Error('hard stop');
      });

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(result.outcome).toBe('FAILURE');
      expect(result.failForward).toBe(false);
      expect(result.error).toBe('hard stop');
    });

    it('escalation policy is irrelevant on success (always SUCCESS / failForward false)', async () => {
      const martian = makeMartian({
        tools: ['wins'],
        msbRefs: ['wins.msb'],
        genome: makeGenome({ failForward: true }),
      });
      writeMsb('wins');
      register('wins', async () => 'great');

      const result = await executeMartian(makeInput(martian), msbDir);

      // Success path hardcodes failForward:false regardless of genome policy.
      expect(result.outcome).toBe('SUCCESS');
      expect(result.failForward).toBe(false);
      expect(result.output).toBe('great');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Missing .msb conditioning file -> FAILURE (loadMsbCached throws)
  // -------------------------------------------------------------------------

  describe('missing MSB conditioning file', () => {
    it('returns FAILURE (or ESCALATED) when the .msb cannot be loaded', async () => {
      // Tool adapter registered, but no .msb written -> loadMsbCached throws,
      // the loop breaks, allSucceeded=false, and the escalation policy applies.
      const martian = makeMartian({
        tools: ['has_adapter_no_brain'],
        msbRefs: ['has_adapter_no_brain.msb'],
        genome: makeGenome({ failForward: false }),
      });
      register('has_adapter_no_brain', async () => 'never reached');

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(result.outcome).toBe('FAILURE');
      expect(result.output).toBeNull();
      expect(result.error).toBeTruthy();
    });

    it('defaults the msb filename from the tool name when msbRefs is short', async () => {
      // msbRefs intentionally empty -> code falls back to `${toolName}.msb`.
      const martian = makeMartian({
        tools: ['fallback_named'],
        msbRefs: [],
      });
      writeMsb('fallback_named'); // matches the derived default name
      register('fallback_named', async () => 'derived-ok');

      const result = await executeMartian(makeInput(martian), msbDir);

      expect(result.outcome).toBe('SUCCESS');
      expect(result.output).toBe('derived-ok');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Adapter registry surface sanity (register/get round-trip)
  // -------------------------------------------------------------------------

  describe('tool adapter registry', () => {
    it('register then get returns the same function', () => {
      const fn: ToolFn = async () => 'x';
      register('roundtrip_tool', fn);
      expect(getToolAdapter('roundtrip_tool')).toBe(fn);
    });

    it('get returns undefined for an unknown tool', () => {
      expect(getToolAdapter('definitely_not_registered_xyz')).toBeUndefined();
    });
  });
});
