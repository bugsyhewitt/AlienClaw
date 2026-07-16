/**
 * genome-codec.test.ts — Direct unit tests for the 4 lifecycle functions of
 * src/alienclaw/registry/genome-codec.ts.
 *
 * The codec holds the "HARD INVARIANTS" of the 256-char Base62 Martian
 * genome format (per source header, lines 1-19). The 4 lifecycle functions
 * — computeChecksum, parseGenome, assembleGenome, validateGenome — are
 * the load-bearing primitives every genome creation, mutation, and
 * validation path depends on.
 *
 * Scope: this packet covers ONLY the 4 lifecycle functions. The Xcode
 * encode/decode helpers (encodeXcode, decodeXcode, xcodeToParamValue,
 * paramValueToXcode) plus XCODE_MAX and BASE62_ALPHABET are covered by
 * the in-flight branch `feat/test-genome-xcode-helpers-1781892256-3486791`
 * (commit 43cadb5e, file `test/genome/xcode-helpers.test.ts`, 357 lines).
 * This packet is perfectly complementary — disjoint file, disjoint folder,
 * disjoint scope.
 *
 * The constants SECTION_SIZE / SECTION_COUNT / SECTION and the interfaces
 * GenomeSections / GenomeValidationResult are type-only or trivial aliases
 * and need no runtime tests.
 *
 * Run: ./node_modules/.bin/vitest run test/registry/genome-codec.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  computeChecksum,
  parseGenome,
  assembleGenome,
  validateGenome,
  GENOME_LENGTH,
  SECTION_SIZE,
  SECTION_COUNT,
  SECTION,
  BASE62_ALPHABET,
} from '../../src/alienclaw/registry/genome-codec.js';

// Valid section fixtures (each exactly 64 Base62 chars)
const VALID_IDENTITY  = 'A'.repeat(SECTION_SIZE);  // 64 A's
const VALID_EXECUTION = 'B'.repeat(SECTION_SIZE);  // 64 B's
const VALID_BEHAVIOR  = 'C'.repeat(SECTION_SIZE);  // 64 C's

// Build a fully-valid 256-char genome via the codec's own primitive
const VALID_GENOME = assembleGenome(VALID_IDENTITY, VALID_EXECUTION, VALID_BEHAVIOR);

// ──────────────────────────────────────────────────────────────────────────
// computeChecksum
// ──────────────────────────────────────────────────────────────────────────

describe('computeChecksum', () => {
  it('returns a 64-char Base62 string for a valid 192-char input', () => {
    const body = VALID_IDENTITY + VALID_EXECUTION + VALID_BEHAVIOR;
    const cs = computeChecksum(body);
    expect(cs).toHaveLength(SECTION_SIZE);
    expect(/^[0-9A-Za-z]{64}$/.test(cs)).toBe(true);
  });

  it('is deterministic — same input → same output', () => {
    const body = VALID_IDENTITY + VALID_EXECUTION + VALID_BEHAVIOR;
    const cs1 = computeChecksum(body);
    const cs2 = computeChecksum(body);
    expect(cs1).toBe(cs2);
  });

  it('differs when any of the 3 sections (chars 0..191) changes', () => {
    const body1 = VALID_IDENTITY + VALID_EXECUTION + VALID_BEHAVIOR;
    const body2 = VALID_IDENTITY + VALID_EXECUTION + 'D'.repeat(SECTION_SIZE);
    expect(computeChecksum(body1)).not.toBe(computeChecksum(body2));
  });

  it('throws when input length !== 192', () => {
    expect(() => computeChecksum('short')).toThrow(/expected 192 chars/);
    expect(() => computeChecksum('A'.repeat(191))).toThrow(/expected 192 chars/);
    expect(() => computeChecksum('A'.repeat(193))).toThrow(/expected 192 chars/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// parseGenome
// ──────────────────────────────────────────────────────────────────────────

describe('parseGenome', () => {
  it('splits a valid 256-char genome into 4 sections of 64', () => {
    const sections = parseGenome(VALID_GENOME);
    expect(sections.identity).toBe(VALID_IDENTITY);
    expect(sections.execution).toBe(VALID_EXECUTION);
    expect(sections.behavior).toBe(VALID_BEHAVIOR);
    expect(sections.checksum).toHaveLength(SECTION_SIZE);
  });

  it('is idempotent under round-trip — joining the sections reproduces the input', () => {
    const sections = parseGenome(VALID_GENOME);
    const rejoined =
      sections.identity + sections.execution + sections.behavior + sections.checksum;
    expect(rejoined).toBe(VALID_GENOME);
  });

  it('throws when input length !== 256', () => {
    expect(() => parseGenome('short')).toThrow(/exactly 256 chars/);
    expect(() => parseGenome('A'.repeat(255))).toThrow(/exactly 256 chars/);
    expect(() => parseGenome('A'.repeat(257))).toThrow(/exactly 256 chars/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// assembleGenome
// ──────────────────────────────────────────────────────────────────────────

describe('assembleGenome', () => {
  it('returns a 256-char string when given 3 valid 64-char Base62 sections', () => {
    expect(VALID_GENOME).toHaveLength(GENOME_LENGTH);
  });

  it('appends a checksum section that matches computeChecksum(body)', () => {
    const body = VALID_IDENTITY + VALID_EXECUTION + VALID_BEHAVIOR;
    expect(VALID_GENOME.slice(0, SECTION_SIZE * 3)).toBe(body);
    expect(VALID_GENOME.slice(SECTION_SIZE * 3)).toBe(computeChecksum(body));
  });

  it('throws when a section is not exactly 64 chars', () => {
    expect(() => assembleGenome('A'.repeat(65), VALID_EXECUTION, VALID_BEHAVIOR))
      .toThrow(/Section 0 \(identity\) must be exactly 64 chars/);
    expect(() => assembleGenome(VALID_IDENTITY, 'B'.repeat(63), VALID_BEHAVIOR))
      .toThrow(/Section 1 \(execution\) must be exactly 64 chars/);
    expect(() => assembleGenome(VALID_IDENTITY, VALID_EXECUTION, 'C'.repeat(0)))
      .toThrow(/Section 2 \(behavior\) must be exactly 64 chars/);
  });

  it('throws when a section contains a non-Base62 character', () => {
    expect(() => assembleGenome('A'.repeat(63) + '!', VALID_EXECUTION, VALID_BEHAVIOR))
      .toThrow(/non-Base62 characters/);
    expect(() => assembleGenome(VALID_IDENTITY, 'B'.repeat(63) + ' ', VALID_BEHAVIOR))
      .toThrow(/non-Base62 characters/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// validateGenome
// ──────────────────────────────────────────────────────────────────────────

describe('validateGenome', () => {
  it('returns { valid: true, errors: [] } for a genome built by assembleGenome', () => {
    const v = validateGenome(VALID_GENOME);
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('rejects genomes whose length is not 256 (with "Length must be" error)', () => {
    const v = validateGenome('A'.repeat(255));
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('Length must be 256'))).toBe(true);
  });

  it('rejects genomes containing non-Base62 characters (with "Base62 characters" error)', () => {
    const bad = (VALID_IDENTITY + VALID_EXECUTION + VALID_BEHAVIOR + '!'.repeat(SECTION_SIZE - 4) + 'ABCD').slice(0, GENOME_LENGTH);
    const v = validateGenome(bad);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('Base62 characters'))).toBe(true);
  });

  it('rejects genomes with a corrupted checksum (with "Checksum mismatch" error)', () => {
    // Mutate the checksum section to a different valid Base62 string
    const body = VALID_GENOME.slice(0, SECTION_SIZE * 3);
    const mutatedChecksum = 'z'.repeat(SECTION_SIZE);
    const corrupted = body + mutatedChecksum;
    const v = validateGenome(corrupted);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('Checksum mismatch'))).toBe(true);
  });

  it('returns { valid: false } for a non-string input', () => {
    // Cast to any to test runtime guard against non-string input (the function
    // signature is string, but validateGenome has a runtime check for it).
    const v = validateGenome(undefined as unknown as string);
    expect(v.valid).toBe(false);
    expect(v.errors).toContain('Genome must be a string');
  });
});
