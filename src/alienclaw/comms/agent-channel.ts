/**
 * agent-channel.ts
 * Private inter-agent communication channel for BossBot ↔ AdvisorBot ↔ CreatorBot.
 *
 * Design invariants:
 *   - NEVER writes to stdout — AgentChannel is a structural gate, not a user-facing output
 *   - All inter-agent coordination passes through here; UserChannel never sees agent-to-agent messages
 *   - Audit log: writes to ~/.alienclaw/registry/telemetry/<date>/agent-channel/<from>-<to>-<ts>-<seq>.json
 *
 * Usage:
 *   agentChannel.send({ from: 'BossBot', to: 'AdvisorBot', kind: 'request', content: '...', taskId: '...' })
 *   const history = agentChannel.history('BossBot', 'AdvisorBot', taskId)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join }              from 'node:path';
import { PATHS }             from '../constants.js';
import type { TierAAgent }   from '../constants.js';
import { dateStamp }         from '../utils.js';

// ── Message type ──────────────────────────────────────────────────────────────

export type AgentMessageKind = 'request' | 'response' | 'notice';

export interface AgentMessage {
  from:    TierAAgent;
  to:      TierAAgent;
  kind:    AgentMessageKind;
  content: string;
  ts:      number;
  taskId?: string;
}

// Defense cap on audit content length — mirrors api/server.ts:38 MAX_BODY_BYTES = 64 KiB.
// A single audit file larger than this is almost certainly an unbounded LLM output;
// cap it silently, per AgentChannel's structural invariant of NEVER writing to stdout.
const MAX_AUDIT_CONTENT_BYTES = 64 * 1024; // 65,536

// PKT-772: bound the in-memory message log to prevent singleton heap exhaustion on
// long-running bosses. Mirrors the GovernanceLoop.EVENT_QUEUE_LIMIT ring-buffer
// pattern (governance-loop.ts:79,214-219). 1000 entries × ~200 bytes/entry caps
// the in-memory log at ~200 KiB regardless of process uptime. The audit-file log
// on disk (writeTelemetry) remains the durable record; the in-memory log is a
// write-only ring buffer with no production consumers (see grep audit in PKT-772 §1).
const MAX_LOG_ENTRIES = 1000;

// ── AgentChannel ──────────────────────────────────────────────────────────────

export class AgentChannel {
  /** In-memory ring buffer of recent messages; bounded by MAX_LOG_ENTRIES */
  private _log: AgentMessage[] = [];

  /** Per-instance monotonic counter for audit-filename uniqueness under same-ts collisions */
  private _seq = 0;

  /** Live observers notified on each send */
  private _subscribers = new Set<(msg: AgentMessage) => void>();

  private readonly _baseDir: string;

  constructor(telemetryDir?: string) {
    // Default to the PATHS.telemetry path which does proper homedir() expansion
    this._baseDir = telemetryDir ?? PATHS.telemetry;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Send a message on the channel.
   * Appends to in-memory log AND writes an audit file.
   */
  send(msg: AgentMessage): void {
    // Reject non-finite caller-supplied ts so the audit filename can never collide
    // on Infinity/NaN and silently overwrite a previous audit record.
    const ts = msg.ts ?? Date.now();
    const record: AgentMessage = {
      ...msg,
      ts: Number.isFinite(ts) ? ts : Date.now(),
      // PKT-676: cap content at MAX_AUDIT_CONTENT_BYTES to prevent unbounded audit-file growth.
      content: typeof msg.content === 'string' && msg.content.length > MAX_AUDIT_CONTENT_BYTES
        ? `[[truncated: ${msg.content.length} bytes exceeded ${MAX_AUDIT_CONTENT_BYTES} cap]]`
        : msg.content,
    };
    // PKT-772: ring-buffer eviction — drop oldest entries when the in-memory log
    // reaches MAX_LOG_ENTRIES. Mirrors GovernanceLoop.pushEvent (governance-loop.ts:222-227).
    // This caps singleton heap growth on long-running bosses; the audit file on disk
    // remains the durable record (writeTelemetry is unaffected).
    if (this._log.length >= MAX_LOG_ENTRIES) {
      this._log.shift();
    }
    this._log.push(record);
    void this._writeAuditFile(record);
    for (const fn of this._subscribers) {
      try { fn(record); } catch { /* observer errors are swallowed */ }
    }
  }

  /**
   * Return the message history between two agents (bidirectional).
   * Returns all messages where either agent is the sender and the other is the receiver.
   * Optionally filter by taskId.
   */
  history(agentA: TierAAgent, agentB: TierAAgent, taskId?: string): AgentMessage[] {
    return this._log.filter(m =>
      ((m.from === agentA && m.to === agentB) || (m.from === agentB && m.to === agentA)) &&
      (taskId === undefined || m.taskId === taskId)
    );
  }

  /**
   * Subscribe to new messages.
   * Returns an unsubscribe function — call it to stop receiving notifications.
   */
  subscribe(fn: (msg: AgentMessage) => void): () => void {
    this._subscribers.add(fn);
    return () => { this._subscribers.delete(fn); };
  }

  // ── Audit file ────────────────────────────────────────────────────────────

  private async _writeAuditFile(msg: AgentMessage): Promise<void> {
    const date = dateStamp(); // YYYY-MM-DD
    const dir  = join(this._baseDir, date, 'agent-channel');
    // _seq guarantees uniqueness within an AgentChannel lifetime under same-ts sends.
    // The ${from}-${to}-${ts} prefix is preserved for human-scannability.
    const filename = `${msg.from}-${msg.to}-${msg.ts}-${this._seq++}.json`;
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), JSON.stringify(msg, null, 2), 'utf-8');
    } catch {
      // Audit write failures are non-fatal — log is still in memory
    }
  }
}

export const agentChannel = new AgentChannel(PATHS.telemetry);
