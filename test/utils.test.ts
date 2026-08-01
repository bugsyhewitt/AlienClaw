/**
 * utils.test.ts — Direct unit tests for the 5 exported functions in
 * src/alienclaw/utils.ts.
 *
 * The utils module is imported by 10 source files (4 governance/, 3 agents/,
 * 2 registry/, 1 msb/) but currently has ZERO direct unit tests (verified
 * 2026-06-19T20:15Z, see packet 063 Grounding Ledger §G-1).
 *
 * Scope: this packet covers the core exported functions.
 *   - sleep(ms)                          — Promise-based timer
 *   - extractText(msg)                   — joins text parts of an AssistantMessage
 *   - errorMessage(err)                  — extracts user-friendly message from unknown
 *   - normalizeInput(str)                — trim + lowercase
 *
 * Reverse-imports and behaviors tested:
 *   - sleep returns a Promise that resolves after >=ms ms (no false-positive on 0ms)
 *   - extractText handles empty arrays, mixed-type arrays, and text-only arrays
 *   - errorMessage extracts .message from Error, returns String(...) for non-Errors
 *   - normalizeInput trims surrounding whitespace and lowercases ASCII
 *
 * Run: ./node_modules/.bin/vitest run test/utils.test.ts
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import {
  sleep,
  extractText,
  errorMessage,
  normalizeInput,
  extractJsonSubstring,
  parseModelJson,
} from '../src/alienclaw/utils.js';

// Build a minimally-typed AssistantMessage that satisfies the type-system (role,
// api, provider, model, usage, stopReason, timestamp) but only carries the
// content[] array we care about. The cast to AssistantMessage is safe because
// extractText only reads content[].type and content[].text.
function msg(content: Array<{ type: string; text?: string; [k: string]: unknown }>): AssistantMessage {
  return {
    role: 'assistant',
    content: content as AssistantMessage['content'],
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt-4',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// sleep
// ──────────────────────────────────────────────────────────────────────────

describe('sleep', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('returns a Promise', () => {
    const p = sleep(0);
    expect(p).toBeInstanceOf(Promise);
    return p;
  });

  it('resolves after at least the requested ms (using real timers)', async () => {
    const start = Date.now();
    await sleep(40);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(38);  // 2ms slop
  });

  it('resolves to undefined (no return value)', async () => {
    const v = await sleep(0);
    expect(v).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// extractText
// ──────────────────────────────────────────────────────────────────────────

describe('extractText', () => {
  it('returns "" for an empty content array', () => {
    expect(extractText(msg([]))).toBe('');
  });

  it('joins text parts in order', () => {
    const m = msg([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ]);
    expect(extractText(m)).toBe('hello world');
  });

  it('filters out non-text parts (tool_use, tool_result, etc.)', () => {
    const m = msg([
      { type: 'text',        text: 'before ' },
      { type: 'tool_use',    id: 'tu_1' },
      { type: 'text',        text: 'after' },
      { type: 'tool_result', id: 'tr_1' },
    ]);
    expect(extractText(m)).toBe('before after');
  });

  it('skips text parts whose text field is undefined (filtered by type-guard)', () => {
    const m = msg([
      { type: 'text', text: 'A' },
      { type: 'text' },                              // no .text — filtered out by c.text
    ]);
    expect(extractText(m)).toBe('A');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// errorMessage
// ──────────────────────────────────────────────────────────────────────────

describe('errorMessage', () => {
  it('returns err.message when given an Error instance', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns String(err) for non-Error values (string, number, object, null)', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage({ code: 'X' })).toBe('[object Object]');
  });

  it('returns "" for an empty string (String("") === "")', () => {
    expect(errorMessage('')).toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// normalizeInput
// ──────────────────────────────────────────────────────────────────────────

describe('normalizeInput', () => {
  it('trims surrounding whitespace and lowercases the rest', () => {
    expect(normalizeInput('  Hello World  ')).toBe('hello world');
  });

  it('lowercases ASCII A-Z and leaves a-z and digits untouched', () => {
    expect(normalizeInput('ABCdef0123')).toBe('abcdef0123');
  });

  it('preserves internal whitespace (only trims edges)', () => {
    expect(normalizeInput('  two  spaces  inside  ')).toBe('two  spaces  inside');
  });

  it('returns "" for whitespace-only input', () => {
    expect(normalizeInput('     ')).toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// extractJsonSubstring
// ──────────────────────────────────────────────────────────────────────────

describe('extractJsonSubstring', () => {
  it('returns null for empty string', () => {
    expect(extractJsonSubstring('')).toBeNull();
  });

  it('returns null for plain text with no JSON bracket', () => {
    expect(extractJsonSubstring('Hello world')).toBeNull();
  });

  it('extracts object substring from string with prose before', () => {
    expect(extractJsonSubstring('Here is: {"a":1}')).toBe('{"a":1}');
  });

  it('extracts array substring from string with prose after', () => {
    expect(extractJsonSubstring('[1,2,3] done.')).toBe('[1,2,3]');
  });

  it('extracts JSON from prose on both sides', () => {
    expect(extractJsonSubstring('Result: {"x":9} ok.')).toBe('{"x":9}');
  });

  it('handles nested objects without premature close', () => {
    expect(extractJsonSubstring('prefix {"a":{"b":1},"c":2} suffix')).toBe('{"a":{"b":1},"c":2}');
  });

  it('handles string values that contain } without closing early', () => {
    const s = '{"key":"val with } brace"}';
    expect(extractJsonSubstring(s)).toBe(s);
  });

  it('handles backslash-escaped quotes inside strings', () => {
    const s = '{"key":"say \\"hi\\""}';
    expect(extractJsonSubstring(s)).toBe(s);
  });

  it('returns null when brackets are unclosed (truncated)', () => {
    expect(extractJsonSubstring('{"a":1')).toBeNull();
  });

  it('extracts array of objects', () => {
    const arr = '[{"id":1},{"id":2}]';
    expect(extractJsonSubstring('prefix ' + arr + ' suffix')).toBe(arr);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// parseModelJson — PKT-493 prose-wrapping coverage
// ──────────────────────────────────────────────────────────────────────────

describe('parseModelJson', () => {
  const jsonCb = (parsed: unknown) => ({ path: 'json' as const, val: parsed });
  const textCb = (clean: string)   => ({ path: 'text' as const, val: clean });

  // shape 1 — fenced json block (regression)
  it('shape 1: parses fenced ```json block', () => {
    const r = parseModelJson('```json\n[{"description":"task 1"}]\n```', jsonCb, textCb);
    expect(r.path).toBe('json');
    expect(r.val).toEqual([{ description: 'task 1' }]);
  });

  // shape 2 — fenced no lang (regression)
  it('shape 2: parses fenced ``` block without language tag', () => {
    const r = parseModelJson('```\n[{"description":"task 1"}]\n```', jsonCb, textCb);
    expect(r.path).toBe('json');
    expect(r.val).toEqual([{ description: 'task 1' }]);
  });

  // shape 3 — prose before → must be JSON path after fix (was TEXT/CORRUPTED before)
  it('shape 3: parses JSON prefixed with prose (extraction path)', () => {
    const r = parseModelJson('Here is the JSON:\n[{"description":"task 1"}]', jsonCb, textCb);
    expect(r.path).toBe('json');
    expect(r.val).toEqual([{ description: 'task 1' }]);
  });

  // shape 4 — trailing text → must be JSON path after fix
  it('shape 4: parses JSON followed by trailing prose (extraction path)', () => {
    const r = parseModelJson('[{"description":"task 1"}]\nHope that helps!', jsonCb, textCb);
    expect(r.path).toBe('json');
    expect(r.val).toEqual([{ description: 'task 1' }]);
  });

  // shape 5 — prose before + JSON + prose after → must be JSON path after fix
  it('shape 5: parses JSON wrapped in prose on both sides (extraction path)', () => {
    const r = parseModelJson(
      'Here is the JSON:\n[{"description":"task 1"}]\nLet me know.',
      jsonCb, textCb,
    );
    expect(r.path).toBe('json');
    expect(r.val).toEqual([{ description: 'task 1' }]);
  });

  // shape 6 — plain JSON (regression)
  it('shape 6: parses plain JSON object (fast path)', () => {
    const r = parseModelJson('{\n  "a": 1\n}', jsonCb, textCb);
    expect(r.path).toBe('json');
    expect(r.val).toEqual({ a: 1 });
  });

  // shape 7 — fenced JSON + trailing text → must be JSON path after fix
  it('shape 7: parses fenced JSON with trailing text after closing fence (extraction path)', () => {
    const r = parseModelJson(
      '```json\n[{"description":"task 1"}]\n```\n\nExtra text',
      jsonCb, textCb,
    );
    expect(r.path).toBe('json');
    expect(r.val).toEqual([{ description: 'task 1' }]);
  });

  // shape 8 — inline backtick-fenced object (regression)
  it('shape 8: parses inline backtick-fenced JSON object', () => {
    const r = parseModelJson('```{"description":"task 1"}```', jsonCb, textCb);
    expect(r.path).toBe('json');
    expect(r.val).toEqual({ description: 'task 1' });
  });

  // shape 9 — single-backtick variant → JSON path after fix (was TEXT/CORRUPTED)
  // extractJsonSubstring finds the [ inside the single-backtick-wrapped string
  it('shape 9: parses JSON from single-backtick-wrapped input (extraction path)', () => {
    const r = parseModelJson('`json\n[{"description":"task 1"}]`', jsonCb, textCb);
    expect(r.path).toBe('json');
    expect(r.val).toEqual([{ description: 'task 1' }]);
  });

  // shape 10 — truncated fence → TEXT
  it('shape 10: falls to text path for truncated/incomplete input', () => {
    const r = parseModelJson('```json', jsonCb, textCb);
    expect(r.path).toBe('text');
  });

  // shape 11 — only fence → TEXT
  it('shape 11: falls to text path for fence-only input', () => {
    const r = parseModelJson('```', jsonCb, textCb);
    expect(r.path).toBe('text');
  });

  it('falls to text path when no JSON present at all', () => {
    const r = parseModelJson('just some prose', jsonCb, textCb);
    expect(r.path).toBe('text');
  });

  it('falls to text path when onJson callback throws', () => {
    const r = parseModelJson('{"a":1}', () => { throw new Error('nope'); }, textCb);
    expect(r.path).toBe('text');
  });
});

