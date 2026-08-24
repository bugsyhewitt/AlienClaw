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

// ── PKT-667: parseSchemeDraft cycle detection ─────────────────────────────────

describe('parseSchemeDraft — cycle detection (PKT-667)', () => {
  it('R-667-1: self-reference (A.dependsOn = [\'A\']) throws with cycle path', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'A', objective: 'do A', dependsOn: ['A'], subagents: [] },
      ],
    });
    expect(() => parseSchemeDraft('g', raw)).toThrow(/parseSchemeDraft: cyclic campaign dependencies detected/);
    expect(() => parseSchemeDraft('g', raw)).toThrow(/A/);
  });

  it('R-667-2: mutual cycle (A↔B) throws', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'A', objective: 'do A', dependsOn: ['B'], subagents: [] },
        { name: 'B', objective: 'do B', dependsOn: ['A'], subagents: [] },
      ],
    });
    expect(() => parseSchemeDraft('g', raw)).toThrow(/parseSchemeDraft: cyclic campaign dependencies detected/);
  });

  it('R-667-3: 3-cycle (A→B→C→A) throws', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'A', objective: 'o', dependsOn: ['B'], subagents: [] },
        { name: 'B', objective: 'o', dependsOn: ['C'], subagents: [] },
        { name: 'C', objective: 'o', dependsOn: ['A'], subagents: [] },
      ],
    });
    expect(() => parseSchemeDraft('g', raw)).toThrow(/parseSchemeDraft: cyclic campaign dependencies detected/);
  });

  it('R-667-4: duplicate dependsOn (A.dependsOn = [\'B\', \'B\']) resolves to single B id', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'B', objective: 'o', dependsOn: [],         subagents: [] },
        { name: 'A', objective: 'o', dependsOn: ['B', 'B'], subagents: [] },
      ],
    });
    const out = parseSchemeDraft('g', raw);
    const b = out.campaigns.find(c => c.name === 'B')!;
    const a = out.campaigns.find(c => c.name === 'A')!;
    expect(a.dependsOn).toHaveLength(1);
    expect(a.dependsOn[0]).toBe(b.id);
  });

  it('R-667-5: healthy diamond (A→B, A→C, B→D, C→D) passes without throwing', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'A', objective: 'o', dependsOn: [],          subagents: [] },
        { name: 'B', objective: 'o', dependsOn: ['A'],       subagents: [] },
        { name: 'C', objective: 'o', dependsOn: ['A'],       subagents: [] },
        { name: 'D', objective: 'o', dependsOn: ['B', 'C'], subagents: [] },
      ],
    });
    expect(() => parseSchemeDraft('g', raw)).not.toThrow();
  });

  it('R-667-6: ghost name + self-reference → throws (cycle detected despite ghost being dropped)', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'A', objective: 'o', dependsOn: ['A', 'NONEXISTENT'], subagents: [] },
      ],
    });
    expect(() => parseSchemeDraft('g', raw)).toThrow(/parseSchemeDraft: cyclic campaign dependencies detected/);
  });

  it('R-667-7: cycle error message includes campaign NAMES (not just IDs) for LLM self-correction', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'AlphaCampaign', objective: 'o', dependsOn: ['AlphaCampaign'], subagents: [] },
      ],
    });
    let msg = '';
    try { parseSchemeDraft('g', raw); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('AlphaCampaign');
    expect(msg).not.toBe('');
  });
});

// ── Packet 422: strict validation additions ───────────────────────────────────

describe('parseSubGoals — strict validation (packet 422)', () => {
  it('returns [] for empty string', () => {
    expect(parseSubGoals('')).toEqual([]);
  });

  it('returns [] for whitespace-only string', () => {
    expect(parseSubGoals('   ')).toEqual([]);
  });

  it('returns [] when JSON parses to null', () => {
    expect(parseSubGoals('null')).toEqual([]);
  });

  it('returns [] when JSON parses to a number', () => {
    expect(parseSubGoals('42')).toEqual([]);
  });

  it('returns [] when JSON parses to a string', () => {
    expect(parseSubGoals('"just a string"')).toEqual([]);
  });

  it('returns [] when JSON parses to an object (not array)', () => {
    expect(parseSubGoals('{"description":"x"}')).toEqual([]);
  });

  it('returns [] when array item has non-string description', () => {
    expect(parseSubGoals('[{"description":42}]')).toEqual([]);
  });

  it('skips bad items and keeps valid ones in mixed array', () => {
    const raw = '[{"description":"a"},{"description":42},{"description":"b"}]';
    const out = parseSubGoals(raw);
    expect(out).toHaveLength(2);
    expect(out[0]!.description).toBe('a');
    expect(out[1]!.description).toBe('b');
  });

  it('returns [] when array item has non-array dependsOn', () => {
    expect(parseSubGoals('[{"description":"x","dependsOn":"not-arr"}]')).toEqual([]);
  });
});

