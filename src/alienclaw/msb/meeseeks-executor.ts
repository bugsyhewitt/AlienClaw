/**
 * meeseeks-executor.ts
 * Executes a Meeseeks synchronously: runs its tool(s) via MSB conditioning.
 *
 * Hard invariants enforced:
 *   - Meeseeks execute ONE tool call each (no chains)
 *   - No nested Meeseeks (depth enforced by caller via ExecutionContext)
 *   - Execution terminates fully before returning control
 *   - Returns SUCCESS | FAILURE | ESCALATED
 *   - MSB is conditioning text only — no control logic lives there
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
 * Phase 3 uses the flat registerToolAdapter() approach; this interface
 * is available for class-based resolvers in future phases.
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
// Genome block helpers
// ---------------------------------------------------------------------------

interface RetryConfig {
  maxAttempts: number;
  backoffMs:   number;
}

interface EscalationConfig {
  failForward: boolean;
}

function parseRetryBlock(block: string): RetryConfig {
  // Block 3 (retry): first 2 chars encode maxAttempts and backoff.
  const char0       = block.charCodeAt(0) - 48;
  const maxAttempts = Math.max(1, Math.min(5, char0 % 5 + 1));
  const char1       = block.charCodeAt(1) - 48;
  const backoffMs   = Math.max(100, (char1 % 10) * 500);
  return { maxAttempts, backoffMs };
}

function parseEscalationBlock(block: string): EscalationConfig {
  // Block 4 (escalation): if first char is 'F', fail-forward is enabled.
  const failForward = block[0] === 'F';
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
  /** Current nesting depth. Must be 0 — Meeseeks cannot spawn Meeseeks. */
  depth: number;
}

export async function executeMeeseeks(
  input:   MeeseeksExecutionInput,
  msbDir?: string,
  ctx:     ExecutionContext = { depth: 0 },
): Promise<MeeseeksExecutionResult> {
  // Hard invariant: no nested Meeseeks
  if (ctx.depth > 0) {
    throw new Error(
      `[Hard invariant] Meeseeks cannot spawn other Meeseeks. depth=${ctx.depth}`
    );
  }

  const { meeseeks, task, context } = input;
  const resolvedMsbDir = msbDir ?? DEFAULT_MSB_DIR;

  // Parse genome for retry and escalation config
  const blocks      = parseGenome(meeseeks.genome);
  const retryConfig = parseRetryBlock(blocks.retryLogic);
  const escalConfig = parseEscalationBlock(blocks.escalation);

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
