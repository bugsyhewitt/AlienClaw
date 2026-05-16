/**
 * multi-martian.test.ts — End-to-end Subagent.runCampaign() with mock adapter.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
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

const CAMPAIGN_ID = 'CAMP_MULTI';

function brief(allowedMartians: string[]): SubagentBrief {
  return {
    campaignId: CAMPAIGN_ID, role: 'Multi Test', domain: 'compute',
    objective: 'multi-martian test', scope: 'unit', successCriteria: 'ok',
    allowedMartians, deliverables: '', backgroundContext: '',
    communicationStyle: 'terse', knowledgeBase: '', constraints: 'None',
  };
}

const TWO_STATE_YAML = `transition_table:
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
          goto: "FAIL:step1_failed"
    step2:
      martian_type: beta
      inputs:
        input: "\${last_result.output.result}"
      transitions:
        - when: { any: [{ kind: error_absent }] }
          goto: FINALIZE
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:step2_failed"
`;

class CountingAdapter implements MartianSummonAdapter {
  public calls: MartianSummonRequest[] = [];
  async summon(req: MartianSummonRequest): Promise<MartianSummonResult> {
    this.calls.push(req);
    return {
      summon_id: req.summon_id,
      ok: true,
      output: { result: `out-${req.martian_type}` },
      fitness: 0.7,
      run_metadata: { tool_calls: 1, wall_clock_ms: 1 },
    };
  }
}

describe('Subagent.runCampaign() — multi-Martian', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-multi-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('runs 2 summons, finalizes, and emits expected JSONL events', async () => {
    const adapter = new CountingAdapter();
    const sub = new Subagent(adapter, {
      campaignId: CAMPAIGN_ID, martianType: 'alpha',
      inputs: {}, timeoutMs: 5_000, subagentsBaseDir: baseDir,
    });
    const b = brief(['alpha', 'beta']);
    sub.birth(b, TWO_STATE_YAML);
    const wsDir = sub.workspaceDir;

    const result = await sub.runCampaign(b, { plan: 'go' }, TWO_STATE_YAML);

    expect(result.termination_reason).toBe('state_machine_finalized');
    expect(result.summon_count).toBe(2);
    expect(adapter.calls.length).toBe(2);
    expect(adapter.calls[0]?.martian_type).toBe('alpha');
    expect(adapter.calls[1]?.martian_type).toBe('beta');

    // MEMORY.md captures both summons
    const mem = readFileSync(path.join(wsDir, 'MEMORY.md'), 'utf-8');
    expect(mem).toContain('## Summon 1 — alpha');
    expect(mem).toContain('## Summon 2 — beta');

    // HEARTBEAT.md is JSONL with expected events
    const hb = readFileSync(path.join(wsDir, 'HEARTBEAT.md'), 'utf-8');
    const events = hb.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const kinds = events.map(e => e.event);
    expect(kinds).toContain('born');
    expect(kinds.filter(k => k === 'summon-issued').length).toBe(2);
    expect(kinds.filter(k => k === 'summon-result').length).toBe(2);
    expect(kinds).toContain('state-transition');
    expect(kinds).toContain('finalized');

    // fitness = 0.7 (last summon) + 0.2 bonus = 0.9
    expect(result.fitness).toBeCloseTo(0.9, 6);

    sub.erase();
    expect(existsSync(wsDir)).toBe(false);
  });

  it('input substitution wires last_result.output to next state', async () => {
    const adapter = new CountingAdapter();
    const sub = new Subagent(adapter, {
      campaignId: CAMPAIGN_ID, martianType: 'alpha',
      inputs: {}, timeoutMs: 5_000, subagentsBaseDir: baseDir,
    });
    const b = brief(['alpha', 'beta']);
    sub.birth(b, TWO_STATE_YAML);
    await sub.runCampaign(b, { plan: 'p1' }, TWO_STATE_YAML);

    expect(adapter.calls[0]?.inputs.plan).toBe('p1');
    expect(adapter.calls[1]?.inputs.input).toBe('out-alpha');
    sub.erase();
  });

  it('uses MockMartianSummonAdapter happy path with default mock', async () => {
    const adapter = new MockMartianSummonAdapter(0.8, { result: 'mocked' });
    const sub = new Subagent(adapter, {
      campaignId: CAMPAIGN_ID, martianType: 'alpha',
      inputs: {}, timeoutMs: 5_000, subagentsBaseDir: baseDir,
    });
    const b = brief(['alpha', 'beta']);
    sub.birth(b, TWO_STATE_YAML);
    const result = await sub.runCampaign(b, { plan: 'do' }, TWO_STATE_YAML);
    expect(result.termination_reason).toBe('state_machine_finalized');
    expect(result.summon_count).toBe(2);
    sub.erase();
  });
});
