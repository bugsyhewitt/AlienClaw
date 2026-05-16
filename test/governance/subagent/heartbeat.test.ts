/**
 * heartbeat.test.ts — Verifies HEARTBEAT.md JSONL semantics (v1.4).
 *
 * As of Packet 18, HEARTBEAT.md is append-only JSONL. Each line is:
 *   {"ts":"<ISO>","event":"<name>","data":{...}}
 *
 * Events: born, summon-issued, summon-result, state-transition,
 *         budget-exhausted, finalized, heartbeat, erased.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Subagent } from '../../../src/alienclaw/governance/common/subagent.js';
import { MockMartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { SubagentBrief } from '../../../src/alienclaw/governance/common/subagent.js';

const CAMPAIGN_ID = 'CAMP_HBTEST';

function makeBrief(): SubagentBrief {
  return {
    campaignId: CAMPAIGN_ID, role: 'HB Test Subagent', domain: 'compute',
    objective: 'Test heartbeat semantics.', scope: 'Unit test.',
    successCriteria: 'Heartbeat correctly maintained.', allowedMartians: ['compute'],
    deliverables: 'Test pass.', backgroundContext: '', communicationStyle: 'terse',
    knowledgeBase: '', constraints: 'None',
  };
}

function makeSubagent(baseDir: string): Subagent {
  return new Subagent(new MockMartianSummonAdapter(), {
    campaignId: CAMPAIGN_ID, martianType: 'compute',
    inputs: {}, timeoutMs: 5_000, subagentsBaseDir: baseDir,
  });
}

function readEvents(workspaceDir: string): Array<{ ts: string; event: string; data: Record<string, unknown> }> {
  const raw = readFileSync(path.join(workspaceDir, 'HEARTBEAT.md'), 'utf-8');
  return raw.split('\n').filter(l => l.trim().length > 0).map(l => JSON.parse(l));
}

describe('Subagent HEARTBEAT.md JSONL semantics', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-hb-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('birth() writes a "born" event as the first JSONL line', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    const events = readEvents(spec.workspaceDir);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.event).toBe('born');
    expect(events[0]!.data.campaign_id).toBe(CAMPAIGN_ID);
    expect(typeof events[0]!.ts).toBe('string');
    spec.erase();
  });

  it('every line in HEARTBEAT.md parses as JSON', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    spec.updateHeartbeat('STALLED', 'waiting');
    spec.updateHeartbeat('RUNNING', 'ok', 'Activity A');

    const raw = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
    spec.erase();
  });

  it('appendHeartbeat() adds a line each call', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    spec.appendHeartbeat('custom', { foo: 'bar' });
    spec.appendHeartbeat('custom2', { x: 1 });

    const events = readEvents(spec.workspaceDir);
    const customs = events.filter(e => e.event === 'custom' || e.event === 'custom2');
    expect(customs.length).toBe(2);
    spec.erase();
  });

  it('finalize(COMPLETE) emits a heartbeat event with state=COMPLETE', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    spec.finalize('COMPLETE', 'All tasks done.');

    const events = readEvents(spec.workspaceDir);
    const last = events[events.length - 1]!;
    expect(last.event).toBe('heartbeat');
    expect(last.data.state).toBe('COMPLETE');
    spec.erase();
  });

  it('execute() emits summon-issued and summon-result events', async () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    await spec.execute();

    const events = readEvents(spec.workspaceDir);
    const kinds = events.map(e => e.event);
    expect(kinds).toContain('summon-issued');
    expect(kinds).toContain('summon-result');
    spec.erase();
  });
});
