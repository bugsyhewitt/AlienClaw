/**
 * bossbot-class.test.ts — unit tests for BossBot class methods in
 * src/alienclaw/agents/bossbot.ts (lines 116–323). Packet 278.
 *
 * Tier 1 (pure):       systemPrompt, buildTask
 * Tier 2 (LLM-mocked): classifyUserInput, draftScheme, generateSubGoals, schemeWithAdvisor
 *
 * LLM boundary: selectHost().llm().complete(agentName, system, user)
 * from src/alienclaw/wiring/host-select.js — mocked via vi.hoisted + vi.mock.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentChannel } from '../../src/alienclaw/comms/agent-channel.js';

// ── LLM boundary mock ──────────────────────────────────────────────────────────
// vi.hoisted initialises mockComplete before vi.mock's factory executes.
// vi.mock is hoisted by Vitest's transformer before ESM import resolution.

const mockComplete = vi.hoisted(() => vi.fn());

vi.mock('../../src/alienclaw/wiring/host-select.js', () => ({
  selectHost: () => ({ llm: () => ({ complete: mockComplete }) }),
}));

// Import the module under test AFTER vi.mock so the mock is in place.
import { BossBot } from '../../src/alienclaw/agents/bossbot.js';

// ── Shared fixture ────────────────────────────────────────────────────────────

const VALID_SCHEME_JSON = JSON.stringify({
  rationale: 'test rationale',
  campaigns: [{
    name: 'test campaign',
    objective: 'test objective',
    dependsOn: [],
    subagents: [{ role: 'analyst', domain: 'research', knowledgeBase: '', martianTags: [] }],
  }],
});

// ── 1. systemPrompt ───────────────────────────────────────────────────────────

describe('BossBot.systemPrompt()', () => {
  let bot: BossBot;

  beforeEach(() => {
    bot = new BossBot();
    mockComplete.mockReset();
  });

  it('returns a non-empty string (soul file has 3465 chars)', () => {
    const prompt = bot.systemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// ── 2. buildTask ──────────────────────────────────────────────────────────────

describe('BossBot.buildTask()', () => {
  let bot: BossBot;

  beforeEach(() => {
    bot = new BossBot();
    mockComplete.mockReset();
  });

  it('returns a TaskEnvelope with the expected shape', () => {
    const task = bot.buildTask('do a thing', 'research');
    expect(typeof task.taskId).toBe('string');
    expect(task.taskId.length).toBeGreaterThan(0);
    expect(task.description).toBe('do a thing');
    expect(task.domain).toBe('research');
    expect(typeof task.createdAt).toBe('number');
    expect(task.strikeCount).toBe(0);
    expect(task.attempts).toEqual([]);
  });

  it('defaults priority to "normal" when omitted', () => {
    const task = bot.buildTask('do a thing', 'research');
    expect(task.priority).toBe('normal');
  });

  it('uses the supplied priority when provided', () => {
    const task = bot.buildTask('do a thing', 'research', 'high');
    expect(task.priority).toBe('high');
  });

  it('omits campaignId when not provided', () => {
    const task = bot.buildTask('do a thing', 'research');
    expect(task.campaignId).toBeUndefined();
  });

  it('includes campaignId when provided', () => {
    const task = bot.buildTask('do a thing', 'research', 'normal', 'campaign-123');
    expect(task.campaignId).toBe('campaign-123');
  });
});

// ── 3. classifyUserInput ──────────────────────────────────────────────────────

describe('BossBot.classifyUserInput()', () => {
  let bot: BossBot;

  beforeEach(() => {
    bot = new BossBot();
    mockComplete.mockReset();
  });

  it('returns "constraint" when normalizeInput of the LLM reply contains "constraint"', async () => {
    mockComplete.mockResolvedValueOnce('constraint');
    expect(await bot.classifyUserInput('do not use X')).toBe('constraint');
  });

  it('returns "direction_change" when normalizeInput of the LLM reply contains "direction_change"', async () => {
    mockComplete.mockResolvedValueOnce('direction_change');
    expect(await bot.classifyUserInput('let us pivot to Y')).toBe('direction_change');
  });

  it('returns "new_subgoal" when the LLM reply contains neither keyword', async () => {
    mockComplete.mockResolvedValueOnce('new_subgoal');
    expect(await bot.classifyUserInput('also add search')).toBe('new_subgoal');
  });
});

// ── 4. draftScheme ────────────────────────────────────────────────────────────

describe('BossBot.draftScheme()', () => {
  let bot: BossBot;

  beforeEach(() => {
    bot = new BossBot();
    mockComplete.mockReset();
  });

  it('parses and returns a Scheme when the LLM replies with valid JSON', async () => {
    mockComplete.mockResolvedValueOnce(VALID_SCHEME_JSON);
    const scheme = await bot.draftScheme('goal-1', 'build a thing');
    expect(scheme.goalId).toBe('goal-1');
    expect(scheme.rationale).toBe('test rationale');
    expect(scheme.campaigns).toHaveLength(1);
    expect(scheme.campaigns[0]!.name).toBe('test campaign');
    expect(scheme.advisorEndorsement).toBe('');
  });

  it('falls back to a single-campaign scheme when the LLM replies with malformed JSON', async () => {
    mockComplete.mockResolvedValueOnce('not json at all');
    const scheme = await bot.draftScheme('goal-fb', 'build a thing');
    expect(scheme.goalId).toBe('goal-fb');
    expect(scheme.campaigns).toHaveLength(1);
    expect(scheme.campaigns[0]!.name).toBe('Main Campaign');
    expect(scheme.campaigns[0]!.subagents[0]!.role).toBe('Generalist');
    expect(scheme.rationale).toContain('non-JSON');
  });
});

// ── 5. generateSubGoals ───────────────────────────────────────────────────────

describe('BossBot.generateSubGoals()', () => {
  let bot: BossBot;

  beforeEach(() => {
    bot = new BossBot();
    mockComplete.mockReset();
  });

  it('parses and returns SubGoals when the LLM replies with a valid JSON array', async () => {
    const raw = JSON.stringify([
      { description: 'research competitors', domain: 'research', dependsOn: [] },
      { description: 'write report', domain: 'writing', dependsOn: [] },
    ]);
    mockComplete.mockResolvedValueOnce(raw);
    const subGoals = await bot.generateSubGoals('add market research');
    expect(subGoals).toHaveLength(2);
    expect(subGoals[0]!.description).toBe('research competitors');
    expect(subGoals[0]!.domain).toBe('research');
    expect(subGoals[0]!.status).toBe('pending');
    expect(typeof subGoals[0]!.id).toBe('string');
  });
});

// ── 6. schemeWithAdvisor — early return ──────────────────────────────────────

describe('BossBot.schemeWithAdvisor() — early return when confidence is high', () => {
  let bot: BossBot;
  let mockSend: ReturnType<typeof vi.fn>;
  let mockAdvise: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bot = new BossBot();
    mockComplete.mockReset();
    mockSend = vi.fn();
    mockAdvise = vi.fn();
  });

  it('returns the scheme with advisor endorsement on the first round without refining', async () => {
    // draftScheme makes one LLM call
    mockComplete.mockResolvedValueOnce(VALID_SCHEME_JSON);
    // Advisor is highly confident and recommendation has no "should" → early return
    mockAdvise.mockResolvedValueOnce({
      confidence: 'high',
      recommendation: 'looks great',
      verdict: 'Looks solid',
    });

    const mockAgentChannel = { send: mockSend } as unknown as AgentChannel;
    const mockAdvisorBot = { advise: mockAdvise } as unknown as Parameters<BossBot['schemeWithAdvisor']>[2];

    const result = await bot.schemeWithAdvisor('goal-1', 'build a thing', mockAdvisorBot, mockAgentChannel);

    expect(result.advisorEndorsement).toBe('Looks solid');
    // advise called exactly once (early return after round 0)
    expect(mockAdvise).toHaveBeenCalledTimes(1);
    // agentChannel.send called twice: one request + one response
    expect(mockSend).toHaveBeenCalledTimes(2);
    // Only draftScheme issued an LLM call; refineSchemeDraft was never reached
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});

// ── 7. schemeWithAdvisor — full rounds ────────────────────────────────────────

describe('BossBot.schemeWithAdvisor() — full rounds when confidence is not high', () => {
  let bot: BossBot;
  let mockSend: ReturnType<typeof vi.fn>;
  let mockAdvise: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bot = new BossBot();
    mockComplete.mockReset();
    mockSend = vi.fn();
    mockAdvise = vi.fn();
  });

  it('runs all rounds and sets endorsement from the last-round advice verdict (maxRounds=1)', async () => {
    // draftScheme + refineSchemeDraft each make one LLM call → 2 total
    mockComplete.mockResolvedValue(VALID_SCHEME_JSON);
    // Advisor is medium confidence → no early return; round 0 === maxRounds-1 → endorsement set
    mockAdvise.mockResolvedValueOnce({
      confidence: 'medium',
      recommendation: 'should add testing campaign',
      verdict: 'Needs work',
    });

    const mockAgentChannel = { send: mockSend } as unknown as AgentChannel;
    const mockAdvisorBot = { advise: mockAdvise } as unknown as Parameters<BossBot['schemeWithAdvisor']>[2];

    const result = await bot.schemeWithAdvisor('goal-2', 'build a thing', mockAdvisorBot, mockAgentChannel, 1);

    // round 0 === maxRounds(1)-1 === 0 → endorsement is the advice verdict
    expect(result.advisorEndorsement).toBe('Needs work');
    // advise called once (maxRounds=1 → 1 round only)
    expect(mockAdvise).toHaveBeenCalledTimes(1);
    // draftScheme (1) + refineSchemeDraft (1) = 2 LLM calls
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });
});
