/**
 * termination-reasons.test.ts — All 6 TerminationReason exit paths.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Subagent } from '../../../src/alienclaw/governance/common/subagent.js';
import {
  MockMartianSummonAdapter,
  type MartianSummonAdapter,
  type MartianSummonRequest,
  type MartianSummonResult,
} from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { SubagentBrief } from '../../../src/alienclaw/governance/common/subagent.js';

const CAMPAIGN_ID = 'CAMP_TERM';

function brief(allowedMartians: string[]): SubagentBrief {
  return {
    campaignId: CAMPAIGN_ID, role: 'Term', domain: 'compute',
    objective: 'term test', scope: 'unit', successCriteria: 'ok',
    allowedMartians, deliverables: '', backgroundContext: '',
    communicationStyle: 'terse', knowledgeBase: '', constraints: 'None',
  };
}

const SUCCESS_YAML = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: alpha
      inputs:
        plan: "\${campaign.plan}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:martian_failed"
`;

const ALWAYS_FAIL_YAML = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: alpha
      inputs:
        plan: "\${campaign.plan}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: "FAIL:always_fail"
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:err"
`;

const TWO_STEP_YAML = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: alpha
      inputs:
        plan: "\${campaign.plan}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: step2
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:err"
    step2:
      martian_type: beta
      inputs:
        x: y
      transitions:
        - when: { any: [{ kind: error_absent }] }
          goto: FINALIZE
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:err"
`;

const RETRY_YAML = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: alpha
      inputs:
        x: y
      transitions:
        - when: { all: [{ kind: fitness_gt, n: 0.99 }] }
          goto: FINALIZE
        - when: { any: [{ kind: error_absent }] }
          goto: step1
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:err"
`;

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-term-')); });
afterEach(() => { rmSync(baseDir, { recursive: true, force: true }); });

function makeSub(adapter: MartianSummonAdapter, opts: { clock?: () => Date; budgetOverrides?: any } = {}): Subagent {
  return new Subagent(adapter, {
    campaignId: CAMPAIGN_ID, martianType: 'alpha',
    inputs: {}, timeoutMs: 5_000, subagentsBaseDir: baseDir,
    ...opts,
  });
}

describe('TerminationReason — all 6 paths', () => {
  it('1. state_machine_finalized — happy path', async () => {
    const sub = makeSub(new MockMartianSummonAdapter(0.7));
    const b = brief(['alpha']);
    sub.birth(b, SUCCESS_YAML);
    const r = await sub.runCampaign(b, { plan: 'go' }, SUCCESS_YAML);
    expect(r.termination_reason).toBe('state_machine_finalized');
    sub.erase();
  });

  it('2. state_machine_failed — explicit FAIL goto', async () => {
    const sub = makeSub(new MockMartianSummonAdapter(0.7));
    const b = brief(['alpha']);
    sub.birth(b, ALWAYS_FAIL_YAML);
    const r = await sub.runCampaign(b, { plan: 'go' }, ALWAYS_FAIL_YAML);
    expect(r.termination_reason).toBe('state_machine_failed');
    expect(r.error).toBe('always_fail');
    sub.erase();
  });

  it('3. budget_exhausted_summons — global cap of 1 with 2-step', async () => {
    const sub = makeSub(new MockMartianSummonAdapter(0.7), {
      budgetOverrides: { max_summons_per_campaign: 1 },
    });
    const b = brief(['alpha', 'beta']);
    sub.birth(b, TWO_STEP_YAML);
    const r = await sub.runCampaign(b, { plan: 'go' }, TWO_STEP_YAML);
    expect(r.termination_reason).toBe('budget_exhausted_summons');
    expect(r.summon_count).toBe(1);
    sub.erase();
  });

  it('4. budget_exhausted_per_state — Retry exceeds per-state cap', async () => {
    // Adapter that succeeds (error_absent) but never reaches fitness > 0.99 → forces Retry loop
    class RetryAdapter implements MartianSummonAdapter {
      async summon(req: MartianSummonRequest): Promise<MartianSummonResult> {
        return {
          summon_id: req.summon_id,
          ok: true,
          output: {},
          fitness: 0.5,
          run_metadata: { tool_calls: 1, wall_clock_ms: 1 },
        };
      }
    }
    const sub = makeSub(new RetryAdapter(), {
      budgetOverrides: { max_summons_per_state: 2 },
    });
    const b = brief(['alpha']);
    sub.birth(b, RETRY_YAML);
    const r = await sub.runCampaign(b, {}, RETRY_YAML);
    expect(r.termination_reason).toBe('budget_exhausted_per_state');
    sub.erase();
  });

  it('5. budget_exhausted_wallclock — fake clock advances past limit', async () => {
    let now = new Date('2026-01-01T00:00:00Z').getTime();
    class SlowAdapter implements MartianSummonAdapter {
      async summon(req: MartianSummonRequest): Promise<MartianSummonResult> {
        now += 60_000; // advance 60s per call
        return {
          summon_id: req.summon_id, ok: true, output: {}, fitness: 0.5,
          run_metadata: { tool_calls: 1, wall_clock_ms: 60_000 },
        };
      }
    }
    const sub = makeSub(new SlowAdapter(), {
      clock: () => new Date(now),
      budgetOverrides: { max_wall_clock_seconds: 30 },
    });
    const b = brief(['alpha']);
    sub.birth(b, RETRY_YAML);
    const r = await sub.runCampaign(b, {}, RETRY_YAML);
    expect(r.termination_reason).toBe('budget_exhausted_wallclock');
    sub.erase();
  });

  it('6. decision_rule_error — unparseable transition table', async () => {
    const sub = makeSub(new MockMartianSummonAdapter(0.7));
    const b = brief(['alpha']);
    sub.birth(b);
    const r = await sub.runCampaign(b, {}, 'no transition table here');
    expect(r.termination_reason).toBe('decision_rule_error');
    expect(r.summon_count).toBe(0);
    sub.erase();
  });
});
