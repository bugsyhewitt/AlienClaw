/**
 * martian-executor.test.ts
 *
 * Regression coverage for the MAX_MS_TOOLS (4) tool cap.
 *
 * ms-loader.ts enforces the cap at *load* time, but executeMartian() is reached
 * by specs that may be constructed in-memory or mutated after load — bypassing
 * that check. These tests assert executeMartian() re-enforces the cap itself:
 *   - a 5-tool spec is rejected (FAILURE) BEFORE any tool runs
 *   - the exactly-4-tool boundary still executes (cap is `>`, not `>=`)
 *   - common 1-tool / multi-tool paths are unchanged
 *
 * Tool brains are loaded from the repo's real seed/msb/ directory; tool
 * execution is mocked via registerToolAdapter so no external work happens.
 * Fully headless: no GUI, no server, no app launch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  executeMartian,
  registerToolAdapter,
  type ToolFn,
} from '../../src/alienclaw/msb/martian-executor.js';
import { clearMsbCache } from '../../src/alienclaw/msb/msb-loader.js';
import { assembleGenome } from '../../src/alienclaw/registry/genome-codec.js';
import { MAX_MS_TOOLS } from '../../src/alienclaw/constants.js';
import type { MartianSpec, MartianExecutionInput } from '../../src/alienclaw/registry/ms-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '../..');
const SEED_MSB   = resolve(REPO_ROOT, 'seed/msb');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a valid 256-char genome whose EXECUTION section decodes to a single
 * retry attempt with the minimum backoff, keeping success-path tests fast.
 * Section chars '1','0' → maxAttempts=2, backoffMs=100 (per parseExecutionSection).
 * BEHAVIOR char 'E' → failForward=false.
 */
function validGenome(): string {
  const identity  = 'I'.repeat(64);
  const execution = '10' + '0'.repeat(62);
  const behavior  = 'E' + '0'.repeat(63);
  return assembleGenome(identity, execution, behavior);
}

/** Real tool names that have a corresponding .msb in seed/msb/. */
const SEED_TOOLS = [
  'compute',
  'file_read',
  'search_text',
  'extract_json',
  'http_get',
  'web_search',
] as const;

/** Construct a MartianSpec with `n` real seed tools (n must be <= SEED_TOOLS.length). */
function specWithTools(n: number, id = 'MS_TEST00001'): MartianSpec {
  const tools   = SEED_TOOLS.slice(0, n);
  const msbRefs = tools.map(t => `${t}.msb`);
  return {
    id,
    description: `test martian with ${n} tools`,
    generation:  1,
    status:      'active',
    fitness:     0.5,
    tools:       [...tools],
    msbRefs,
    toolTags:    [...tools],
    genome:      validGenome(),
    graveyard:   [],
  };
}

function execInput(spec: MartianSpec): MartianExecutionInput {
  return { martian: spec, task: 'do the thing', context: {} };
}

// ---------------------------------------------------------------------------
// Adapter registry tracking — record which tools were invoked.
// ---------------------------------------------------------------------------

let invoked: string[];

/** Register an echo adapter for every seed tool; record invocations. */
function registerEchoAdapters(): void {
  for (const tool of SEED_TOOLS) {
    const fn: ToolFn = async () => {
      invoked.push(tool);
      return { result: `ran-${tool}` };
    };
    registerToolAdapter(tool, fn);
  }
}

beforeEach(() => {
  invoked = [];
  clearMsbCache();
  registerEchoAdapters();
});

afterEach(() => {
  clearMsbCache();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeMartian — MAX_MS_TOOLS cap enforcement', () => {
  it('the cap constant is 4', () => {
    expect(MAX_MS_TOOLS).toBe(4);
  });

  it('rejects a 5-tool spec with FAILURE before running any tool', async () => {
    const spec = specWithTools(5, 'MS_OVER00005');
    expect(spec.tools.length).toBe(5);

    const result = await executeMartian(execInput(spec), SEED_MSB);

    expect(result.outcome).toBe('FAILURE');
    expect(result.output).toBeNull();
    expect(result.failForward).toBe(false);
    // Error names the cap and the offending count.
    expect(result.error).toContain('MAX_MS_TOOLS');
    expect(result.error).toContain('5');
    expect(result.error).toContain('MS_OVER00005');
    // Critically: the guard short-circuits — no tool adapter was called.
    expect(invoked).toEqual([]);
  });

  it('rejects a 5-tool spec even when its genome is malformed (guard precedes parseGenome)', async () => {
    const spec = specWithTools(5, 'MS_OVERBAD05');
    spec.genome = 'not-a-valid-genome';

    const result = await executeMartian(execInput(spec), SEED_MSB);

    // Cap is checked before genome parsing, so we get the cap FAILURE,
    // not a genome parse throw.
    expect(result.outcome).toBe('FAILURE');
    expect(result.error).toContain('MAX_MS_TOOLS');
    expect(invoked).toEqual([]);
  });

  it('rejects a 6-tool spec with FAILURE', async () => {
    const spec = specWithTools(6, 'MS_OVER00006');
    const result = await executeMartian(execInput(spec), SEED_MSB);

    expect(result.outcome).toBe('FAILURE');
    expect(result.error).toContain('MAX_MS_TOOLS');
    expect(invoked).toEqual([]);
  });

  it('accepts the exactly-4-tool boundary and runs every tool (SUCCESS)', async () => {
    const spec = specWithTools(MAX_MS_TOOLS, 'MS_MAX000004');
    expect(spec.tools.length).toBe(4);

    const result = await executeMartian(execInput(spec), SEED_MSB);

    expect(result.outcome).toBe('SUCCESS');
    expect(invoked).toEqual(['compute', 'file_read', 'search_text', 'extract_json']);
    expect(Array.isArray(result.output)).toBe(true);
    expect((result.output as unknown[]).length).toBe(4);
  });

  it('accepts a 1-tool spec (common path unchanged)', async () => {
    const spec = specWithTools(1, 'MS_ONE000001');
    const result = await executeMartian(execInput(spec), SEED_MSB);

    expect(result.outcome).toBe('SUCCESS');
    expect(invoked).toEqual(['compute']);
    // Single tool → output is the lone result, not an array.
    expect(result.output).toEqual({ result: 'ran-compute' });
  });

  it('accepts a 2-tool and a 3-tool spec (mid-range paths unchanged)', async () => {
    const two = await executeMartian(execInput(specWithTools(2, 'MS_TWO000002')), SEED_MSB);
    expect(two.outcome).toBe('SUCCESS');
    expect(invoked).toEqual(['compute', 'file_read']);

    invoked = [];
    const three = await executeMartian(execInput(specWithTools(3, 'MS_THREE0003')), SEED_MSB);
    expect(three.outcome).toBe('SUCCESS');
    expect(invoked).toEqual(['compute', 'file_read', 'search_text']);
  });

  it('still rejects an empty-tool spec via the existing zero-tools guard', async () => {
    const spec = specWithTools(0, 'MS_ZERO00000');
    const result = await executeMartian(execInput(spec), SEED_MSB);

    expect(result.outcome).toBe('FAILURE');
    expect(result.error).toContain('no tools declared');
    expect(invoked).toEqual([]);
  });
});
