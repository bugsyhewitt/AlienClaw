/**
 * Runtime comm-graph enforcement for the Packet 6 governance loop.
 *
 * WHY two layers of enforcement:
 * 1. TYPE LEVEL (messages.ts): discriminated-union Message type means the
 *    compiler rejects illegal (from, to, kind) combinations at build time.
 * 2. RUNTIME LEVEL (this file): assertLegalSend() checks every send against a
 *    frozen set of allowed triples. If future code uses `as any`, dynamic dispatch,
 *    or JSON deserialization to bypass the type system, this guard still catches it.
 *
 * The COMM_GRAPH array is the single source of truth for both layers.
 * Adding a new edge requires a code change here AND in messages.ts.
 */

import type { Agent, Message } from './messages.js';

// Each tuple is [from, to, kind]. Frozen so it can't be mutated at runtime.
export const COMM_GRAPH: ReadonlyArray<readonly [Agent, Agent, string]> = Object.freeze([
  Object.freeze(['user',        'BossBot',         'user-goal']        as const),
  Object.freeze(['BossBot',     'AdvisorBot',      'planning-consult'] as const),
  Object.freeze(['AdvisorBot',  'BossBot',         'advice']           as const),
  Object.freeze(['BossBot',     'CreatorBot',      'campaign-request'] as const),
  Object.freeze(['CreatorBot',  'BossBot',         'campaign-report']  as const),
  Object.freeze(['BossBot',     'user',            'user-response']    as const),
  Object.freeze(['Martian',     'fitness-channel', 'fitness-report']   as const),
]);

// Build a lookup set once — O(1) per check.
const _GRAPH_SET = new Set<string>(
  COMM_GRAPH.map(([f, t, k]) => `${f}|${t}|${k}`)
);

// ── Error ──────────────────────────────────────────────────────────────────

export class IllegalSendError extends Error {
  constructor(
    public readonly from: string,
    public readonly to:   string,
    public readonly kind: string,
  ) {
    super(`Illegal send: ${from} → ${to} (kind: ${kind}). Not in the comm graph.`);
    this.name = 'IllegalSendError';
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Assert that a message is legal per the comm graph.
 *
 * Call this on every outbound message — before it leaves an agent.
 * Throws IllegalSendError for any (from, to, kind) triple not in COMM_GRAPH.
 *
 * Accepts both typed Message objects and untyped objects (for the
 * deliberate type-bypass test cases in illegal-sends.test.ts).
 */
export function assertLegalSend(
  message: Message | { from: string; to: string; kind: string }
): void {
  const key = `${message.from}|${message.to}|${message.kind}`;
  if (!_GRAPH_SET.has(key)) {
    throw new IllegalSendError(message.from, message.to, message.kind);
  }
}

/**
 * Boolean check — same semantics as assertLegalSend but no throw.
 * Useful in conditional logic and tests that don't want try/catch.
 */
export function isLegalSend(from: string, to: string, kind: string): boolean {
  return _GRAPH_SET.has(`${from}|${to}|${kind}`);
}
