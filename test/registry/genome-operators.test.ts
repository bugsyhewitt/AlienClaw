import { describe, it, expect } from 'vitest';
import { mutateDirected, PER_XCODE_MUTATION_RATE, SlotBrain, ParameterField } from '../../src/alienclaw/registry/genome-operators.js';
import { assembleGenome, decodeXcode, validateGenome, GENOME_LENGTH, XCODE_MAX } from '../../src/alienclaw/registry/genome-codec.js';

function makeRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const ID_BODY = 'TEST0001G1AlienClaw' + 'A'.repeat(45);  // 19+45=64
const g = assembleGenome(ID_BODY, 'B'.repeat(64), 'C'.repeat(64));

function brain(xcodeIndices: number[], direction: 'lower' | 'higher' | 'none' = 'none', rangeMax = 3843): SlotBrain {
  return {
    parameterSchema: xcodeIndices.map((xcodeIndex) => ({
      xcodeIndex, rangeMin: 0, rangeMax, direction,
    })),
  };
}

describe('mutateDirected — runtime invariants (TS)', () => {
  it('returns a 256-char string on valid input', () => {
    const out = mutateDirected(g, [null, null, null, null], makeRand(1));
    expect(out).toHaveLength(GENOME_LENGTH);
  });

  it('throws on genome whose length !== 256', () => {
    expect(() => mutateDirected('short', [null, null, null, null], makeRand(1)))
      .toThrow(/256/);
  });

  it('returns the same input when all brains are null (no mutation)', () => {
    const out = mutateDirected(g, [null, null, null, null], makeRand(2));
    expect(out).toBe(g);
  });

  it('returns the same input when slot brains have empty parameterSchema', () => {
    const b: SlotBrain = { parameterSchema: [] };
    const out = mutateDirected(g, [null, b, null, null], makeRand(2));
    expect(out).toBe(g);
  });

  it('rate=0 → no mutation regardless of brain', () => {
    const b = brain([0, 1, 2, 3, 4]);
    const out = mutateDirected(g, [null, b, null, null], makeRand(3), 0);
    expect(out).toBe(g);
  });

  it('slot 0 (IDENTITY) is never mutated even with brain+rate=1.0', () => {
    const b = brain([0, 1, 2, 3, 4, 5]);
    const out = mutateDirected(g, [b, null, null, null], makeRand(7), 1.0);
    expect(out.slice(0, 64)).toBe(g.slice(0, 64));
    expect(out.slice(0, 8)).toBe(g.slice(0, 8));
  });

  it('slot 3 (CHECKSUM) body is never mutated even with brain+rate=1.0', () => {
    const b = brain([0, 1, 2, 3, 4, 5]);
    const out = mutateDirected(g, [null, null, null, b], makeRand(7), 1.0);
    expect(out.slice(0, 192)).toBe(g.slice(0, 192));
  });

  it('deterministic: same (genome, brain, rand) → same output across N runs', () => {
    const b = brain([0, 1, 2]);
    const first = mutateDirected(g, [null, b, null, null], makeRand(42), 1.0);
    for (let i = 0; i < 50; i++) {
      const again = mutateDirected(g, [null, b, null, null], makeRand(42), 1.0);
      expect(again).toBe(first);
    }
  });

  it('result is always a valid Base62 256-char genome (validateGenome passes)', () => {
    const b = brain([0, 1, 2, 3, 4]);
    const out = mutateDirected(g, [null, b, b, null], makeRand(11), 1.0);
    const v = validateGenome(out);
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('rate=1 + brain with 1 xcode → mutation runs without throwing and stays valid', () => {
    const b = brain([0]);
    const out = mutateDirected(g, [null, b, null, null], makeRand(99), 1.0);
    expect(validateGenome(out).valid).toBe(true);
  });

  it('direction=lower: xcode 0 of slot 1 decreases more often than increases (statistical, N=200)', () => {
    // Use a narrower range so step magnitudes matter more; param step is small relative to range
    const b = brain([0], 'lower', 100);  // range [0,100]
    let decreased = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const out = mutateDirected(g, [null, b, null, null], makeRand(i + 1), 1.0);
      const newXcode = decodeXcode(out, 1, 0);
      const oldXcode = decodeXcode(g, 1, 0);
      if (newXcode < oldXcode) decreased++;
    }
    const frac = decreased / n;
    expect(frac).toBeGreaterThan(0.55);
  });

  it('direction=higher: xcode 0 of slot 1 increases more often than decreases (statistical)', () => {
    const b = brain([0], 'higher', 100);
    let increased = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const out = mutateDirected(g, [null, b, null, null], makeRand(i + 1), 1.0);
      const newXcode = decodeXcode(out, 1, 0);
      const oldXcode = decodeXcode(g, 1, 0);
      if (newXcode > oldXcode) increased++;
    }
    const frac = increased / n;
    expect(frac).toBeGreaterThan(0.55);
  });

  it('output body (chars 0..191) is 192 chars of Base62 only', () => {
    const b = brain([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const out = mutateDirected(g, [null, b, b, null], makeRand(13), 1.0);
    const body = out.slice(0, 192);
    expect(body).toHaveLength(192);
    expect(/^[0-9A-Za-z]{192}$/.test(body)).toBe(true);
  });

  it('PER_XCODE_MUTATION_RATE = 2/256 (matches Python source)', () => {
    expect(PER_XCODE_MUTATION_RATE).toBeCloseTo(2 / 256);
  });

  it('output checksum (chars 192..255) is consistent — validateGenome passes', () => {
    const b = brain([0, 1, 2]);
    const out = mutateDirected(g, [null, b, null, null], makeRand(17), 1.0);
    expect(validateGenome(out).valid).toBe(true);
  });

  // xcodeIndex is only valid in [0,30] — the codec's decodeXcode enforces this.
  // mutateDirected must apply the same guard: xcodeIndex=31 on slot 2 would write
  // to chars[192] (outside the 192-char body), growing the array by 1 and causing
  // computeChecksum to throw "expected 192 chars, got 193".
  it('xcodeIndex=31 on slot 2 (out of [0,30] range) is skipped — no crash, genome stays 256 chars', () => {
    const oob: SlotBrain = { parameterSchema: [{ xcodeIndex: 31, rangeMin: 0, rangeMax: 3843, direction: 'none' }] };
    const out = mutateDirected(g, [null, null, oob, null], makeRand(5), 1.0);
    expect(out).toHaveLength(256);
    expect(validateGenome(out).valid).toBe(true);
  });

  it('xcodeIndex=31 on slot 1 (cross-slot write into slot 2 territory) is skipped — genome stays valid', () => {
    const oob: SlotBrain = { parameterSchema: [{ xcodeIndex: 31, rangeMin: 0, rangeMax: 3843, direction: 'none' }] };
    const out = mutateDirected(g, [null, oob, null, null], makeRand(7), 1.0);
    expect(out).toHaveLength(256);
    expect(validateGenome(out).valid).toBe(true);
  });

  it('rangeMin === rangeMax: every step clamps back to currParam — genome stays unchanged', () => {
    // xcodeToParamValue(any, 50, 50) = 50 always (span=1).
    // Math.max(50, Math.min(50, 50 ± step)) = 50 = currParam → `continue` fires for
    // every mutation attempt, covering branch 14 arm 0 on L95.
    const b: SlotBrain = {
      parameterSchema: [{ xcodeIndex: 0, rangeMin: 50, rangeMax: 50, direction: 'none' }],
    };
    const out = mutateDirected(g, [null, b, null, null], makeRand(23), 1.0);
    expect(out).toBe(g);
  });

  it('slotBrains shorter than slot indices — short-array guard skips out-of-range slots', () => {
    // slotIdx iterates [1, 2]; with length=0, L76 fires for both → genome unchanged
    const out0 = mutateDirected(g, [], makeRand(1));
    expect(out0.length).toBe(GENOME_LENGTH);
    // With length=1, both slotIdx=1 (1>=1) and slotIdx=2 (2>=1) trip L76 → neither slot runs
    const b1: SlotBrain = { parameterSchema: [{ xcodeIndex: 0, rangeMin: 0, rangeMax: 3843, direction: 'none' }] };
    const out1 = mutateDirected(g, [b1], makeRand(1), 1.0);
    expect(out1.length).toBe(GENOME_LENGTH);
  });

  it('non-Base62 chars in genome body — ?? 0 fallback maps invalid char to index 0 without throwing', () => {
    // base for slot 1, xcodeIndex 0 = 1*64+1+0*2 = 65; corrupt chars[65] and chars[66]
    const corrupt = g.slice(0, 65) + '!!' + g.slice(67, 192) + g.slice(192);
    expect(corrupt.length).toBe(GENOME_LENGTH);  // sanity: still 256 chars
    const b: SlotBrain = { parameterSchema: [{ xcodeIndex: 0, rangeMin: 0, rangeMax: 3843, direction: 'none' }] };
    // Should not throw; both ?? 0 fallbacks (b9a1 + b10a1) fire covering L85
    const out = mutateDirected(corrupt, [null, b, null, null], makeRand(5), 1.0);
    expect(out).toHaveLength(GENOME_LENGTH);
  });
});
