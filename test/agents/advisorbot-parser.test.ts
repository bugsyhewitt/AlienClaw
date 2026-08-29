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
      // validateAdviceResponse constructs a new AdviceResponse object; extra
      // fields are not copied through (not a bug — they were never part of the type).
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
    expect(out.verdict).toBe('ok');
    expect(out.confidence).toBe('medium');
    expect(out.blindspots).toEqual([]);
    expect(out.recommendation).toBe('');
  });
});

// ── PKT-659: shape coercion on malformed-shape LLM JSON ──────────────────────
//
// LLMs occasionally emit well-formed JSON with the wrong *types* for fields
// (e.g., number where string expected, null where literal union expected).
// Before PKT-659, those values passed through as-is and crashed/misrouted
// downstream consumers. After PKT-659, parseResponse coerces every field to
// a safe type before returning, matching the non-JSON fallback defaults.

describe('AdvisorBot.parseResponse — shape coercion (PKT-659)', () => {
  // ── Scenario A: non-string recommendation (number) ──────────────────────────
  // Before fix: out.recommendation === 42 (number), crashes at bossbot.ts:322
  // via normalizeInput(advice.recommendation).includes('should') (trim on non-string)
  it('coerces non-string recommendation (number) to empty string', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: 'high', blindspots: [], recommendation: 42 });
    const out = AdvisorBot.parseResponse(raw);
    expect(typeof out.recommendation).toBe('string');
    expect(out.recommendation).toBe('');
  });

  it('coerces non-string recommendation (object) to empty string', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: 'high', blindspots: [], recommendation: { foo: 'bar' } });
    const out = AdvisorBot.parseResponse(raw);
    expect(typeof out.recommendation).toBe('string');
    expect(out.recommendation).toBe('');
  });

  // ── Scenario B: non-literal confidence ──────────────────────────────────────
  // Before fix: advice.confidence === 'low' is false on null → silent misroute
  // in governance-loop.ts:567 (failure routed to REBUILD instead of SURFACE_USER)
  it('coerces null confidence to "medium"', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: null, blindspots: [], recommendation: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.confidence).toBe('medium');
  });

  it('coerces integer confidence to "medium"', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: 42, blindspots: [], recommendation: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.confidence).toBe('medium');
  });

  it('coerces unknown string confidence to "medium" ("unknown")', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: 'unknown', blindspots: [], recommendation: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.confidence).toBe('medium');
  });

  it('preserves valid "low" confidence literal', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: 'low', blindspots: [], recommendation: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.confidence).toBe('low');
  });

  it('preserves valid "high" confidence literal', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: 'high', blindspots: [], recommendation: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.confidence).toBe('high');
  });

  // ── Scenario C: non-array blindspots ────────────────────────────────────────
  // Before fix: advice.blindspots is a string — breaks any future .map() caller
  it('coerces string blindspots to []', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: 'high', blindspots: 'a single string instead of array', recommendation: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(Array.isArray(out.blindspots)).toBe(true);
    expect(out.blindspots).toEqual([]);
  });

  it('coerces null blindspots to []', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: 'high', blindspots: null, recommendation: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.blindspots).toEqual([]);
  });

  it('coerces missing blindspots to []', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: 'high', recommendation: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.blindspots).toEqual([]);
  });

  it('filters non-string items from blindspots array', () => {
    const raw = JSON.stringify({ verdict: 'ok', confidence: 'high', blindspots: ['a', 42, null, 'b'], recommendation: 'ok' });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.blindspots).toEqual(['a', 'b']);
  });

  // ── Scenario D: all fields missing ─────────────────────────────────────────
  // verdict falls back to raw.trim() (matches non-JSON fallback), rest to defaults
  it('coerces all-missing fields to safe defaults (verdict → raw.trim())', () => {
    const raw = '{"extraField":"whatever"}';
    const out = AdvisorBot.parseResponse(raw);
    expect(out.verdict).toBe(raw);
    expect(out.confidence).toBe('medium');
    expect(out.blindspots).toEqual([]);
    expect(out.recommendation).toBe('');
  });

  // ── Consumer safety: these verify the fix prevents the live crash/misroute ──

  it('result recommendation is always string-safe for .includes() — bossbot:322 path', () => {
    // Before fix: recommendation: 99 → normalizeInput(99).includes('should') → TypeError
    // After fix: recommendation coerced to '' → safe
    const raw = JSON.stringify({ verdict: 'bad', confidence: null, recommendation: 99, blindspots: 'string' });
    const out = AdvisorBot.parseResponse(raw);
    expect(() => out.recommendation.includes('should')).not.toThrow();
    expect(() => out.recommendation.trim()).not.toThrow();
  });

  it('null confidence coerces to "medium" so governance-loop:567 is never a silent misroute', () => {
    // Before fix: advice.confidence was null → `=== 'low'` was false → silently didn't
    // surface to user even when confidence was absent/malformed
    // After fix: null → 'medium'; value is always a valid literal
    const raw = JSON.stringify({ verdict: 'escalate', confidence: null, recommendation: 'ok', blindspots: [] });
    const out = AdvisorBot.parseResponse(raw);
    expect(out.confidence).not.toBeNull();
    expect(['low', 'medium', 'high'] as const).toContain(out.confidence);
    // Specifically 'medium' (not 'low'), consistent with non-JSON fallback default
    expect(out.confidence).toBe('medium');
  });

  // ── AC3: top-level non-object JSON values ───────────────────────────────────
  // JSON.parse can succeed with non-object top-level values (null, 42, []).
  // validateAdviceResponse's first guard handles these: returns safe defaults.
  it('handles top-level JSON array (falls back to safe defaults with raw as verdict)', () => {
    const raw = '[1, 2, 3]';
    const out = AdvisorBot.parseResponse(raw);
    expect(out.verdict).toBe(raw);
    expect(out.confidence).toBe('medium');
    expect(out.blindspots).toEqual([]);
    expect(out.recommendation).toBe('');
  });

  it('handles top-level JSON null (falls back to safe defaults with raw as verdict)', () => {
    const out = AdvisorBot.parseResponse('null');
    expect(out.verdict).toBe('null');
    expect(out.confidence).toBe('medium');
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

