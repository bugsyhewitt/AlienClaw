/**
 * advisorbot-advise.test.mts — unit tests for AdvisorBot.advise() in
 * src/alienclaw/agents/advisorbot.ts:94-107. Packet PKT-686.
 *
 * Covers the 4 uncovered paths in advise():
 *   A1 — taskId supplied, session pre-populated → JSON response parsed correctly
 *   A2 — taskId supplied, LLM returns plain text → fallback AdviceResponse
 *   B1 — taskId omitted → raw Context/Question shape, no "Previous exchanges:" prefix
 *   B2 — taskId omitted, LLM throws → error propagates to caller
 *
 * Mocking pattern is identical to test/agents/bossbot-class.test.ts:14-22:
 *   vi.hoisted + vi.mock on 'host-select.js' before ESM import resolution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── LLM boundary mock ──────────────────────────────────────────────────────────
// vi.hoisted initialises mockComplete before vi.mock's factory executes.
const mockComplete = vi.hoisted(() => vi.fn());

vi.mock('../../src/alienclaw/wiring/host-select.js', () => ({
  selectHost: () => ({ llm: () => ({ complete: mockComplete }) }),
}));

// Import AFTER vi.mock so the mock is in place at module-resolve time.
import { AdvisorBot } from '../../src/alienclaw/agents/advisorbot.js';

// ── Branch A — taskId supplied ─────────────────────────────────────────────────

describe('AdvisorBot.advise() — taskId branch (A)', () => {
  beforeEach(() => mockComplete.mockReset());

  it('A1: JSON response → parsed AdviceResponse; session history included in userContent', async () => {
    mockComplete.mockResolvedValue(JSON.stringify({
      verdict:        'reduce mutation rate',
      confidence:     'high',
      blindspots:     ['N=1 sample'],
      recommendation: 'dampen xcode_index by 0.05',
    }));

    const bot = new AdvisorBot();

    // Pre-populate so buildContext includes "Previous exchanges:" in userContent.
    bot.appendToSession('BossBot', 'task-A', {
      from: 'BossBot', to: 'AdvisorBot',
      content: 'previous question', ts: 0,
    });

    const resp = await bot.advise(
      { requesterId: 'BossBot', context: 'gen=3, fitness=0.45', question: 'why low?' },
      'task-A',
    );

    expect(resp.verdict).toBe('reduce mutation rate');
    expect(resp.confidence).toBe('high');
    expect(resp.blindspots).toEqual(['N=1 sample']);
    expect(resp.recommendation).toBe('dampen xcode_index by 0.05');

    // Verify 3-arg call shape: (agentName, systemPrompt, userContent)
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [agent, systemPrompt, userContent] = mockComplete.mock.calls[0]!;
    expect(agent).toBe('AdvisorBot');
    expect(systemPrompt).toBe(bot.soul);
    expect(userContent).toContain('Previous exchanges:');
    expect(userContent).toContain('Question:\nwhy low?');
  });

  it('A2: plain-text LLM response → fallback AdviceResponse with verdict=raw text', async () => {
    mockComplete.mockResolvedValue('plain-text fallback verdict');

    const bot = new AdvisorBot();
    const resp = await bot.advise(
      { requesterId: 'BossBot', context: 'gen=3', question: 'q' },
      'task-A2',
    );

    expect(resp.verdict).toBe('plain-text fallback verdict');
    expect(resp.confidence).toBe('medium');
    expect(resp.blindspots).toEqual([]);
    expect(resp.recommendation).toBe('');
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete.mock.calls[0]![0]).toBe('AdvisorBot');
  });
});

// ── Branch B — no taskId ───────────────────────────────────────────────────────

describe('AdvisorBot.advise() — no-taskId branch (B)', () => {
  beforeEach(() => mockComplete.mockReset());

  it('B1: userContent uses raw Context/Question shape; no "Previous exchanges:" prefix', async () => {
    mockComplete.mockResolvedValue(
      '{"verdict":"x","confidence":"low","blindspots":[],"recommendation":""}',
    );

    const bot = new AdvisorBot();
    await bot.advise({ requesterId: 'CreatorBot', context: 'no-task-id', question: 'one-shot' });

    expect(mockComplete).toHaveBeenCalledTimes(1);
    const userContent = mockComplete.mock.calls[0]![2] as string;
    expect(userContent).toContain('Context:\nno-task-id');
    expect(userContent).toContain('Question:\none-shot');
    expect(userContent.includes('Previous exchanges:')).toBe(false);
    expect(mockComplete.mock.calls[0]![0]).toBe('AdvisorBot');
    expect(mockComplete.mock.calls[0]![1]).toBe(bot.soul);
  });

  it('B2: LLM provider error → advise() rejects without swallowing', async () => {
    mockComplete.mockImplementationOnce(() => Promise.reject(new Error('openclaw 503')));

    const bot = new AdvisorBot();
    await expect(
      bot.advise({ requesterId: 'CreatorBot', context: 'x', question: 'q' }),
    ).rejects.toThrow('openclaw 503');
  });
});
