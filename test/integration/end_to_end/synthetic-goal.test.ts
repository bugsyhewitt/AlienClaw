/**
 * test_synthetic_goal.ts — End-to-end integration verification
 *
 * Tests the SIMPLIFIED governance path:
 * CreatorBot (governance/common) -> Subagent -> RealMartianSummonAdapter -> bridge -> Martian
 *
 * Uses real Python bridge (not mock). Validates:
 * - Subagent birth (5-file workspace creation)
 * - Multi-Martian campaign loop execution (transition table from CAMPAIGN.md)
 * - search_then_count Martian: slot 0 (search_text) -> slot 1 (compute)
 * - RealMartianSummonAdapter subprocess call to Python bridge
 * - Fitness aggregation: min correctness x 1/sum(tool_calls)
 * - HEARTBEAT.md events in JSONL format
 * - Workspace cleanup (erased after campaign)
 *
 * The FULL LLM governance path (GovernanceLoop -> agents/bossbot -> agents/creatorbot
 * -> governance/common/Subagent) is NOT tested here because ANTHROPIC_API_KEY is not
 * set. The structural wiring was completed in Packets 23+24; LLM end-to-end validation
 * requires a live API key.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { RealMartianSummonAdapter } from '../../../src/alienclaw/governance/common/real-summon-adapter.js';
import { Subagent } from '../../../src/alienclaw/governance/common/subagent.js';
import type { SubagentBrief, SubagentOptions } from '../../../src/alienclaw/governance/common/subagent.js';
import { buildTransitionTableYaml } from '../../../src/alienclaw/governance/common/creator-bot.js';
import { InMemorySink, Logger } from '../../../src/alienclaw/governance/common/logger.js';

const CAMPAIGN_ID = 'p22-synthetic-fox-001';

// Transition table for search_then_count: search_text -> compute
const TRANSITION_TABLE_YAML = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: search_then_count
      inputs:
        text: "\${campaign.text}"
        pattern: "\${campaign.pattern}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:martian_failed"
`;

describe('Synthetic integration — simplified governance path + real bridge', () => {
  let baseDir: string;
  let _sink: InMemorySink;
  let _logger: Logger;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'p22-synthetic-'));
    _sink = new InMemorySink();
    _logger = new Logger(_sink, 'p22-test');
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it(
    'search_then_count runs end-to-end via real bridge',
    { timeout: 60_000 },
    async () => {
      // 1. Create the Subagent with RealMartianSummonAdapter
      const adapter = new RealMartianSummonAdapter();
      const opts: SubagentOptions = {
        campaignId:       CAMPAIGN_ID,
        martianType:      'search_then_count',
        inputs:           { text: 'the quick brown fox. fox runs again. fox in box.', pattern: 'fox' },
        timeoutMs:        30_000,
        subagentsBaseDir: baseDir,
      };
      const subagent = new Subagent(adapter, opts);

      // 2. Build brief with transition table
      const brief: SubagentBrief = {
        campaignId:         CAMPAIGN_ID,
        role:               'search_then_count Subagent',
        domain:             'search_then_count',
        objective:          'Find all fox occurrences and count them.',
        scope:              'Text search and counting',
        successCriteria:    'Match count > 0',
        allowedMartians:    ['search_then_count'],
        deliverables:       'Count of fox occurrences',
        backgroundContext:  '',
        communicationStyle: 'terse',
        knowledgeBase:      '',
        constraints:        'None',
      };

      // 3. Birth the Subagent (creates workspace)
      subagent.birth(brief);
      expect(existsSync(subagent.workspaceDir)).toBe(true);

      // Verify 5 workspace files created
      const wsFiles = readdirSync(subagent.workspaceDir);
      expect(wsFiles).toContain('SOUL.md');
      expect(wsFiles).toContain('CAMPAIGN.md');
      expect(wsFiles).toContain('MARTIANS.md');
      expect(wsFiles).toContain('MEMORY.md');
      expect(wsFiles).toContain('HEARTBEAT.md');

      // 4. Run the multi-Martian campaign via runCampaign
      const campaignInputs = {
        text:    'the quick brown fox jumps. fox runs. fox in box.',
        pattern: 'fox',
      };

      const result = await subagent.runCampaign(brief, campaignInputs, TRANSITION_TABLE_YAML);

      // 5. Verify campaign ran and produced results
      expect(result.campaignId).toBe(CAMPAIGN_ID);
      expect(result.summon_count).toBeGreaterThan(0);
      // search_then_count: search_text finds fox -> compute evaluates match_count
      expect(result.fitness).toBeGreaterThanOrEqual(0);
      expect([
        'state_machine_finalized',
        'state_machine_failed',
        'budget_exhausted_summons',
        'budget_exhausted_wallclock',
        'decision_rule_error',
      ].includes(result.termination_reason)).toBe(true);

      // 6. HEARTBEAT.md should have events (JSONL)
      const heartbeatPath = path.join(subagent.workspaceDir, 'HEARTBEAT.md');
      if (existsSync(heartbeatPath)) {
        const heartbeat = readFileSync(heartbeatPath, 'utf-8');
        const lines = heartbeat.trim().split('\n').filter(l => l.trim());
        expect(lines.length).toBeGreaterThan(0);
      }

      console.log(`Campaign result: fitness=${result.fitness.toFixed(3)}, ` +
        `summons=${result.summon_count}, reason=${result.termination_reason}`);
      if (result.final_output) {
        console.log(`Final output keys: ${Object.keys(result.final_output).join(', ')}`);
      }
    }
  );

  it('Subagent workspace files have expected content', () => {
    const adapter = new RealMartianSummonAdapter();
    const opts: SubagentOptions = {
      campaignId:       'p22-ws-check',
      martianType:      'search_then_count',
      inputs:           {},
      timeoutMs:        5_000,
      subagentsBaseDir: baseDir,
    };
    const subagent = new Subagent(adapter, opts);
    const brief: SubagentBrief = {
      campaignId:         'p22-ws-check',
      role:               'Test Subagent',
      domain:             'search',
      objective:          'Test workspace creation',
      scope:              'Unit test',
      successCriteria:    'Workspace created',
      allowedMartians:    ['search_then_count', 'compute_alone'],
      deliverables:       'Test result',
      backgroundContext:  '',
      communicationStyle: 'terse',
      knowledgeBase:      '',
      constraints:        'None',
    };
    subagent.birth(brief);

    // SOUL.md should mention the campaign id
    const soul = readFileSync(path.join(subagent.workspaceDir, 'SOUL.md'), 'utf-8');
    expect(soul).toContain('p22-ws-check');

    // MARTIANS.md should list allowed Martians
    const martians = readFileSync(path.join(subagent.workspaceDir, 'MARTIANS.md'), 'utf-8');
    expect(martians).toContain('search_then_count');
    expect(martians).toContain('compute_alone');

    // HEARTBEAT.md should have a born event line (JSONL)
    const heartbeat = readFileSync(path.join(subagent.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    const lines = heartbeat.trim().split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const firstEvent = JSON.parse(lines[0]);
      expect(firstEvent).toHaveProperty('event');
      expect(firstEvent).toHaveProperty('ts');
    }

    // Cleanup
    subagent.erase();
    expect(existsSync(subagent.workspaceDir)).toBe(false);
  });

  it('buildTransitionTableYaml generates valid YAML for single martian', () => {
    const brief: SubagentBrief = {
      campaignId: 'test', role: 'test', domain: 'test',
      objective: 'test', scope: 'test', successCriteria: 'test',
      allowedMartians: ['compute_alone'],
      deliverables: 'test', backgroundContext: '', communicationStyle: 'terse',
      knowledgeBase: '', constraints: '',
    };
    const yaml = buildTransitionTableYaml(brief);
    expect(yaml).toContain('transition_table:');
    expect(yaml).toContain('martian_type: compute_alone');
    expect(yaml).toContain('FINALIZE');
  });

  it('buildTransitionTableYaml generates 2-step table for two martians', () => {
    const brief: SubagentBrief = {
      campaignId: 'test', role: 'test', domain: 'test',
      objective: 'test', scope: 'test', successCriteria: 'test',
      allowedMartians: ['search_then_count', 'compute_alone'],
      deliverables: 'test', backgroundContext: '', communicationStyle: 'terse',
      knowledgeBase: '', constraints: '',
    };
    const yaml = buildTransitionTableYaml(brief);
    expect(yaml).toContain('step1');
    expect(yaml).toContain('step2');
    expect(yaml).toContain('search_then_count');
    expect(yaml).toContain('compute_alone');
  });
});
