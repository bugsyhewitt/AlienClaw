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

  it('parses a JSON object missing optional fields — defaults applied by shape coercion (PKT-659)', () => {
    // PKT-659: parseResponse now validates shape and applies safe defaults.
    // Before this packet, fields missing from the JSON were silently undefined.
    // After this packet, missing fields are coerced to match the non-JSON fallback.
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
});