describe('parseSchemeDraft — strict validation (packet 422)', () => {
  it('throws on empty string input', () => {
    expect(() => parseSchemeDraft('g', '')).toThrow('parseSchemeDraft: empty LLM output cannot produce a scheme');
  });

  it('throws on whitespace-only input', () => {
    expect(() => parseSchemeDraft('g', '   ')).toThrow('parseSchemeDraft: empty LLM output cannot produce a scheme');
  });

  it('throws when JSON parses to null', () => {
    expect(() => parseSchemeDraft('g', 'null')).toThrow();
  });

  it('throws when JSON parses to an array (not object)', () => {
    expect(() => parseSchemeDraft('g', '[1,2,3]')).toThrow();
  });

  it('throws when campaigns field is null', () => {
    expect(() => parseSchemeDraft('g', '{"rationale":"r","campaigns":null}')).toThrow();
  });

  it('throws when all campaigns are filtered out (no valid campaigns)', () => {
    expect(() => parseSchemeDraft('g', '{"rationale":"r","campaigns":[{}]}')).toThrow('parseSchemeDraft: no valid campaigns after parsing');
  });

  it('parses valid scheme with one campaign (baseline preserved)', () => {
    const raw = '{"rationale":"r","campaigns":[{"name":"C1","objective":"O1","subagents":[{"role":"r","domain":"d"}]}]}';
    const out = parseSchemeDraft('g', raw);
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]!.name).toBe('C1');
    expect(out.campaigns[0]!.objective).toBe('O1');
    expect(out.campaigns[0]!.subagents).toHaveLength(1);
    expect(out.campaigns[0]!.subagents[0]!.role).toBe('r');
  });
});

describe('parseSchemeDraft — duplicate-name rejection (PKT-771)', () => {
  it('R-771-1: 2 campaigns with same name + 1 dependent → throws duplicate', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'Research', objective: 'topic A', dependsOn: [],         subagents: [] },
        { name: 'Research', objective: 'topic B', dependsOn: [],         subagents: [] },
        { name: 'Build',    objective: 'build',    dependsOn: ['Research'], subagents: [] },
      ],
    });
    expect(() => parseSchemeDraft('g', raw))
      .toThrow(/parseSchemeDraft: duplicate campaign name 'Research'/);
  });

  it('R-771-2: 2 independent campaigns with same name → throws duplicate', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'Research', objective: 'A', dependsOn: [], subagents: [] },
        { name: 'Research', objective: 'B', dependsOn: [], subagents: [] },
      ],
    });
    expect(() => parseSchemeDraft('g', raw))
      .toThrow(/parseSchemeDraft: duplicate campaign name 'Research'/);
  });

  it('R-771-3: 3 campaigns where the duplicate is the LAST one → throws', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'A', objective: 'o', dependsOn: [], subagents: [] },
        { name: 'B', objective: 'o', dependsOn: [], subagents: [] },
        { name: 'A', objective: 'o', dependsOn: [], subagents: [] },
      ],
    });
    expect(() => parseSchemeDraft('g', raw))
      .toThrow(/parseSchemeDraft: duplicate campaign name 'A'/);
  });

  it('R-771-4: unique names across all campaigns parse successfully (regression)', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'ResearchA', objective: 'o', dependsOn: [],                       subagents: [] },
        { name: 'ResearchB', objective: 'o', dependsOn: [],                       subagents: [] },
        { name: 'Build',     objective: 'o', dependsOn: ['ResearchA', 'ResearchB'], subagents: [] },
      ],
    });
    expect(() => parseSchemeDraft('g', raw)).not.toThrow();
  });

  it('R-771-5: case-sensitive duplicate (Research vs research) is ALLOWED', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      campaigns: [
        { name: 'Research', objective: 'o', dependsOn: [], subagents: [] },
        { name: 'research', objective: 'o', dependsOn: [], subagents: [] },
      ],
    });
    expect(() => parseSchemeDraft('g', raw)).not.toThrow();
  });
});

