/**
 * Unit tests for the consolidated top-N clamp in the genomes handler.
 *
 * `clampTopN` is the SINGLE source of truth for bounding the caller-supplied
 * `n` on GET /v1/genomes/top. The HTTP router (server.ts) no longer clamps —
 * it parses the query string and passes the raw value straight through — so
 * this function alone is responsible for turning any input an HTTP query can
 * produce into a safe integer in [1, 100] that storage.topForType will accept.
 *
 * These are pure unit tests: zero DB, FS, or env-var dependencies.
 */

import { describe, it, expect } from 'vitest';
import { clampTopN } from '../../src/alienclaw/api/handlers/genomes.js';

describe('clampTopN — single source of truth for the top-N clamp', () => {
  it('passes in-range integers through unchanged', () => {
    expect(clampTopN(1)).toBe(1);
    expect(clampTopN(10)).toBe(10);
    expect(clampTopN(50)).toBe(50);
    expect(clampTopN(100)).toBe(100);
  });

  it('clamps values above the cap down to 100', () => {
    expect(clampTopN(101)).toBe(100);
    expect(clampTopN(1_000)).toBe(100);
    expect(clampTopN(1_000_000)).toBe(100);
  });

  it('clamps values below the floor up to 1', () => {
    expect(clampTopN(0)).toBe(1);
    expect(clampTopN(-1)).toBe(1);
    expect(clampTopN(-9_999)).toBe(1);
  });

  it('floors non-integer values to an integer within range', () => {
    expect(clampTopN(2.5)).toBe(2);
    expect(clampTopN(99.9)).toBe(99);
    expect(clampTopN(0.4)).toBe(1);   // floors to 0, then clamps up to 1
    expect(clampTopN(100.9)).toBe(100);
  });

  it('falls back to the default (10) for non-finite input', () => {
    expect(clampTopN(Number.NaN)).toBe(10);
    expect(clampTopN(Number.POSITIVE_INFINITY)).toBe(10);
    expect(clampTopN(Number.NEGATIVE_INFINITY)).toBe(10);
  });

  it('always yields an integer in [1, 100] — the exact contract topForType asserts', () => {
    const probes = [
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      -1e9, -1, 0, 0.1, 0.9, 1, 1.5, 10, 50, 99.99, 100, 100.0001, 101, 1e9,
    ];
    for (const p of probes) {
      const out = clampTopN(p);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(1);
      expect(out).toBeLessThanOrEqual(100);
    }
  });
});
