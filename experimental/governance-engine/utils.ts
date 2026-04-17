/**
 * Shared utilities for the AlienClaw runtime.
 */

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
