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

  it('parses a validated object with extra unknown fields (extra fields are silently dropped)', () => {
    // All required fields are valid — validation passes; extra fields are dropped. PKT-694 intentional update.
    const raw = JSON.stringify({
      verdict:        'ok',
      confidence:     'high',
      blindspots:     [],
      recommendation: '',
      extraField:     'silently dropped after shape validation',
    });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.verdict).toBe('ok');
    expect(out.confidence).toBe('high');
  });

  it('returns malformed default when JSON object is missing required fields (PKT-694 intentional update)', () => {
    // PKT-694: validateAdviceResponse returns null for missing required fields; parseResponse
    // returns the safe malformed default instead of an AdviceResponse with undefined fields.
    const raw = JSON.stringify({ verdict: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.verdict).toBe('<malformed LLM JSON>');
    expect(out.confidence).toBe('low');
    expect(out.blindspots).toEqual(['advisor_response_shape_mismatch']);
    expect(out.recommendation).toBe('review AdvisorBot output shape');
  });
});

describe('parseResponse — shape validation (PKT-694)', () => {
  const MALFORMED = {
    verdict:        '<malformed LLM JSON>',
    confidence:     'low' as const,
    blindspots:     ['advisor_response_shape_mismatch'],
    recommendation: 'review AdvisorBot output shape',
  };

  it('returns malformed default when JSON is a bare string', () => {
    const out = AdvisorBot.parseResponse(JSON.stringify('x'));
    expect(out).toEqual(MALFORMED);
  });

  it('returns malformed default when JSON is a bare number', () => {
    const out = AdvisorBot.parseResponse(JSON.stringify(42));
    expect(out).toEqual(MALFORMED);
  });

  it('returns malformed default when JSON is bare null', () => {
    const out = AdvisorBot.parseResponse(JSON.stringify(null));
    expect(out).toEqual(MALFORMED);
  });

  it('returns malformed default when JSON is a bare array', () => {
    const out = AdvisorBot.parseResponse(JSON.stringify([1, 2, 3]));
    expect(out).toEqual(MALFORMED);
  });

  it('returns malformed default when JSON is an empty object', () => {
    const out = AdvisorBot.parseResponse(JSON.stringify({}));
    expect(out).toEqual(MALFORMED);
  });

  it('returns malformed default when confidence has wrong case ("High" not in literal union)', () => {
    const out = AdvisorBot.parseResponse(JSON.stringify({
      verdict:        'x',
      confidence:     'High',
      blindspots:     [],
      recommendation: '',
    }));
    expect(out).toEqual(MALFORMED);
  });

  it('returns malformed default when blindspots is not an array (bare number)', () => {
    const out = AdvisorBot.parseResponse(JSON.stringify({
      verdict:        'x',
      confidence:     'high',
      blindspots:     42,
      recommendation: '',
    }));
    expect(out).toEqual(MALFORMED);
  });

  it('returns malformed default when recommendation is null', () => {
    const out = AdvisorBot.parseResponse(JSON.stringify({
      verdict:        'x',
      confidence:     'high',
      blindspots:     [],
      recommendation: null,
    }));
    expect(out).toEqual(MALFORMED);
  });
});
