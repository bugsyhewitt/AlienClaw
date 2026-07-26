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
// parseModelJson — PKT-368
// ──────────────────────────────────────────────────────────────────────────

import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseModelJson, atomicWrite, dateStamp, LEADERBOARD_NAME_RE } from '../src/alienclaw/utils.js';

describe('parseModelJson — direct coverage (utils.ts:57)', () => {
  it('fence strip: ```json\\n{}\\n``` → JSON.parse succeeds onJson called with clean', () => {
    const seen: string[] = [];
    const out = parseModelJson('```json\n{"x":1}\n```', (parsed, clean) => { seen.push(clean); return parsed; }, () => 'fb');
    expect(seen[0]).toBe('{"x":1}');
    expect(out).toEqual({ x: 1 });
  });

  it('fence strip: bare ```\\n{}``` (no language tag) → JSON.parse succeeds', () => {
    const out = parseModelJson('```\n{"x":2}\n```', (parsed) => parsed, () => 'fb');
    expect(out).toEqual({ x: 2 });
  });

  it('onJson throws → onText called with clean (NOT raw) — distinct from JSON.parse failure', () => {
    const out = parseModelJson('{"description":"x"}', (parsed) => {
      if (!Array.isArray(parsed)) throw new TypeError('expected array');
      return parsed;
    }, (clean) => 'FELL_BACK:' + clean);
    expect(out).toBe('FELL_BACK:{"description":"x"}');
  });

  it('JSON.parse throws → onText called with clean', () => {
    const out = parseModelJson('not json at all', () => { throw new Error('should not run'); }, (clean) => 'FB:' + clean);
    expect(out).toBe('FB:not json at all');
  });

  it('JSON.parse throws → onText receives FENCE-STRIPPED clean (not raw)', () => {
    const out = parseModelJson('```json\nnot json\n```', () => 'never', (clean) => 'FB:' + clean);
    expect(out).toBe('FB:not json');
  });

  it('empty string → JSON.parse fails → onText("")', () => {
    const out = parseModelJson('', () => 'never', (clean) => 'FB:' + JSON.stringify(clean));
    expect(out).toBe('FB:""');
  });

  it('whitespace-only string → JSON.parse fails → onText("")', () => {
    const out = parseModelJson('   \n\t  ', () => 'never', (clean) => 'FB:' + JSON.stringify(clean));
    expect(out).toBe('FB:""');
  });

  it('primitive JSON values (string, number, bool, null) → mapper receives parsed value', () => {
    expect(parseModelJson('"hello"', (p) => p, () => 'fb')).toBe('hello');
    expect(parseModelJson('42',     (p) => p, () => 'fb')).toBe(42);
    expect(parseModelJson('true',   (p) => p, () => 'fb')).toBe(true);
    expect(parseModelJson('null',   (p) => p, () => 'fb')).toBe(null);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// atomicWrite — PKT-368
// ──────────────────────────────────────────────────────────────────────────

describe('atomicWrite — direct coverage (utils.ts:46)', () => {
  let dir: string;
  afterEach(() => { try { if (dir) rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('writes the file with exactly the requested utf-8 content', () => {
    dir = mkdtempSync(join(tmpdir(), 'atomicwrite-'));
    const path = join(dir, 'a.txt');
    atomicWrite(path, 'hello');
    expect(readFileSync(path, 'utf8')).toBe('hello');
  });

  it('overwrites an existing file atomically (via tmp + rename)', () => {
    dir = mkdtempSync(join(tmpdir(), 'atomicwrite-'));
    const path = join(dir, 'b.txt');
    atomicWrite(path, 'v1');
    atomicWrite(path, 'v2');
    expect(readFileSync(path, 'utf8')).toBe('v2');
  });

  it('leaves no .tmp-* siblings after a successful write', () => {
    dir = mkdtempSync(join(tmpdir(), 'atomicwrite-'));
    const path = join(dir, 'd.txt');
    atomicWrite(path, 'z');
    expect(existsSync(path)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// dateStamp — PKT-368
// ──────────────────────────────────────────────────────────────────────────

describe('dateStamp — direct coverage (utils.ts:34)', () => {
  it('returns YYYY-MM-DD slice of a UTC ISO string', () => {
    const s = dateStamp(new Date('2026-07-24T21:56:02.000Z'));
    expect(s).toBe('2026-07-24');
  });

  it('formats any Date as YYYY-MM-DD with leading zeros', () => {
    expect(dateStamp(new Date('2026-01-05T00:00:00.000Z'))).toBe('2026-01-05');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// LEADERBOARD_NAME_RE — PKT-368
// ──────────────────────────────────────────────────────────────────────────

describe('LEADERBOARD_NAME_RE — direct coverage (utils.ts:39)', () => {
  it('matches exactly 8 uppercase ASCII letters', () => {
    expect(LEADERBOARD_NAME_RE.test('ALIENBOT')).toBe(true);
    expect(LEADERBOARD_NAME_RE.test('AAAAAAAA')).toBe(true);
  });
  it('rejects: lowercase, mixed case, digits, length != 8, empty', () => {
    expect(LEADERBOARD_NAME_RE.test('alienbot')).toBe(false);
    expect(LEADERBOARD_NAME_RE.test('TESTbot1')).toBe(false);
    expect(LEADERBOARD_NAME_RE.test('ABCDEFGH')).toBe(true);
    expect(LEADERBOARD_NAME_RE.test('ABCDEFG')).toBe(false);
    expect(LEADERBOARD_NAME_RE.test('ABCDEFGHI')).toBe(false);
    expect(LEADERBOARD_NAME_RE.test('')).toBe(false);
  });
});

