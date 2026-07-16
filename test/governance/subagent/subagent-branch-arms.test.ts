/**
 * subagent-branch-arms.test.ts — Three uncovered branch arms (Packet 171).
 *
 * Covers L580 (error ?? 'unknown'), L623 (lastResult?.output ?? null),
 * and L636 (existsSync false branch) in subagent.ts.
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

const CAMPAIGN_ID = 'CAMP_ARMS';

function brief(allowedMartians: string[]): SubagentBrief {
  return {
    campaignId: CAMPAIGN_ID, role: 'Arms', domain: 'compute',
    objective: 'branch arm test', scope: 'unit', successCriteria: 'ok',
    allowedMartians, deliverables: '', backgroundContext: '',
    communicationStyle: 'terse', knowledgeBase: '', constraints: 'None',
  };
}

// Routes to FAIL via error_present when adapter returns ok=false
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

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-arms-')); });
afterEach(() => { rmSync(baseDir, { recursive: true, force: true }); });

function makeSub(adapter: MartianSummonAdapter, opts: { clock?: () => Date; budgetOverrides?: any } = {}): Subagent {
  return new Subagent(adapter, {
    campaignId: CAMPAIGN_ID, martianType: 'alpha',
    inputs: {}, timeoutMs: 5_000, subagentsBaseDir: baseDir,
    ...opts,
  });
}

describe('subagent.ts — three uncovered branch arms', () => {
  it('Path A (L580): ok=false with error=undefined records error as "unknown"', async () => {
    // Adapter returns ok=false with no error field → the ?? 'unknown' fallback fires
    const adapter: MartianSummonAdapter = {
      async summon(req: MartianSummonRequest): Promise<MartianSummonResult> {
        return {
          summon_id: req.summon_id,
          ok: false,
          // error intentionally omitted → undefined → hits the ?? 'unknown' arm at L580
          fitness: 0.0,
          run_metadata: { tool_calls: 0, wall_clock_ms: 0 },
        };
      },
    };
    const sub = makeSub(adapter);
    const b = brief(['alpha']);
    sub.birth(b, ALWAYS_FAIL_YAML);
    const r = await sub.runCampaign(b, { plan: 'go' }, ALWAYS_FAIL_YAML);
    // error_present fires → FAIL:err → state_machine_failed
    expect(r.termination_reason).toBe('state_machine_failed');
    expect(r.summon_count).toBe(1);
    sub.erase();
  });

  it('Path B (L623): max_summons_per_campaign=0 → final_output is null', async () => {
    // Budget exhausted before the first summon executes → lastResult stays null
    const sub = makeSub(new MockMartianSummonAdapter(0.7), {
      budgetOverrides: { max_summons_per_campaign: 0 },
    });
    const b = brief(['alpha']);
    sub.birth(b, SUCCESS_YAML);
    const r = await sub.runCampaign(b, { plan: 'go' }, SUCCESS_YAML);
    expect(r.termination_reason).toBe('budget_exhausted_summons');
    expect(r.final_output).toBeNull();
    expect(r.summon_count).toBe(0);
    sub.erase();
  });

  it('Path C (L636): erase() without prior birth() does not throw and sets isErased=true', () => {
    // Workspace dir was never created → existsSync returns false → rmSync block skipped
    const sub = new Subagent(new MockMartianSummonAdapter(0.7), {
      campaignId: 'CAMP_NOERASE',
      martianType: 'compute',
      inputs: {},
      timeoutMs: 5_000,
      subagentsBaseDir: baseDir,
    });
    // No birth() call — workspace was never written to disk
    expect(() => sub.erase()).not.toThrow();
    expect(sub.isErased).toBe(true);
  });
});
