/**
 * creator-bot-transition-table.test.ts
 *
 * Covers buildTransitionTableYaml inside the governance CI gate.
 * The same function is tested in test/integration/end_to_end/synthetic-goal.test.ts
 * but that file is excluded from the governance coverage run.  This file ensures
 * all three branches (empty / single / multi) are visible to the gate.
 */
import { describe, it, expect } from 'vitest';
import { buildTransitionTableYaml } from '../../src/alienclaw/governance/common/creator-bot.js';
import type { SubagentBrief } from '../../src/alienclaw/governance/common/subagent.js';

function makeBrief(allowedMartians: string[]): SubagentBrief {
  return {
    campaignId: 'c1', role: 'r', domain: 'd',
    objective: 'o', scope: 's', successCriteria: 'sc',
    allowedMartians,
    deliverables: 'del', backgroundContext: '', communicationStyle: 'terse',
    knowledgeBase: '', constraints: '',
  };
}

describe('buildTransitionTableYaml', () => {
  it('returns empty string when allowedMartians is empty (L52 arm0)', () => {
    expect(buildTransitionTableYaml(makeBrief([]))).toBe('');
  });

  it('generates single-martian template (L55 arm0)', () => {
    const yaml = buildTransitionTableYaml(makeBrief(['compute']));
    expect(yaml).toContain('transition_table:');
    expect(yaml).toContain('martian_type: compute');
    expect(yaml).toContain('FINALIZE');
    expect(yaml).not.toContain('step2');
  });

  it('generates two-step template for two or more martians (L55 arm1)', () => {
    const yaml = buildTransitionTableYaml(makeBrief(['search', 'compute']));
    expect(yaml).toContain('step1');
    expect(yaml).toContain('step2');
    expect(yaml).toContain('martian_type: search');
    expect(yaml).toContain('martian_type: compute');
  });
});
