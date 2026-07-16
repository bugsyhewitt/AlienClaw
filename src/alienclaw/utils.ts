/**
 * Shared utilities for the AlienClaw runtime.
 */

import { renameSync, writeFileSync } from 'node:fs';
import { dirname, join }            from 'node:path';
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

/** Write file atomically: unique tmp sibling → rename. */
export function atomicWrite(filePath: string, content: string): void {
  const tmpPath = join(dirname(filePath), `.tmp-${randomUUID()}`);
  writeFileSync(tmpPath, content, { encoding: 'utf-8' });
  renameSync(tmpPath, filePath);
}

/**
 * Parse LLM output that should be JSON: strip markdown code fences, then
 * JSON.parse. `onJson` maps the parsed value (it runs inside the try, so a
 * throwing mapper also falls back); `onText` handles non-JSON output.
 */
export function parseModelJson<T>(
  raw: string,
  onJson: (parsed: unknown, clean: string) => T,
  onText: (clean: string) => T,
): T {
  const clean = raw.replace(/```(?:json)?\n?/g, '').trim();
  try {
    return onJson(JSON.parse(clean), clean);
  } catch {
    return onText(clean);
  }
}
