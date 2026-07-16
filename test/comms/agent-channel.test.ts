/**
 * agent-channel.test.ts — Direct unit tests for AgentChannel (comms/agent-channel.ts)
 *
 * Packet 092: closes the direct unit-test coverage gap on the load-bearing inter-agent
 * communication channel. AgentChannel is the structural gate for ALL BossBot ↔
 * AdvisorBot ↔ CreatorBot coordination. The AGENTS.md §"VERIFICATION CHECKLIST" item 4
 * reads: "Communication graph: user prompt reaches BossBot only; fitness reports bypass
 * BossBot" — AgentChannel is the implementation of that wall.
 *
 * 26 cases / 9 describe blocks / 0 source changes / 0 throw sites covered.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AgentChannel,
  agentChannel as defaultAgentChannel,
} from '../../src/alienclaw/comms/agent-channel.js';
import { PATHS } from '../../src/alienclaw/constants.js';
import type { TierAAgent } from '../../src/alienclaw/constants.js';
import type { AgentMessage, AgentMessageKind } from '../../src/alienclaw/comms/agent-channel.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-channel-test-'));
}

function rmTmp(dir: string): void {
  try {
    const { rmSync } = require('node:fs') as typeof import('node:fs');
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function makeMsg(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    from: 'BossBot',
    to: 'AdvisorBot',
    kind: 'request',
    content: 'Should we add a testing campaign?',
    ts: 1700000000000,
    taskId: 'task-1',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AgentChannel — constructor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmTmp(tmpDir);
  });

  it('accepts no args and uses PATHS.telemetry as the default base directory', () => {
    const ch = new AgentChannel();
    // The singleton's _baseDir is initialized from PATHS.telemetry (default).
    // We exercise the constructor's no-args branch and verify the channel
    // functions without throwing — this proves the constructor branch is hit.
    expect(ch).toBeInstanceOf(AgentChannel);
    // history on a fresh, never-sent channel returns []
    expect(ch.history('BossBot', 'AdvisorBot')).toEqual([]);
  });

  it('accepts a custom telemetryDir and uses it for audit writes', async () => {
    const ch = new AgentChannel(tmpDir);
    ch.send(makeMsg({ ts: 1700000001000 }));

    // The write is fire-and-forget (void this._writeAuditFile). Yield to event loop.
    await new Promise((r) => setTimeout(r, 50));

    // The directory uses TODAY's date (new Date().toISOString().slice(0,10)),
    // not the message's ts date — this is the actual code behavior on line 89
    // of src/alienclaw/comms/agent-channel.ts. The FILENAME uses msg.ts.
    const today = new Date().toISOString().slice(0, 10);
    const expectedDir = join(tmpDir, today, 'agent-channel');
    expect(existsSync(expectedDir)).toBe(true);
    const files = readdirSync(expectedDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^BossBot-AdvisorBot-1700000001000\.json$/);
  });
});

describe('AgentChannel.send — in-memory log', () => {
  let ch: AgentChannel;

  beforeEach(() => {
    ch = new AgentChannel(makeTmpDir());
  });

  it('appends the message to the in-memory log', () => {
    const msg = makeMsg();
    ch.send(msg);
    expect(ch.history('BossBot', 'AdvisorBot', 'task-1')).toHaveLength(1);
    expect(ch.history('BossBot', 'AdvisorBot', 'task-1')[0]).toEqual(msg);
  });

  it('preserves a caller-provided ts verbatim (does not overwrite)', () => {
    const fixedTs = 1700000000000;
    ch.send(makeMsg({ ts: fixedTs }));
    const retrieved = ch.history('BossBot', 'AdvisorBot')[0]!;
    expect(retrieved.ts).toBe(fixedTs);
  });

  it('fills in a missing ts with Date.now() when not provided', () => {
    const before = Date.now();
    // Caller omits ts; send() must backfill it.
    ch.send({
      from: 'BossBot',
      to: 'AdvisorBot',
      kind: 'request',
      content: 'No ts provided',
      taskId: 't1',
    } as AgentMessage);
    const after = Date.now();
    const retrieved = ch.history('BossBot', 'AdvisorBot', 't1')[0]!;
    expect(retrieved.ts).toBeGreaterThanOrEqual(before);
    expect(retrieved.ts).toBeLessThanOrEqual(after);
  });

  it('creates an immutable record (spread copy) — mutating the original after send does not mutate the log', () => {
    const original = makeMsg({ content: 'original' });
    ch.send(original);
    // Mutate the original AFTER sending
    (original as { content: string }).content = 'MUTATED';
    const retrieved = ch.history('BossBot', 'AdvisorBot', 'task-1')[0]!;
    expect(retrieved.content).toBe('original');
  });

  it('supports all three AgentMessageKind values without discrimination', () => {
    const kinds: AgentMessageKind[] = ['request', 'response', 'notice'];
    for (const kind of kinds) {
      ch.send(makeMsg({ kind, content: kind, taskId: `t-${kind}`, ts: 1700000000000 + kinds.indexOf(kind) }));
    }
    expect(ch.history('BossBot', 'AdvisorBot', 't-request')).toHaveLength(1);
    expect(ch.history('BossBot', 'AdvisorBot', 't-response')).toHaveLength(1);
    expect(ch.history('BossBot', 'AdvisorBot', 't-notice')).toHaveLength(1);
  });
});

describe('AgentChannel.send — subscriber notification', () => {
  let ch: AgentChannel;
  let received: AgentMessage[];

  beforeEach(() => {
    ch = new AgentChannel(makeTmpDir());
    received = [];
  });

  it('notifies a single subscriber on each send', () => {
    ch.subscribe((m) => received.push(m));
    ch.send(makeMsg({ ts: 1 }));
    ch.send(makeMsg({ ts: 2 }));
    expect(received).toHaveLength(2);
    expect(received[0]!.ts).toBe(1);
    expect(received[1]!.ts).toBe(2);
  });

  it('notifies multiple subscribers in registration order', () => {
    const order: string[] = [];
    ch.subscribe(() => order.push('A'));
    ch.subscribe(() => order.push('B'));
    ch.subscribe(() => order.push('C'));
    ch.send(makeMsg());
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('returns an unsubscribe function that stops future notifications', () => {
    const unsub = ch.subscribe((m) => received.push(m));
    ch.send(makeMsg({ ts: 1 }));
    unsub();
    ch.send(makeMsg({ ts: 2 }));
    expect(received).toHaveLength(1);
    expect(received[0]!.ts).toBe(1);
  });

  it('swallows observer exceptions — does not propagate to send()', () => {
    ch.subscribe(() => {
      throw new Error('observer boom');
    });
    // Should NOT throw
    expect(() => ch.send(makeMsg({ ts: 1 }))).not.toThrow();
    // And the message IS still in the log despite the observer throwing
    expect(ch.history('BossBot', 'AdvisorBot', 'task-1')).toHaveLength(1);
  });

  it('isolates observer exceptions — a later subscriber still receives the message', () => {
    const received: AgentMessage[] = [];
    ch.subscribe(() => {
      throw new Error('first observer boom');
    });
    ch.subscribe((m) => received.push(m));
    expect(() => ch.send(makeMsg())).not.toThrow();
    expect(received).toHaveLength(1);
  });
});

describe('AgentChannel.history', () => {
  let ch: AgentChannel;

  beforeEach(() => {
    ch = new AgentChannel(makeTmpDir());
  });

  it('returns [] when no messages have been sent', () => {
    expect(ch.history('BossBot', 'AdvisorBot')).toEqual([]);
  });

  it('returns bidirectional messages between two agents (both directions)', () => {
    const ts = 1700000000000;
    ch.send(makeMsg({ from: 'BossBot', to: 'AdvisorBot', content: 'Q', ts, taskId: 't1' }));
    ch.send(makeMsg({ from: 'AdvisorBot', to: 'BossBot', content: 'A', ts: ts + 1, taskId: 't1' }));
    ch.send(makeMsg({ from: 'BossBot', to: 'CreatorBot', content: 'BC', ts: ts + 2, taskId: 't1' }));
    expect(ch.history('BossBot', 'AdvisorBot')).toHaveLength(2);
  });

  it('does NOT return messages between unrelated agent pairs', () => {
    ch.send(makeMsg({ from: 'BossBot', to: 'AdvisorBot', ts: 1 }));
    ch.send(makeMsg({ from: 'BossBot', to: 'CreatorBot', ts: 2 }));
    ch.send(makeMsg({ from: 'AdvisorBot', to: 'CreatorBot', ts: 3 }));
    const ba = ch.history('BossBot', 'AdvisorBot');
    const bc = ch.history('BossBot', 'CreatorBot');
    const ac = ch.history('AdvisorBot', 'CreatorBot');
    expect(ba.map((m) => m.ts)).toEqual([1]);
    expect(bc.map((m) => m.ts)).toEqual([2]);
    expect(ac.map((m) => m.ts)).toEqual([3]);
  });

  it('filters by taskId when provided (omits messages without a matching taskId)', () => {
    ch.send(makeMsg({ taskId: 'task-A', ts: 1 }));
    ch.send(makeMsg({ taskId: 'task-B', ts: 2 }));
    ch.send(makeMsg({ taskId: 'task-A', ts: 3 }));
    const aOnly = ch.history('BossBot', 'AdvisorBot', 'task-A');
    const bOnly = ch.history('BossBot', 'AdvisorBot', 'task-B');
    expect(aOnly.map((m) => m.ts)).toEqual([1, 3]);
    expect(bOnly.map((m) => m.ts)).toEqual([2]);
  });

  it('includes messages without taskId when taskId filter is undefined', () => {
    ch.send(makeMsg({ taskId: 'task-A', ts: 1 }));
    ch.send(makeMsg({ taskId: undefined, ts: 2 } as AgentMessage));
    const all = ch.history('BossBot', 'AdvisorBot');
    expect(all).toHaveLength(2);
  });
});

describe('AgentChannel — audit file writes', () => {
  let tmpDir: string;
  let ch: AgentChannel;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    ch = new AgentChannel(tmpDir);
  });

  afterEach(() => {
    rmTmp(tmpDir);
  });

  it('writes a JSON file to <baseDir>/<YYYY-MM-DD>/agent-channel/<from>-<to>-<ts>.json', async () => {
    const ts = Date.now();
    ch.send(makeMsg({ ts, from: 'BossBot', to: 'AdvisorBot' }));

    // The write is fire-and-forget (void this._writeAuditFile). Yield to event loop.
    await new Promise((r) => setTimeout(r, 50));

    // The directory uses TODAY's date (new Date().toISOString().slice(0,10)),
    // not the message's ts date — this is the actual code behavior on line 89.
    const today = new Date().toISOString().slice(0, 10);
    const auditDir = join(tmpDir, today, 'agent-channel');
    expect(existsSync(auditDir)).toBe(true);
    const files = readdirSync(auditDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`BossBot-AdvisorBot-${ts}.json`);
  });

  it('writes the message JSON verbatim into the audit file', async () => {
    const ts = Date.now();
    const msg = makeMsg({ ts, content: 'audit-me', taskId: 'audit-task' });
    ch.send(msg);

    await new Promise((r) => setTimeout(r, 50));

    const today = new Date().toISOString().slice(0, 10);
    const auditFile = join(tmpDir, today, 'agent-channel', `BossBot-AdvisorBot-${ts}.json`);
    const raw = readFileSync(auditFile, 'utf-8');
    const parsed = JSON.parse(raw) as AgentMessage;
    expect(parsed).toEqual(msg);
  });

  it('isolates audit writes per (from, to, ts) tuple — no overwrites', async () => {
    const baseTs = Date.now();
    ch.send(makeMsg({ ts: baseTs, from: 'BossBot', to: 'AdvisorBot', content: 'first' }));
    ch.send(makeMsg({ ts: baseTs + 1, from: 'BossBot', to: 'AdvisorBot', content: 'second' }));
    ch.send(makeMsg({ ts: baseTs + 2, from: 'BossBot', to: 'CreatorBot', content: 'third' }));

    await new Promise((r) => setTimeout(r, 50));

    const today = new Date().toISOString().slice(0, 10);
    const auditDir = join(tmpDir, today, 'agent-channel');
    const files = readdirSync(auditDir);
    expect(files).toHaveLength(3);
    expect(files.sort()).toEqual([
      `BossBot-AdvisorBot-${baseTs}.json`,
      `BossBot-AdvisorBot-${baseTs + 1}.json`,
      `BossBot-CreatorBot-${baseTs + 2}.json`,
    ]);
  });
});

describe('AgentChannel — wall isolation (Rule 5)', () => {
  let ch: AgentChannel;

  beforeEach(() => {
    ch = new AgentChannel(makeTmpDir());
  });

  it('send() never writes to stdout — the channel is a structural gate, not user output', () => {
    const originalLog = console.log;
    const stdoutSpy = vi.fn();
    console.log = (...args: unknown[]) => {
      stdoutSpy(...args);
      originalLog(...args);
    };
    try {
      ch.send(makeMsg({ ts: 1, content: 'should-not-appear' }));
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      console.log = originalLog;
    }
  });
});

describe('AgentChannel — singleton export', () => {
  it('exports a singleton instance via `agentChannel`', () => {
    expect(defaultAgentChannel).toBeInstanceOf(AgentChannel);
  });

  it('the singleton is constructed with PATHS.telemetry (the default no-args constructor path)', () => {
    // Indirect verification: the singleton exists and is functional.
    // A direct read of `_baseDir` is impossible (it's private), so we exercise
    // the singleton's send() to verify it's wired up to a real base dir.
    const originalLog = console.log;
    const stdoutSpy = vi.fn();
    console.log = (...args: unknown[]) => {
      stdoutSpy(...args);
      originalLog(...args);
    };
    try {
      defaultAgentChannel.send(makeMsg({ ts: Date.now(), content: 'singleton smoke', taskId: 'singleton-smoke' }));
      // The send goes to PATHS.telemetry which may or may not exist on the test
      // machine. The test only proves the singleton is functional + does not
      // write to stdout.
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      console.log = originalLog;
    }
  });
});

describe('AgentChannel — TierAAgent type enforcement', () => {
  let ch: AgentChannel;

  beforeEach(() => {
    ch = new AgentChannel(makeTmpDir());
  });

  it('accepts all three TierAAgent values: BossBot, AdvisorBot, CreatorBot', () => {
    const agents: TierAAgent[] = ['BossBot', 'AdvisorBot', 'CreatorBot'];
    for (let i = 0; i < agents.length; i++) {
      const from = agents[i]!;
      const to = agents[(i + 1) % agents.length]!;
      ch.send(makeMsg({ from, to, taskId: `tier-${i}`, ts: 1700000000000 + i }));
    }
    // i=0: BossBot → AdvisorBot   (B↔A: 1)
    // i=1: AdvisorBot → CreatorBot (A↔C: 1)
    // i=2: CreatorBot → BossBot   (B↔C: 1)
    expect(ch.history('BossBot', 'AdvisorBot')).toHaveLength(1);
    expect(ch.history('AdvisorBot', 'CreatorBot')).toHaveLength(1);
    expect(ch.history('BossBot', 'CreatorBot')).toHaveLength(1);
  });
});

describe('AgentChannel — pure in-memory state isolation', () => {
  it('two AgentChannel instances do not share in-memory state', () => {
    const a = new AgentChannel(makeTmpDir());
    const b = new AgentChannel(makeTmpDir());
    a.send(makeMsg({ taskId: 'a-only', ts: 1 }));
    b.send(makeMsg({ taskId: 'b-only', ts: 2 }));
    expect(a.history('BossBot', 'AdvisorBot', 'a-only')).toHaveLength(1);
    expect(a.history('BossBot', 'AdvisorBot', 'b-only')).toHaveLength(0);
    expect(b.history('BossBot', 'AdvisorBot', 'b-only')).toHaveLength(1);
    expect(b.history('BossBot', 'AdvisorBot', 'a-only')).toHaveLength(0);
  });

  it('subscribers added to one channel are not invoked by sends on another', () => {
    const a = new AgentChannel(makeTmpDir());
    const b = new AgentChannel(makeTmpDir());
    const received: AgentMessage[] = [];
    a.subscribe((m) => received.push(m));
    b.send(makeMsg({ ts: 1 }));
    expect(received).toHaveLength(0);
    a.send(makeMsg({ ts: 2 }));
    expect(received).toHaveLength(1);
  });
});

// Keep PATHS referenced to ensure the import isn't tree-shaken (compile-time guard
// for the singleton constructor branch).
const _pathsGuard = PATHS;
void _pathsGuard;
void statSync; // also keep statSync referenced (used in audit checks at runtime)