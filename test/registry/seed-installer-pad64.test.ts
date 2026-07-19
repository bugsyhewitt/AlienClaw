import { describe, it, expect } from 'vitest';
import { pad64 } from '../../src/alienclaw/registry/seed-installer.js';

describe('pad64 — section body validator', () => {
  it('pads a short string to exactly 64 chars', () => {
    const result = pad64('WEB00001G1AlienClaw1WebSearchFamily');
    expect(result).toHaveLength(64);
    expect(result.startsWith('WEB00001G1AlienClaw1WebSearchFamily')).toBe(true);
    expect(result).toMatch(/^[A-Za-z0-9]+0*$/);
  });

  it('accepts a string of exactly 64 chars without padding', () => {
    const s = 'A'.repeat(64);
    const result = pad64(s);
    expect(result).toHaveLength(64);
    expect(result).toBe(s);
  });

  it('throws when string exceeds 64 chars (the cold arm)', () => {
    const overlong = 'A'.repeat(65);
    expect(() => pad64(overlong)).toThrow(
      /Seed section "AAAAAAAAAAAAAAAAAAAA…" is 65 chars \(max 64\)/
    );
  });

  it('throw message includes truncated prefix and actual length', () => {
    const s = 'X'.repeat(80);
    let caught: Error | null = null;
    try { pad64(s); } catch (e) { caught = e as Error; }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('80 chars');
    expect(caught!.message).toContain('max 64');
  });
});
