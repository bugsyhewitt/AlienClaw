/**
 * agent-channel.ts
 * Private inter-agent communication channel for BossBot ↔ AdvisorBot ↔ CreatorBot.
 *
 * Design invariants:
 *   - NEVER writes to stdout — AgentChannel is a structural gate, not a user-facing output
 *   - All inter-agent coordination passes through here; UserChannel never sees agent-to-agent messages
 *   - Audit log: writes to ~/.alienclaw/registry/telemetry/<date>/agent-channel/<from>-<to>-<ts>.json
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

// ── AgentChannel ──────────────────────────────────────────────────────────────

export class AgentChannel {
  /** In-memory log of all messages */
  private _log: AgentMessage[] = [];

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
    // Ensure immutable record with a stable ts
    const record: AgentMessage = { ...msg, ts: msg.ts ?? Date.now() };
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
    const filename = `${msg.from}-${msg.to}-${msg.ts}.json`;
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), JSON.stringify(msg, null, 2), 'utf-8');
    } catch {
      // Audit write failures are non-fatal — log is still in memory
    }
  }
}

export const agentChannel = new AgentChannel(PATHS.telemetry);
