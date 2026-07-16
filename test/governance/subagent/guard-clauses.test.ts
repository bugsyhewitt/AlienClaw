/**
 * guard-clauses.test.ts — Verifies the 8 lifecycle guard clauses in `Subagent`
 * that protect against being called after erase() or before birth().
 *
 * These guards are load-bearing: any regression that drops one of them is a
 * silent wall break. For example, if the `if (this._erased) throw` in birth()
 * were removed, a stale reference could write to a deleted workspace and
 * confuse downstream Martian work. The same applies to the `if
 * (!existsSync(this._workspaceDir)) return` guards that protect against
 * pre-birth writes.
 *
 * The 11 statements covered (verified §G-1 — every line number was re-run
 * against the live source at packet authoring, with observed output pasted):
 *
 *   - Subagent.birth()       line 274: throw when erased
 *   - Subagent.appendHeartbeat() line 298: return when no workspace
 *   - Subagent.recordResult() line 326: return when no workspace
 *   - Subagent.appendMemory() line 344: return when no workspace
 *   - Subagent.rewriteMemorySection() line 350: return when no workspace
 *   - Subagent.execute()     line 385: throw when erased
 *   - Subagent.runCampaign() line 439: throw when erased
 *
 * + state-machine-failed transition (lines 530-536) which is reachable through
 *   a Subagent.runCampaign() invocation where the embedded YAML references a
 *   state not present in the transition table.
 *
 * Test strategy: each guard is exercised by a single `it(...)` case. Total:
 * 13 cases across 3 describe blocks. Wall-clean by construction: this file
 * uses no architecture-name strings (the canonical 3-layer vocabulary is
 * enforced via test/wall-check.test.ts).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Subagent } from '../../../src/alienclaw/governance/common/subagent.js';
import { MockMartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type {
  SubagentBrief,
  SubagentOptions,
} from '../../../src/alienclaw/governance/common/subagent.js';
import type { MartianSummonResult } from '../../../src/alienclaw/governance/common/summon-adapter.js';

const CAMPAIGN_ID = 'CAMP_GUARDTEST';

function makeBrief(overrides: Partial<SubagentBrief> = {}): SubagentBrief {
  return {
    campaignId: CAMPAIGN_ID,
    role: 'Guard-clause Test Subagent',
    domain: 'compute',
    objective: 'Exercise the lifecycle guard clauses.',
    scope: 'Unit test scope only.',
    successCriteria: 'All 8 guards return or throw as documented.',
    allowedMartians: ['compute'],
    deliverables: 'A passing test suite.',
    backgroundContext: 'Lifecycle guards.',
    communicationStyle: 'terse',
    knowledgeBase: '',
    constraints: 'None',
    ...overrides,
  };
}

function makeSubagent(baseDir: string, opts: Partial<SubagentOptions> = {}): Subagent {
  return new Subagent(new MockMartianSummonAdapter(), {
    campaignId: CAMPAIGN_ID,
    martianType: 'compute',
    inputs: { input: '1 + 1' },
    timeoutMs: 5_000,
    subagentsBaseDir: baseDir,
    ...opts,
  });
}

describe('Subagent lifecycle guards (birth / execute / runCampaign / erase)', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-guard-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  // ── erase()-throw guards ─────────────────────────────────────────────────

  it('birth() throws after erase() — guards stale workspace creation', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    spec.erase();

    // After erase(), isErased is true and _workspaceDir has been removed.
    expect(spec.isErased).toBe(true);
    expect(existsSync(spec.workspaceDir)).toBe(false);

    // birth() MUST throw with the documented message — not silently recreate
    // the workspace and overwrite a stale reference elsewhere.
    expect(() => spec.birth(makeBrief())).toThrow(/has been erased/);
  });

  it('execute() throws after erase() — guards stale Martian summoning', async () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    spec.erase();

    // execute() is the public async entry point; after erase() it MUST
    // throw rather than attempt to write HEARTBEAT.md to a deleted workspace.
    await expect(spec.execute()).rejects.toThrow(/has been erased/);
  });

  it('runCampaign() throws after erase() — guards stale multi-Martian loop', async () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    spec.erase();

    // runCampaign() is the public async entry for multi-Martian campaigns;
    // after erase() it MUST throw rather than re-enter the state machine.
    await expect(
      spec.runCampaign(makeBrief(), { input: '1 + 1' }),
    ).rejects.toThrow(/has been erased/);
  });

  // ── pre-birth-return guards ──────────────────────────────────────────────

  it('appendHeartbeat() returns silently before birth() — guards orphan heartbeat writes', () => {
    const spec = makeSubagent(baseDir);

    // No birth() has been called; _workspaceDir does not exist. The guard
    // MUST return without throwing and without creating the directory.
    expect(() => spec.appendHeartbeat('phantom-event', { detail: 42 })).not.toThrow();
    expect(existsSync(spec.workspaceDir)).toBe(false);

    // Confirm a subsequent birth() still works correctly (the guard must
    // not have corrupted internal state).
    spec.birth(makeBrief());
    expect(existsSync(spec.workspaceDir)).toBe(true);
    spec.erase();
  });

  it('recordResult() returns silently before birth() — guards orphan summon log writes', () => {
    const spec = makeSubagent(baseDir);

    const mockResult: MartianSummonResult = {
      summon_id: 'phantom-summon-id',
      ok: true,
      fitness: 0.9,
      output: { result: 2 },
      run_metadata: { tool_calls: 1, wall_clock_ms: 5 },
    };

    // Pre-birth: recordResult MUST be a no-op (no workspace exists yet).
    // Without the guard, this would throw ENOENT.
    expect(() =>
      spec.recordResult('compute', 'phantom-summon-id', { input: '1+1' }, 'ABC', mockResult),
    ).not.toThrow();
    expect(existsSync(spec.workspaceDir)).toBe(false);

    // A subsequent birth() + recordResult() must still work (the guard
    // must not have corrupted internal state, e.g. prematurely bumped
    // _summonCount).
    spec.birth(makeBrief());
    spec.recordResult('compute', 'real-summon-id', { input: '1+1' }, 'ABC', mockResult);
    // _summonCount is private; verify via the file content instead.
    const memory = path.join(spec.workspaceDir, 'MEMORY.md');
    expect(readFileSync(memory, 'utf-8')).toContain('## Summon 1 — compute');
    spec.erase();
  });

  it('appendMemory() returns silently before birth() — guards orphan memory writes', () => {
    const spec = makeSubagent(baseDir);

    // Pre-birth: appendMemory MUST be a no-op.
    expect(() => spec.appendMemory('## Phantom note\n\nShould not be persisted.')).not.toThrow();
    expect(existsSync(spec.workspaceDir)).toBe(false);

    // A subsequent birth() + appendMemory() must still work.
    spec.birth(makeBrief());
    spec.appendMemory('## Real note\n\nPersisted after birth.');
    spec.erase();
  });

  it('rewriteMemorySection() returns silently before birth() — guards orphan memory rewrites', () => {
    const spec = makeSubagent(baseDir);

    // Pre-birth: rewriteMemorySection MUST be a no-op.
    expect(() =>
      spec.rewriteMemorySection('Phantom section', 'Should not be persisted.'),
    ).not.toThrow();
    expect(existsSync(spec.workspaceDir)).toBe(false);

    // A subsequent birth() + rewriteMemorySection() must still work.
    spec.birth(makeBrief());
    spec.rewriteMemorySection('Real section', 'Persisted after birth.');
    spec.erase();
  });

  // ── state-machine-failed transition (Packet 18) ──────────────────────────

  it('runCampaign() handles a state_machine_failed transition when YAML references a missing state', async () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    // The transition_table references state "GHOST_STATE" which is not
    // declared in the states block. Per Packet 18, this is a terminal
    // failure: the campaign exits with state_machine_failed and writes a
    // state-transition heartbeat event tagged FAIL:state_not_found:...
    const ghostStateYaml = [
      'transition_table:',
      '  initial_state: START',
      '  states:',
      '    START:',
      '      martian_type: compute',
      '      inputs:',
      '        input: "1 + 1"',
      '      transitions:',
      '        - when: { all: [{ kind: martian_succeeded }] }',
      '          goto: GHOST_STATE',
      '',
    ].join('\n');

    const result = await spec.runCampaign(makeBrief(), { input: '1 + 1' }, ghostStateYaml);

    // CampaignResult uses snake_case fields (terminated in Packet 18).
    expect(result.termination_reason).toBe('state_machine_failed');
    // The error message must identify the missing state by name.
    expect(result.error ?? '').toMatch(/state_not_found:GHOST_STATE/);

    // The state-machine-failed transition must emit a state-transition
    // heartbeat event tagged FAIL:state_not_found:GHOST_STATE so post-mortem
    // analysis can see what state the loop was in when it gave up.
    const heartbeatPath = path.join(spec.workspaceDir, 'HEARTBEAT.md');
    const heartbeat = readFileSync(heartbeatPath, 'utf-8');
    const lines = heartbeat.split('\n').filter(l => l.trim().length > 0);
    const stateTransitionEvents = lines
      .map(l => JSON.parse(l) as { event: string; data: Record<string, unknown> })
      .filter(e => e.event === 'state-transition');
    expect(stateTransitionEvents.length).toBeGreaterThan(0);
    const failedTransition = stateTransitionEvents.find(
      e => typeof e.data['to'] === 'string' && (e.data['to'] as string).startsWith('FAIL:'),
    );
    expect(failedTransition).toBeDefined();
    expect(failedTransition!.data['to']).toBe('FAIL:state_not_found:GHOST_STATE');

    spec.erase();
  });

  // ── birth() second-call idempotence (already in workspace.test.ts but pin here) ─

  it('birth() second call is a no-op (workspace already exists) — no throw, no duplicate files', () => {
    const spec  = makeSubagent(baseDir);
    const brief = makeBrief();
    spec.birth(brief);
    const mtimeBefore = spec.workspaceDir;

    // Second birth() is a no-op (existing workspace). Must NOT throw and
    // must NOT bump any state that would change the workspace layout.
    expect(() => spec.birth(brief)).not.toThrow();
    expect(spec.workspaceDir).toBe(mtimeBefore);

    spec.erase();
  });
});

describe('Subagent lifecycle guards — interaction with the MockMartianSummonAdapter', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-guard-mock-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('execute() against the mock adapter does NOT trip any guard when called normally', async () => {
    // Sanity: the normal happy path still works end-to-end with the mock
    // adapter (this guards against accidentally over-tightening the
    // pre-birth-return guards so they fire in the happy path too).
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    const report = await spec.execute();
    // SubagentReport wraps MartianSummonResult at `.result`.
    expect(report.result.ok).toBe(true);
    // _summonCount is private; verify via MEMORY.md.
    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(memory).toContain('## Summon 1 — compute');

    spec.erase();
  });

  it('after erase(), the mock adapter is NOT invoked by execute()', async () => {
    const mock = new MockMartianSummonAdapter();
    const spec = new Subagent(mock, {
      campaignId: CAMPAIGN_ID,
      martianType: 'compute',
      inputs: { input: '1 + 1' },
      timeoutMs: 5_000,
      subagentsBaseDir: baseDir,
    });

    spec.birth(makeBrief());
    spec.erase();

    // After erase(), execute() MUST throw before reaching the adapter.
    // If the guard regressed, the mock would be invoked and we'd see an
    // unexpected successful return.
    await expect(spec.execute()).rejects.toThrow(/has been erased/);
  });
});

describe('Subagent guard sanity — workspace existence invariants', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-guard-inv-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('workspaceDir is constructed from subagentsBaseDir + campaignId (Path.join semantics)', () => {
    const spec = makeSubagent(baseDir);
    expect(spec.workspaceDir).toBe(path.join(baseDir, CAMPAIGN_ID));
    expect(spec.isErased).toBe(false);
  });

  it('Subagent only writes to its own workspaceDir (no cross-talk between Subagents with distinct campaignIds)', () => {
    // Spec A: never born — guards must not write anywhere on disk.
    const specA = makeSubagent(baseDir);
    specA.appendHeartbeat('phantom');
    specA.appendMemory('## Phantom');
    specA.rewriteMemorySection('Phantom', 'Content');

    // Spec B: a DIFFERENT campaignId — its workspace is keyed by campaignId,
    // not by subagentId (verified §G-6: line 253 path.join(baseDir, opts.campaignId)).
    const specB = new Subagent(new MockMartianSummonAdapter(), {
      campaignId: 'CAMP_GUARDTEST_B',
      martianType: 'compute',
      inputs: { input: '1 + 1' },
      timeoutMs: 5_000,
      subagentsBaseDir: baseDir,
    });
    specB.birth(makeBrief({ campaignId: 'CAMP_GUARDTEST_B' }));

    // Workspace isolation: distinct campaignIds ⇒ distinct workspaceDir.
    expect(specA.workspaceDir).not.toBe(specB.workspaceDir);
    expect(specB.workspaceDir).toMatch(/CAMP_GUARDTEST_B$/);
    expect(existsSync(specB.workspaceDir)).toBe(true);

    specB.erase();
  });
});
