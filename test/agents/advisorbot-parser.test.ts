/**
 * advisorbot-parser.test.ts — unit tests for the LLM-output parser
 * `AdvisorBot.parseResponse` in src/alienclaw/agents/advisorbot.ts (line 78).
 * This is the graceful-degradation path called from `advise()` (line 124)
 * after the LLM responds. It is the safety net for non-JSON LLM output and
 * currently has zero direct tests. Packet 052.
 */
import { describe, it, expect }    from 'vitest';
import { AdvisorBot }              from '../../src/alienclaw/agents/advisorbot.js';
import type { AdviceResponse }     from '../../src/alienclaw/types.js';

describe('AdvisorBot.parseResponse (agents/advisorbot.ts:78)', () => {
  it('parses a well-formed JSON object into AdviceResponse', () => {
    const raw = JSON.stringify({
      verdict:        'greenlight',
      confidence:     'high',
      blindspots:     ['edge case X', 'unforeseen cost Y'],
      recommendation: 'proceed with caution',
    });
    const out: AdviceResponse = AdvisorBot.parseResponse(raw);
    expect(out.verdict).toBe('greenlight');
    expect(out.confidence).toBe('high');
    expect(out.blindspots).toEqual(['edge case X', 'unforeseen cost Y']);
    expect(out.recommendation).toBe('proceed with caution');
  });

  it('accepts a low-confidence AdviceResponse', () => {
    const raw = JSON.stringify({
      verdict:        'revise',
      confidence:     'low',
      blindspots:     ['budget'],
      recommendation: 'add buffer',
    });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.confidence).toBe('low');
    expect(out.verdict).toBe('revise');
  });

  it('accepts a medium-confidence AdviceResponse', () => {
    const raw = JSON.stringify({
      verdict:        'proceed',
      confidence:     'medium',
      blindspots:     [],
      recommendation: '',
    });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.confidence).toBe('medium');
    expect(out.blindspots).toEqual([]);
  });

  it('strips ```json markdown fences before parsing', () => {
    const raw = '```json\n' + JSON.stringify({
      verdict:        'proceed',
      confidence:     'high',
      blindspots:     [],
      recommendation: 'ok',
    }) + '\n```';
    const out = AdvisorBot.parseResponse(raw);
    expect(out.verdict).toBe('proceed');
    expect(out.confidence).toBe('high');
  });

  it('strips bare ``` fences before parsing', () => {
    const raw = '```\n' + JSON.stringify({
      verdict:        'proceed',
      confidence:     'high',
      blindspots:     [],
      recommendation: 'ok',
    }) + '\n```';
    const out = AdvisorBot.parseResponse(raw);
    expect(out.verdict).toBe('proceed');
  });

  it('falls back to a default AdviceResponse on malformed JSON', () => {
    const out = AdvisorBot.parseResponse('not json at all');
    expect(out.verdict).toBe('not json at all');
    expect(out.confidence).toBe('medium');
    expect(out.blindspots).toEqual([]);
    expect(out.recommendation).toBe('');
  });

  it('falls back to default when JSON is partial (truncated)', () => {
    const out = AdvisorBot.parseResponse('{"verdict": "proc');
    expect(out.confidence).toBe('medium');
    expect(out.blindspots).toEqual([]);
    expect(out.recommendation).toBe('');
  });

  it('falls back to default on empty string', () => {
    const out = AdvisorBot.parseResponse('');
    // empty string is falsy after trim → falls back to raw.trim() = ''
    expect(out.verdict).toBe('');
    expect(out.confidence).toBe('medium');
    expect(out.blindspots).toEqual([]);
    expect(out.recommendation).toBe('');
  });

  it('falls back to default on whitespace-only string', () => {
    const out = AdvisorBot.parseResponse('   \n\t  ');
    expect(out.verdict).toBe('');
    expect(out.confidence).toBe('medium');
  });

  it('preserves verdict text that contains prose with punctuation on fallback', () => {
    const out = AdvisorBot.parseResponse('Proceed, but watch out for edge case Y!');
    expect(out.verdict).toBe('Proceed, but watch out for edge case Y!');
    expect(out.confidence).toBe('medium');
    expect(out.blindspots).toEqual([]);
  });

  it('parses an object with extra unknown fields without modification (passthrough)', () => {
    const raw = JSON.stringify({
      verdict:        'ok',
      confidence:     'high',
      blindspots:     [],
      recommendation: '',
      // AdvisorBot.parseResponse does not validate; it just JSON.parse casts.
      extraField:     'should be silently ignored by TS cast',
    });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.verdict).toBe('ok');
    expect(out.confidence).toBe('high');
  });

  it('parses a JSON object missing optional fields (relies on type cast)', () => {
    // The current implementation does NOT validate the AdviceResponse shape
    // on the happy path; it just `JSON.parse(...) as AdviceResponse`. This
    // test pins that behavior so a future refactor that adds validation is
    // intentional (not silent).
    const raw = JSON.stringify({ verdict: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.verdict).toBe('ok');
  });
});
