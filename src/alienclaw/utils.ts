/**
 * Shared utilities for the AlienClaw runtime.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join }                                    from 'node:path';
import { randomUUID }               from 'node:crypto';
import type { AssistantMessage, TextContent } from '@mariozechner/pi-ai';

/** Promise-based sleep, used for polling intervals and retry backoff. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Extract plain text from an pi-ai AssistantMessage content array. */
export function extractText(msg: AssistantMessage): string {
  return (msg.content as Array<{ type: string; text?: string }>)
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join('');
}

/** Extract a user-friendly message from an unknown error value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Normalize user input: trim whitespace and lowercase. */
export function normalizeInput(str: string): string {
  return str.trim().toLowerCase();
}

/** UTC date stamp (YYYY-MM-DD), used for date-partitioned dirs and files. */
export function dateStamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Leaderboard handle format: exactly 8 uppercase ASCII letters. */
export const LEADERBOARD_NAME_RE = /^[A-Z]{8}$/;

export function validateLeaderboardName(name: string): boolean {
  return LEADERBOARD_NAME_RE.test(name);
}

/** Write file atomically: mkdir parent, unique tmp sibling → rename, cleanup on failure. */
export function atomicWrite(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = join(dirname(filePath), `.tmp-${randomUUID()}`);
  // PKT-921-fsync: fsync the tmp file before rename so a power-loss after
  // rename returns doesn't leave a zero-byte or partially-written destination.
  // POSIX rename is atomic at the directory-entry level but durability depends
  // on the data being on platter first. Sister audit-log.ts:78 and
  // storage.py:197 both fsync — this helper dropped the pattern.
  // The catch unlinks the tmp on any write/fsync failure to prevent orphans.
  const fd = openSync(tmpPath, 'w');
  try {
    writeFileSync(fd, content, { encoding: 'utf-8' });
    fsyncSync(fd);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* best-effort */ }
    try { closeSync(fd); } catch { /* fd may already be closed */ }
    throw err;
  }
  try { closeSync(fd); } catch { /* best-effort */ }
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* best-effort */ }
    throw err;
  }
}

/**
 * Scan `s` for the first JSON object or array and return that substring, or
 * null if none is found. Handles nested structures and string values containing
 * brackets or escaped quotes without false-closing.
 */
export function extractJsonSubstring(s: string): string | null {
  const start = s.search(/[\[{]/);
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape)         { escape = false; continue; }
    if (c === '\\')     { escape = true;  continue; }
    if (c === '"')      { inString = !inString; continue; }
    if (inString)       continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse LLM output that should be JSON: strip markdown code fences, then
 * JSON.parse. If the whole string fails to parse, attempt JSON-substring
 * extraction to handle prose-wrapped JSON. `onJson` maps the parsed value
 * (it runs inside the try, so a throwing mapper also falls back); `onText`
 * handles non-JSON output. `onJson` must be pure/idempotent — it may be
 * called twice when the fast path finds valid JSON but the mapper throws.
 */
// Overload 1: both callbacks return the same type T (original, backward-compat)
export function parseModelJson<T>(
  raw: string,
  onJson: (parsed: unknown, clean: string) => T,
  onText: (clean: string) => T,
): T;
// Overload 2: callbacks may return distinct types J and S (discriminated-union pattern)
export function parseModelJson<J, S>(
  raw: string,
  onJson: (parsed: unknown, clean: string) => J,
  onText: (clean: string) => S,
): J | S;
export function parseModelJson(
  raw: string,
  onJson: (parsed: unknown, clean: string) => unknown,
  onText: (clean: string) => unknown,
): unknown {
  const clean = raw.replace(/```(?:json)?\n?/g, '').trim();
  try {
    return onJson(JSON.parse(clean), clean);
  } catch {
    const sub = extractJsonSubstring(clean);
    if (sub !== null) {
      try {
        return onJson(JSON.parse(sub), sub);
      } catch { /* fall through */ }
    }
    return onText(clean);
  }
}
