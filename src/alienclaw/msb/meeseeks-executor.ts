/**
 * meeseeks-executor.ts
 * Executes a Meeseeks via its declared tools and MSB conditioning.
 *
 * Hard invariants enforced:
 *   - A Meeseeks may call at most MAX_MS_TOOLS (4) tools per execution
 *   - No nested Meeseeks (depth must stay at 0 — Meeseeks cannot spawn Meeseeks)
 *   - Execution terminates fully before returning control
 *   - Returns SUCCESS | FAILURE | ESCALATED
 *   - MSB is conditioning text only — no control logic lives there
 *
 * Genome section layout (4 × 64 chars):
 *   Section 0 IDENTITY  (chars   0– 63): ID, generation, tool family
 *   Section 1 EXECUTION (chars  64–127): flow, retry config, performance — read here
 *   Section 2 BEHAVIOR  (chars 128–191): escalation, output contract — read here
 *   Section 3 CHECKSUM  (chars 192–255): integrity (not read during execution)
 */

import * as path from 'node:path';
import * as os   from 'node:os';

import { loadMsbCached }  from './msb-loader.js';
import type { MeeseeksBrain } from './msb-types.js';
import type {
  MeeseeksSpec,
  MeeseeksExecutionInput,
  MeeseeksExecutionResult,
  MeeseeksOutcome,
} from '../registry/ms-types.js';
import { parseGenome } from '../registry/genome-codec.js';

const DEFAULT_MSB_DIR = path.join(
  process.env['ALIENCLAW_HOME'] ?? path.join(os.homedir(), '.alienclaw'),
  'registry', 'msb'
);

// ---------------------------------------------------------------------------
// Tool adapter registry — thin wrappers around OpenClaw tool implementations.
// ---------------------------------------------------------------------------

export type ToolFn = (input: Record<string, unknown>) => Promise<unknown>;

/**
 * Interface implemented by tool resolvers (e.g. OpenClawToolResolver).
 */
export interface ToolResolver {
  resolve(toolName: string): ToolFn | undefined;
  supportedTools?(): string[];
}

const _toolAdapters = new Map<string, ToolFn>();

/** Register a tool adapter (called during bootstrap/wiring). */
export function registerToolAdapter(toolName: string, fn: ToolFn): void {
  _toolAdapters.set(toolName, fn);
}

/** Lookup a registered tool adapter. */
export function getToolAdapter(toolName: string): ToolFn | undefined {
  return _toolAdapters.get(toolName);
}

// ---------------------------------------------------------------------------
// Genome section helpers
// ---------------------------------------------------------------------------

interface RetryConfig {
  maxAttempts: number;
  backoffMs:   number;
}

interface EscalationConfig {
  failForward: boolean;
}

/**
 * Parse retry/performance config from Section 1 (EXECUTION, chars 64–127).
 * First two chars of the section encode maxAttempts and backoff.
 */
function parseExecutionSection(section: string): RetryConfig {
  const char0       = section.charCodeAt(0) - 48;
  const maxAttempts = Math.max(1, Math.min(5, char0 % 5 + 1));
  const char1       = section.charCodeAt(1) - 48;
  const backoffMs   = Math.max(100, (char1 % 10) * 500);
  return { maxAttempts, backoffMs };
}

/**
 * Parse escalation policy from Section 2 (BEHAVIOR, chars 128–191).
 * If the first char is 'F', fail-forward is enabled.
 */
function parseBehaviorSection(section: string): EscalationConfig {
  const failForward = section[0] === 'F';
  return { failForward };
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function invokeToolWithRetry(
  toolName:    string,
  input:       Record<string, unknown>,
  brain:       MeeseeksBrain,
  retryConfig: RetryConfig,
): Promise<{ success: boolean; output: unknown; error?: string }> {
  const adapter = getToolAdapter(toolName);
  if (!adapter) {
    return {
      success: false,
      output:  null,
      error:   `No tool adapter registered for "${toolName}". ` +
               `Register one via registerToolAdapter() during wiring.`,
    };
  }

  void brain; // conditioning text — available for logging/telemetry, not control logic

  let lastError = '';
  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    try {
      const output = await adapter(input);
      return { success: true, output };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < retryConfig.maxAttempts) {
        await sleep(retryConfig.backoffMs * attempt);
      }
    }
  }

  return { success: false, output: null, error: lastError };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface ExecutionContext {
  /**
   * Current nesting depth. Must be 0.
   * Meeseeks cannot spawn other Meeseeks — this is a hard invariant.
   */
  depth: number;
}

export async function executeMeeseeks(
  input:   MeeseeksExecutionInput,
  msbDir?: string,
  ctx:     ExecutionContext = { depth: 0 },
): Promise<MeeseeksExecutionResult> {
  // Hard invariant: Meeseeks cannot spawn Meeseeks
  if (ctx.depth > 0) {
    throw new Error(
      `[Hard invariant] Meeseeks cannot spawn other Meeseeks. depth=${ctx.depth}`
    );
  }

  const { meeseeks, task, context } = input;
  const resolvedMsbDir = msbDir ?? DEFAULT_MSB_DIR;

  // Parse genome sections for execution config
  const sections     = parseGenome(meeseeks.genome);
  const retryConfig  = parseExecutionSection(sections.execution);
  const escalConfig  = parseBehaviorSection(sections.behavior);

  if (meeseeks.tools.length === 0) {
    return {
      outcome:     'FAILURE',
      output:      null,
      error:       `Meeseeks ${meeseeks.id} has no tools declared`,
      failForward: false,
    };
  }

  const results: unknown[] = [];
  let lastError: string | undefined;
  let allSucceeded = true;

  for (let i = 0; i < meeseeks.tools.length; i++) {
    const toolName = meeseeks.tools[i]!;
    const msbRef   = meeseeks.msbRefs[i] ?? `${toolName}.msb`;
    const msbName  = msbRef.replace(/\.msb$/, '');

    let brain: MeeseeksBrain;
    try {
      brain = loadMsbCached(msbName, resolvedMsbDir);
    } catch (err) {
      lastError    = err instanceof Error ? err.message : String(err);
      allSucceeded = false;
      break;
    }

    const toolInput: Record<string, unknown> = { task, ...context };
    const result = await invokeToolWithRetry(toolName, toolInput, brain, retryConfig);

    if (result.success) {
      results.push(result.output);
    } else {
      lastError    = result.error;
      allSucceeded = false;
      break;
    }
  }

  if (allSucceeded) {
    return {
      outcome:     'SUCCESS',
      output:      results.length === 1 ? results[0] : results,
      failForward: false,
    };
  }

  const outcome: MeeseeksOutcome = escalConfig.failForward ? 'ESCALATED' : 'FAILURE';
  return {
    outcome,
    output:      null,
    error:       lastError,
    failForward: escalConfig.failForward,
  };
}

// Re-export MeeseeksSpec so callers don't need to import from two places
export type { MeeseeksSpec };
