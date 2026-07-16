/**
 * bossbot-helpers.test.ts — unit tests for the LLM-output parsers in
 * src/alienclaw/agents/bossbot.ts: parseSubGoals (line 24) and
 * parseSchemeDraft (line 54). These are the graceful-degradation paths
 * called from draftScheme / refineSchemeDraft / generateSubGoals after
 * the LLM responds. Packet 051.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSubGoals,
  parseSchemeDraft,
} from '../../src/alienclaw/agents/bossbot.js';

describe('parseSubGoals (agents/bossbot.ts:24)', () => {
  it('parses a well-formed JSON array', () => {
    const raw = JSON.stringify([
      { description: 'fetch data', domain: 'research' },
      { description: 'summarize',  domain: 'writing', dependsOn: ['fetch'] },
    ]);
    const out = parseSubGoals(raw);
    expect(out).toHaveLength(2);
    expect(out[0]!.description).toBe('fetch data');
    expect(out[0]!.domain).toBe('research');
    expect(out[0]!.status).toBe('pending');
    expect(out[0]!.dependsOn).toEqual([]);
    expect(typeof out[0]!.id).toBe('string');
    // parseSubGoals passes through dependsOn verbatim (no name→id resolution
    // like parseSchemeDraft). The downstream SubGoal may use string names.
    expect(out[1]!.dependsOn).toEqual(['fetch']);
  });

  it('defaults missing domain to "general"', () => {
    const raw = JSON.stringify([{ description: 'foo' }]);
    const out = parseSubGoals(raw);
    expect(out[0]!.domain).toBe('general');
  });

  it('strips ```json markdown fences before parsing', () => {
    const raw = '```json\n[{"description":"d1","domain":"x"}]\n```';
    const out = parseSubGoals(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe('d1');
  });

  it('strips bare ``` fences before parsing', () => {
    const raw = '```\n[{"description":"d1"}]\n```';
    const out = parseSubGoals(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe('d1');
  });

  it('falls back to a single sub-goal on malformed JSON', () => {
    const raw = 'not valid json at all';
    const out = parseSubGoals(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.domain).toBe('general');
    expect(out[0]!.status).toBe('pending');
    expect(out[0]!.dependsOn).toEqual([]);
    expect(out[0]!.description).toBe('not valid json at all');
  });

  it('truncates the fallback description at 200 chars', () => {
    const raw = 'x'.repeat(500);
    const out = parseSubGoals(raw);
    expect(out[0]!.description.length).toBe(200);
  });
});

describe('parseSchemeDraft (agents/bossbot.ts:54)', () => {
  const validScheme = (extra: object = {}) => JSON.stringify({
    rationale: 'do X then Y',
    campaigns: [
      {
        name: 'research',
        objective: 'find data',
        dependsOn: [],
        subagents: [{ role: 'analyst', domain: 'research', knowledgeBase: '', martianTags: ['web_search'] }],
      },
    ],
    ...extra,
  });

  it('parses a well-formed Scheme with one campaign', () => {
    const goalId = 'goal-1';
    const out = parseSchemeDraft(goalId, validScheme());
    expect(out.goalId).toBe(goalId);
    expect(out.rationale).toBe('do X then Y');
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]!.name).toBe('research');
    expect(out.campaigns[0]!.id).not.toBe(goalId);
    expect(typeof out.campaigns[0]!.id).toBe('string');
    expect(out.campaigns[0]!.status).toBe('pending');
    expect(out.advisorEndorsement).toBe('');
    expect(typeof out.createdAt).toBe('number');
  });

  it('resolves dependsOn by name → campaign id', () => {
    const raw = JSON.stringify({
      rationale: '',
      campaigns: [
        { name: 'a', objective: 'A', dependsOn: [], subagents: [] },
        { name: 'b', objective: 'B', dependsOn: ['a'], subagents: [] },
      ],
    });
    const out = parseSchemeDraft('g', raw);
    const a = out.campaigns[0]!;
    const b = out.campaigns[1]!;
    expect(b.dependsOn).toEqual([a.id]);
  });

  it('drops dependsOn references to unknown campaign names', () => {
    const raw = JSON.stringify({
      rationale: '',
      campaigns: [
        { name: 'a', objective: 'A', dependsOn: ['nonexistent'], subagents: [] },
      ],
    });
    const out = parseSchemeDraft('g', raw);
    expect(out.campaigns[0]!.dependsOn).toEqual([]);
  });

  it('strips ```json markdown fences before parsing', () => {
    const raw = '```json\n' + validScheme() + '\n```';
    const out = parseSchemeDraft('g', raw);
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]!.name).toBe('research');
  });

  it('falls back to a single Generalist campaign on malformed JSON', () => {
    const raw = 'this is not json';
    const out = parseSchemeDraft('goal-fb', raw);
    expect(out.goalId).toBe('goal-fb');
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]!.name).toBe('Main Campaign');
    expect(out.campaigns[0]!.subagents).toHaveLength(1);
    expect(out.campaigns[0]!.subagents[0]!.role).toBe('Generalist');
    expect(out.campaigns[0]!.subagents[0]!.domain).toBe('general');
    expect(out.campaigns[0]!.subagents[0]!.martianTags).toEqual(['web_search', 'file_read', 'file_write']);
    expect(out.rationale).toContain('non-JSON');
  });

  it('truncates fallback objective at 200 chars', () => {
    const raw = 'y'.repeat(500);
    const out = parseSchemeDraft('g', raw);
    expect(out.campaigns[0]!.objective.length).toBe(200);
  });

  it('defaults missing subagent domain to "general"', () => {
    const raw = JSON.stringify({
      rationale: '',
      campaigns: [
        {
          name: 'c1', objective: 'o', dependsOn: [],
          subagents: [{ role: 'r', knowledgeBase: 'kb' }],
        },
      ],
    });
    const out = parseSchemeDraft('g', raw);
    expect(out.campaigns[0]!.subagents[0]!.domain).toBe('general');
  });

  it('defaults missing subagent martianTags to []', () => {
    const raw = JSON.stringify({
      rationale: '',
      campaigns: [
        {
          name: 'c1', objective: 'o', dependsOn: [],
          subagents: [{ role: 'r', domain: 'd' }],
        },
      ],
    });
    const out = parseSchemeDraft('g', raw);
    expect(out.campaigns[0]!.subagents[0]!.martianTags).toEqual([]);
  });

  it('defaults missing campaign dependsOn to []', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'c1', objective: 'o', subagents: [] },  // no dependsOn key
      ],
    });
    const out = parseSchemeDraft('g', raw);
    expect(out.campaigns[0]!.dependsOn).toEqual([]);
  });

  it('defaults missing rationale to empty string', () => {
    const raw = JSON.stringify({
      // no rationale key
      campaigns: [
        { name: 'c1', objective: 'o', dependsOn: [], subagents: [] },
      ],
    });
    const out = parseSchemeDraft('g', raw);
    expect(out.rationale).toBe('');
  });
});
