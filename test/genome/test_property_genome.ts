/**
 * test/genome/test_property_genome.ts — Property-based genome codec tests (T9, PKT-P1).
 *
 * Uses fast-check to generate random inputs and verify invariants:
 * 1. decode(encode(x)) === x (round-trip)
 * 2. Any single-char change to the mutable body fails checksum validation
 * 3. Every ±1 char mutation yields either a valid genome or an explicit typed error
 *
 * Runtime target: < 30 seconds in CI.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  assembleGenome,
  parseGenome,
  validateGenome,
  computeChecksum,
  BASE62_ALPHABET,
  GENOME_LENGTH,
  SECTION_SIZE,
} from '../../src/alienclaw/registry/genome-codec.js';

// ---------------------------------------------------------------------------
// Arbitrary: random 64-char Base62 section
// ---------------------------------------------------------------------------

const base62Char = fc.constantFrom(...BASE62_ALPHABET.split(''));
const section64 = fc.array(base62Char, { minLength: 64, maxLength: 64 })
  .map((chars) => chars.join(''));

// ---------------------------------------------------------------------------
// Arbitrary: random valid 256-char genome
// ---------------------------------------------------------------------------

const validGenome = fc
  .tuple(section64, section64, section64)
  .map(([identity, execution, behavior]) => assembleGenome(identity, execution, behavior));

// ---------------------------------------------------------------------------
// Property 1: decode(encode(x)) === x (round-trip)
// ---------------------------------------------------------------------------

describe('Property: round-trip encode/decode', () => {
  it('parseGenome(assembleGenome(i, e, b)) reproduces all three sections', () => {
    fc.assert(
      fc.property(section64, section64, section64, (identity, execution, behavior) => {
        const genome = assembleGenome(identity, execution, behavior);
        const parsed = parseGenome(genome);
        return (
          parsed.identity  === identity  &&
          parsed.execution === execution &&
          parsed.behavior  === behavior
        );
      }),
      { numRuns: 200, seed: 42 },
    );
  });

  it('the checksum section is exactly 64 chars and all Base62', () => {
    fc.assert(
      fc.property(section64, section64, section64, (identity, execution, behavior) => {
        const genome = assembleGenome(identity, execution, behavior);
        const checksum = genome.slice(SECTION_SIZE * 3);
        if (checksum.length !== SECTION_SIZE) return false;
        return [...checksum].every((c) => BASE62_ALPHABET.includes(c));
      }),
      { numRuns: 200, seed: 43 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Any single-char change to the body fails checksum
// ---------------------------------------------------------------------------

describe('Property: single-char body mutation invalidates checksum', () => {
  it('flipping any char in positions 0..191 fails checksum validation', () => {
    fc.assert(
      fc.property(
        validGenome,
        fc.integer({ min: 0, max: 191 }),
        (genome, position) => {
          // Flip the char to the next Base62 char
          const idx = BASE62_ALPHABET.indexOf(genome[position]!);
          const nextChar = BASE62_ALPHABET[(idx + 1) % BASE62_ALPHABET.length]!;
          const mutated = genome.slice(0, position) + nextChar + genome.slice(position + 1);
          const result = validateGenome(mutated);
          // Must be invalid — specifically checksum mismatch
          return !result.valid && result.errors.some((e) => e.includes('hecksum'));
        },
      ),
      { numRuns: 200, seed: 44 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Every ±1 mutation yields valid genome OR explicit typed error
// ---------------------------------------------------------------------------

describe('Property: ±1 mutation yields valid or explicit error', () => {
  it('mutating any single position produces valid genome or explicit error', () => {
    fc.assert(
      fc.property(
        validGenome,
        fc.integer({ min: 0, max: GENOME_LENGTH - 1 }),
        (genome, position) => {
          const idx = BASE62_ALPHABET.indexOf(genome[position]!);
          const nextChar = BASE62_ALPHABET[(idx + 1) % BASE62_ALPHABET.length]!;
          const mutated = genome.slice(0, position) + nextChar + genome.slice(position + 1);

          // Attempt to validate the mutated genome
          try {
            const result = validateGenome(mutated);
            // Must either be valid or have explicit errors (never silently wrong)
            if (result.valid) {
              // Valid mutation: checksum must match
              const body = mutated.slice(0, SECTION_SIZE * 3);
              const stored = mutated.slice(SECTION_SIZE * 3);
              return computeChecksum(body) === stored;
            }
            // Invalid: must have at least one error message
            return result.errors.length > 0;
          } catch (err) {
            // Explicit thrown error is also acceptable
            return err instanceof Error && err.message.length > 0;
          }
        },
      ),
      { numRuns: 200, seed: 45 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property: invalid length always rejected
// ---------------------------------------------------------------------------

describe('Property: wrong-length inputs always rejected', () => {
  it('genomes shorter than 256 are always invalid', () => {
    fc.assert(
      fc.property(
        fc.array(base62Char, { minLength: 0, maxLength: 255 }).map((cs) => cs.join('')),
        (shortGenome) => {
          const result = validateGenome(shortGenome);
          return !result.valid;
        },
      ),
      { numRuns: 100, seed: 46 },
    );
  });

  it('genomes longer than 256 are always invalid', () => {
    fc.assert(
      fc.property(
        fc.array(base62Char, { minLength: 257, maxLength: 300 }).map((cs) => cs.join('')),
        (longGenome) => {
          const result = validateGenome(longGenome);
          return !result.valid;
        },
      ),
      { numRuns: 100, seed: 47 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property: non-Base62 chars always rejected
// ---------------------------------------------------------------------------

describe('Property: non-Base62 inputs always rejected', () => {
  it('inserting a non-Base62 char at any position fails validation', () => {
    const nonBase62 = ['!', '@', '#', '+', '/', '=', ' ', '\n', '\0'];
    fc.assert(
      fc.property(
        validGenome,
        fc.integer({ min: 0, max: GENOME_LENGTH - 1 }),
        fc.constantFrom(...nonBase62),
        (genome, position, badChar) => {
          const mutated = genome.slice(0, position) + badChar + genome.slice(position + 1);
          const result = validateGenome(mutated);
          return !result.valid;
        },
      ),
      { numRuns: 200, seed: 48 },
    );
  });
});
