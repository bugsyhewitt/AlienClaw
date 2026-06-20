/**
 * random-genome.test.ts
 *
 * Direct unit tests for `src/alienclaw/governance/common/random-genome.ts` (packet 091).
 *
 * Background:
 *   `random-genome.ts` (44 lines) exposes 1 public symbol:
 *     - randomGenome(idTag?, seed?): string
 *       → 256-char Base62 genome whose checksum passes validateGenome()
 *
 *   Plus 2 module-internal helpers (NOT exported, not part of the public surface):
 *     - _randomSection(rng, idTag?)  — fills a 64-char Base62 section
 *     - _makeLcg(seed)               — seedable LCG PRNG
 *
 *   randomGenome() is called by CreatorBot when building a Subagent and by any
 *   path that needs a fresh Martian genome without going through the full
 *   registry. A regression in:
 *     - the 256-char / 4×64 layout (wrong length breaks genome-codec invariant)
 *     - the checksum (validateGenome would reject the genome on first use)
 *     - the idTag embedding (wrong Martian ID tag in the identity section)
 *     - the LCG seeding (non-deterministic tests, or seeds colliding)
 *   …would silently produce invalid genomes that fail at assembly or at the
 *   first validateGenome() call with no test catching it today.
 *
 *   The function is pure (deterministic for a fixed seed) so no mocking or
 *   temp-dir setup is required. We always pass an explicit numeric seed to
 *   avoid Date.now() non-determinism in CI.
 *
 *   The idTag parameter controls the first 8 chars of the identity section
 *   (section 0, genome chars 0–7):
 *     - Base62 chars are embedded as-is
 *     - non-Base62 chars are substituted with '0'
 *     - tags < 8 chars are right-padded with '0'
 *     - tags > 8 chars are truncated to 8
 *
 * Wall discipline: no production code is modified. Test-only.
 */

import { describe, it, expect } from 'vitest';
import { randomGenome } from '../../../src/alienclaw/governance/common/random-genome.js';
import { validateGenome } from '../../../src/alienclaw/registry/genome-codec.js';

// ── randomGenome() ────────────────────────────────────────────────────────────

describe('randomGenome', () => {
  it('produces exactly 256 chars', () => {
    const g = randomGenome('TEST0001', 42);
    expect(g).toHaveLength(256);
  });

  it('produces a valid Base62 genome (checksum passes validateGenome)', () => {
    const g = randomGenome('TEST0001', 42);
    const result = validateGenome(g);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('is deterministic: same idTag + same seed → identical output', () => {
    const a = randomGenome('AAAA0001', 12345);
    const b = randomGenome('AAAA0001', 12345);
    expect(a).toBe(b);
  });

  it('different seeds → different output', () => {
    const a = randomGenome('SAME0001', 1);
    const b = randomGenome('SAME0001', 2);
    expect(a).not.toBe(b);
  });

  it('different idTags → different identity sections', () => {
    const a = randomGenome('AAAAAA00', 99);
    const b = randomGenome('BBBBBB00', 99);
    // Identity section is chars 0–63; idTag sits at chars 0–7
    expect(a.slice(0, 8)).not.toBe(b.slice(0, 8));
  });

  it('embeds a valid 8-char idTag at chars 0–7 of the identity section', () => {
    const g = randomGenome('SPEC0001', 7);
    expect(g.slice(0, 8)).toBe('SPEC0001');
  });

  it('truncates idTags longer than 8 chars to the first 8', () => {
    const g = randomGenome('ABCDEFGHIJKLMN', 7);
    expect(g.slice(0, 8)).toBe('ABCDEFGH');
  });

  it('right-pads idTags shorter than 8 chars with "0"', () => {
    const g = randomGenome('AB', 7);
    expect(g.slice(0, 8)).toBe('AB000000');
  });

  it('replaces non-Base62 chars in the idTag with "0"', () => {
    // 'X' and 'Y' are valid Base62; '-', '_', '!', '@', '#', '$' are not
    const g = randomGenome('XY-_!@#$', 7);
    expect(g.slice(0, 8)).toBe('XY000000');
  });

  it('fills execution and behavior sections with Base62 chars only', () => {
    const g = randomGenome('TEST0001', 55);
    const execution = g.slice(64, 128);
    const behavior  = g.slice(128, 192);
    const base62Re  = /^[0-9A-Za-z]+$/;
    expect(execution).toMatch(base62Re);
    expect(behavior).toMatch(base62Re);
    expect(execution).toHaveLength(64);
    expect(behavior).toHaveLength(64);
  });
});