describe('parseSchemeDraft — prose-wrapped extraction (PKT-931)', () => {
  // R-931-1: extracts multi-campaign scheme from JSON with leading + trailing prose.
  // Mirrors parseSubGoals' parseModelJson prose-wrap path (utils.ts:111-116).
  // Defect: without PKT-931 fix, returns single "Main Campaign" fallback.
  it('R-931-1: extracts scheme from JSON with leading + trailing prose', () => {
    const validScheme = {
      rationale: 'multi-campaign plan',
      campaigns: [
        { name: 'research',  objective: 'find sources',     dependsOn: [], subagents: [
          { role: 'Researcher', domain: 'web', knowledgeBase: '', martianTags: ['web_search'] }
        ]},
        { name: 'synthesis', objective: 'combine findings', dependsOn: ['research'], subagents: [
          { role: 'Writer', domain: 'writing', knowledgeBase: '', martianTags: ['file_write'] }
        ]},
      ],
    };
    const proseWrapped = `Sure! Here is the plan:\n${JSON.stringify(validScheme)}\nLet me know.`;
    const out = parseSchemeDraft('goal-1', proseWrapped);
    expect(out.campaigns).toHaveLength(2);
    expect(out.campaigns.map(c => c.name)).toEqual(['research', 'synthesis']);
  });

  // R-931-2: extracts scheme from JSON with leading prose only.
  it('R-931-2: extracts scheme from JSON with leading prose only', () => {
    const validScheme = {
      rationale: 'r',
      campaigns: [
        { name: 'a', objective: 'oa', dependsOn: [], subagents: [] },
        { name: 'b', objective: 'ob', dependsOn: ['a'], subagents: [] },
      ],
    };
    const leadingOnly = `Here is the JSON you requested:\n${JSON.stringify(validScheme)}`;
    const out = parseSchemeDraft('goal-2', leadingOnly);
    expect(out.campaigns).toHaveLength(2);
    expect(out.campaigns.map(c => c.name)).toEqual(['a', 'b']);
  });

  // R-931-3: extracts scheme from JSON with trailing prose only.
  it('R-931-3: extracts scheme from JSON with trailing prose only', () => {
    const validScheme = {
      rationale: 'r',
      campaigns: [
        { name: 'a', objective: 'oa', dependsOn: [], subagents: [] },
        { name: 'b', objective: 'ob', dependsOn: ['a'], subagents: [] },
      ],
    };
    const trailingOnly = `${JSON.stringify(validScheme)}\nHope that helps!`;
    const out = parseSchemeDraft('goal-3', trailingOnly);
    expect(out.campaigns).toHaveLength(2);
  });

  // R-931-4: dependsOn resolution still works after prose extraction.
  it('R-931-4: dependsOn name → UUID resolution still works after prose extraction', () => {
    const validScheme = {
      rationale: 'r',
      campaigns: [
        { name: 'research',  objective: 'find',    dependsOn: [],           subagents: [] },
        { name: 'synthesis', objective: 'combine', dependsOn: ['research'], subagents: [] },
      ],
    };
    const wrapped = `Here you go:\n${JSON.stringify(validScheme)}\nDone.`;
    const out = parseSchemeDraft('goal-4', wrapped);
    expect(out.campaigns[1]!.dependsOn).toEqual([out.campaigns[0]!.id]);
  });

  // R-931-5: cycle detection (PKT-667) still throws after prose extraction.
  it('R-931-5: cycle detection still throws after prose extraction', () => {
    const cyclic = {
      rationale: 'cyclic',
      campaigns: [
        { name: 'A', objective: 'a', dependsOn: ['B'], subagents: [] },
        { name: 'B', objective: 'b', dependsOn: ['A'], subagents: [] },
      ],
    };
    const wrapped = `Prose: ${JSON.stringify(cyclic)} end.`;
    expect(() => parseSchemeDraft('goal-5', wrapped)).toThrow(/cyclic/);
  });

  // R-931-6: PKT-771 duplicate-name rejection still throws after prose extraction.
  it('R-931-6: PKT-771 duplicate-name rejection still throws after prose extraction', () => {
    const dup = {
      rationale: 'dup',
      campaigns: [
        { name: 'X', objective: 'x', dependsOn: [], subagents: [] },
        { name: 'X', objective: 'y', dependsOn: [], subagents: [] },
      ],
    };
    const wrapped = `${JSON.stringify(dup)} trailing`;
    expect(() => parseSchemeDraft('goal-6', wrapped)).toThrow(/duplicate/);
  });

  // R-931-7: PKT-422 strict validation throws still work after prose extraction.
  it('R-931-7: PKT-422 strict validation still throws on prose-wrapped wrong-root array', () => {
    const wrongRoot = JSON.stringify(['this', 'is', 'an', 'array']);
    const wrapped = `Leading: ${wrongRoot}`;
    expect(() => parseSchemeDraft('goal-7', wrapped)).toThrow(/expected JSON object/);
  });

  // R-931-8: fast path unchanged — clean JSON parses with same structure.
  it('R-931-8: fast path unchanged — clean JSON parses with same structure', () => {
    const validScheme = {
      rationale: 'r',
      campaigns: [
        { name: 'a', objective: 'oa', dependsOn: [], subagents: [] },
        { name: 'b', objective: 'ob', dependsOn: ['a'], subagents: [] },
      ],
    };
    const raw = JSON.stringify(validScheme);
    const out = parseSchemeDraft('goal-a', raw);
    expect(out.campaigns).toHaveLength(2);
    expect(out.campaigns.map(c => c.name)).toEqual(['a', 'b']);
    // dependsOn resolves to first-campaign's UUID
    expect(out.campaigns[1]!.dependsOn).toEqual([out.campaigns[0]!.id]);
  });
});
