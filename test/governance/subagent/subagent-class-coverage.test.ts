/**
 * subagent-class-coverage.test.ts — Direct unit tests for the Subagent class itself
 * (src/alienclaw/governance/common/subagent.ts, 642 lines).
 *
 * Closes 4 uncovered branch groups in subagent.ts that the existing 9
 * subagent/* test files leave uncovered:
 *
 *   1. line 274: birth() `_erased` guard throw
 *      ("Subagent <id> has been erased") — reached when birth() is called
 *      after erase() has set _erased=true. Defensive: prevents re-birthing
 *      a deleted Subagent.
 *
 *   2. line 385: execute() `_erased` guard throw
 *      ("Subagent <id> has been erased") — reached when execute() is
 *      called after erase(). Defensive: prevents running a Martian summon
 *      on a deleted Subagent.
 *
 *   3. line 439: runCampaign() `_erased` guard throw
 *      ("Subagent <id> has been erased") — reached when runCampaign() is
 *      called after erase(). Defensive: prevents running a campaign loop
 *      on a deleted Subagent.
 *
 *   4. lines 530-536: runCampaign() stateDef-null branch
 *      (the "state_not_found:<state>" Fail path inside the Summon/Retry
 *      switch case) — defensive code: decide() pre-validates the target
 *      state at decision_engine.ts:84-87 (initial-state check) and
 *      decision_engine.ts:115-118 (next-state check on the goto branch),
 *      so the `if (!stateDef)` check in subagent.ts:530-536 is NEVER
 *      reached from real decide() output. It exists as a safety net for
 *      cases where the table is mutated between decide() and the
 *      runCampaign loop body. We test it by mocking decide() to return
 *      a Summon action whose `target_state` is intentionally not in
 *      `table.states`.
 *
 * The 3 _erased-guard throws are the LAST defensive checks before a
 * deleted Subagent is allowed to birth/execute/run a campaign — exactly
 * the kind of path a regression would silently break. The 530-536 path
 * is unreachable from real decide() output, so it's defensive against
 * post-decide mutations (pinned by R-002 below).
 *
 * No LLM, no DB, no subprocess. Uses MockMartianSummonAdapter (already
 * in src/alienclaw/governance/common/summon-adapter.ts) for the campaign
 * path; vi.spyOn on the decide module for the unreachable-branch path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Subagent } from '../../../src/alienclaw/governance/common/subagent.js';
import { MockMartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { SubagentBrief } from '../../../src/alienclaw/governance/common/subagent.js';

const CAMPAIGN_ID = 'CAMP_SUBAGT_107';

function makeBrief(overrides: Partial<SubagentBrief> = {}): SubagentBrief {
  return {
    campaignId:        CAMPAIGN_ID,
    role:              'Test Subagent',
    domain:            'compute',
    objective:         'Compute 7 / 3 and return the result.',
    scope:             'Only arithmetic. No file I/O.',
    successCriteria:   'Fitness >= 0.5',
    allowedMartians:   ['compute'],
    deliverables:      'Fitness score and result value.',
    backgroundContext: 'Unit test context.',
    communicationStyle: 'structured',
    knowledgeBase:     'Basic arithmetic.',
    constraints:       'None',
    ...overrides,
  };
}

function makeSubagent(baseDir: string, campaignId = CAMPAIGN_ID): Subagent {
  return new Subagent(new MockMartianSummonAdapter(0.8, { result: 42 }), {
    campaignId,
    martianType:       'compute',
    inputs:            { input: '7 / 3' },
    timeoutMs:         5_000,
    subagentsBaseDir:  baseDir,
  });
}

// ── §1: _erased guard throws (lines 274, 385, 439) ─────────────────────────

describe('Subagent _erased guard throws', () => {
  let baseDir: string;
  let spec: Subagent;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-107-erased-'));
    spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
  });

  afterEach(() => {
    if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
  });

  it('birth() throws "Subagent <id> has been erased" after erase()', () => {
    // R-001: birth() is guarded by `if (this._erased) throw new Error(...)` (line 274).
    // After erase() sets _erased=true, calling birth() must throw with the
    // expected error message containing the subagent's id.
    const subagentId = spec.subagentId;
    spec.erase();

    expect(spec.isErased).toBe(true);
    expect(() => spec.birth(makeBrief()))
      .toThrowError(`Subagent ${subagentId} has been erased`);
  });

  it('execute() throws "Subagent <id> has been erased" after erase()', async () => {
    // R-002: execute() is guarded by `if (this._erased) throw new Error(...)`
    // (line 385). After erase(), execute() must throw before summoning.
    const subagentId = spec.subagentId;
    spec.erase();

    expect(spec.isErased).toBe(true);
    await expect(spec.execute())
      .rejects.toThrowError(`Subagent ${subagentId} has been erased`);
  });

  it('runCampaign() throws "Subagent <id> has been erased" after erase()', async () => {
    // R-003: runCampaign() is guarded by `if (this._erased) throw new Error(...)`
    // (line 439). After erase(), runCampaign() must throw before the loop.
    const subagentId = spec.subagentId;
    spec.erase();

    expect(spec.isErased).toBe(true);
    await expect(spec.runCampaign(makeBrief(), { plan: '2+2' }))
      .rejects.toThrowError(`Subagent ${subagentId} has been erased`);
  });
});

// ── §2: stateDef-null defensive branch (lines 530-536) ─────────────────────
//
// The `if (!stateDef)` branch at subagent.ts:530-536 is unreachable from
// real decide() output because decide() pre-validates the state at
// decision_engine.ts:84-87 (initial-state check) and decision_engine.ts:115-118
// (next-state check on the goto branch). It exists as a runtime guard.
//
// We test it by mocking the decide() export on the decision_engine module
// so it returns a Summon action whose `target_state` is intentionally not
// in `table.states`. The runCampaign loop body then hits the
// `if (!stateDef)` branch at line 530 and emits the "state_not_found:..."
// Fail path at line 532-536.

describe('Subagent runCampaign stateDef-null defensive branch (line 530-536)', () => {
  let baseDir: string;
  let spec: Subagent;

  beforeEach(async () => {
    // Module-level mock of the decide() function. We override the
    // decision_engine module export so runCampaign's loop sees a
    // Summon action with a phantom target_state.
    //
    // On the FIRST decide() call (last_result === null), return a Summon
    // for "step1" (the initial state). On the SECOND call, return a
    // Summon for "phantom_state" — which is NOT in table.states. The
    // runCampaign loop body then hits the `if (!stateDef)` branch.
    vi.doMock('../../../src/alienclaw/governance/common/subagent/decision_engine.js', () => ({
      decide: vi.fn()
        .mockReturnValueOnce({
          kind: 'Summon',
          target_state: 'step1',
          martian_type: 'compute',
          inputs: { input: '2+2' },
        })
        .mockReturnValueOnce({
          kind: 'Summon',
          target_state: 'phantom_state',  // NOT in table.states
          martian_type: 'compute',
          inputs: { input: 'phantom' },
        }),
    }));

    // Re-import subagent AFTER the mock is in place so the import is bound
    // to the mocked module.
    vi.resetModules();
    const subagentMod = await import('../../../src/alienclaw/governance/common/subagent.js');
    const adapterMod  = await import('../../../src/alienclaw/governance/common/summon-adapter.js');

    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-107-phantom-'));
    spec = new subagentMod.Subagent(new adapterMod.MockMartianSummonAdapter(0.8, { result: 42 }), {
      campaignId:        CAMPAIGN_ID,
      martianType:       'compute',
      inputs:            { input: '2+2' },
      timeoutMs:         5_000,
      subagentsBaseDir:  baseDir,
    });
  });

  afterEach(() => {
    vi.doUnmock('../../../src/alienclaw/governance/common/subagent/decision_engine.js');
    vi.resetModules();
    if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
  });

  it('stateDef null → Fail("state_not_found:phantom_state") + terminates loop', async () => {
    // R-004: when the runCampaign loop's `if (!stateDef)` branch (line 530)
    // is reached, the loop must:
    //   1. set termReason = 'state_machine_failed' (line 531)
    //   2. set failError = `state_not_found:<state>` (line 532)
    //   3. append a state-transition heartbeat (line 533-536)
    //   4. break the loop
    //   5. return a CampaignResult with termination_reason='state_machine_failed'
    //      and error=`state_not_found:phantom_state`
    //
    // A YAML transition table with `initial_state: step1` and a single state
    // "step1" with a transition that points to "phantom_state" (which is
    // NOT in the table) — that table parses cleanly, but the second
    // decide() call returns a Summon for "phantom_state", triggering the
    // defensive branch.
    const TRANSITION_TABLE_YAML = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute
      inputs:
        input: "2+2"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: phantom_state
`;

    spec.birth(makeBrief(), TRANSITION_TABLE_YAML);

    const result = await spec.runCampaign(makeBrief(), { plan: '2+2' });

    // R-004.1: termination_reason is 'state_machine_failed'
    expect(result.termination_reason).toBe('state_machine_failed');
    // R-004.2: error is 'state_not_found:phantom_state'
    expect(result.error).toBe('state_not_found:phantom_state');
    // R-004.3: at least one summon completed (the first, for step1)
    expect(result.summon_count).toBeGreaterThanOrEqual(1);
    // R-004.4: no completion bonus (because the loop broke before finalize);
    //          fitness is the last summon's fitness (from aggregate()).
    //          Per fitness_aggregator.ts:30-32, the formula is
    //          final_summon.fitness + 0.2 if state_machine_finalized, clamped [0,1].
    //          Since termination_reason is 'state_machine_failed' (not 'state_machine_finalized'),
    //          no bonus is applied. The final_summon_fitness is 0.8 (the MockAdapter's
    //          fixedFitness), so result.fitness === 0.8.
    expect(result.fitness).toBe(0.8);
    // R-004.5: the loop terminated (no infinite hang)
    expect(result.subagentId).toBe(spec.subagentId);
  });
});
