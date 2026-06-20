/**
 * utils.test.ts — Direct unit tests for the 5 exported functions in
 * src/alienclaw/utils.ts.
 *
 * The utils module is imported by 10 source files (4 governance/, 3 agents/,
 * 2 registry/, 1 msb/) but currently has ZERO direct unit tests (verified
 * 2026-06-19T20:15Z, see packet 063 Grounding Ledger §G-1).
 *
 * Scope: this packet covers ONLY the 5 exported functions.
 *   - sleep(ms)                          — Promise-based timer
 *   - extractText(msg)                   — joins text parts of an AssistantMessage
 *   - errorMessage(err)                  — extracts user-friendly message from unknown
 *   - normalizeInput(str)                — trim + lowercase
 *   - generateIdSuffix()                 — 8-char uppercase hex from crypto.randomUUID
 *
 * Reverse-imports and behaviors tested:
 *   - sleep returns a Promise that resolves after >=ms ms (no false-positive on 0ms)
 *   - extractText handles empty arrays, mixed-type arrays, and text-only arrays
 *   - errorMessage extracts .message from Error, returns String(...) for non-Errors
 *   - normalizeInput trims surrounding whitespace and lowercases ASCII
 *   - generateIdSuffix returns an 8-char [0-9A-F]+ string (uuid hex slice+upper)
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
  generateIdSuffix,
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
// generateIdSuffix
// ──────────────────────────────────────────────────────────────────────────

describe('generateIdSuffix', () => {
  it('returns an 8-character string', () => {
    expect(generateIdSuffix()).toHaveLength(8);
  });

  it('returns only uppercase hex characters [0-9A-F]', () => {
    const s = generateIdSuffix();
    expect(/^[0-9A-F]{8}$/.test(s)).toBe(true);
  });

  it('returns a different value on each call (probabilistic — uuid slice)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateIdSuffix());
    // 50 calls of 8-char hex → collision probability ≈ 50²/(2·16^8) ≈ 3e-6
    expect(seen.size).toBeGreaterThanOrEqual(49);
  });
});
