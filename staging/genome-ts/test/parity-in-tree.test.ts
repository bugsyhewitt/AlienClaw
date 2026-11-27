/**
 * parity-in-tree.test.ts — staged package vs in-tree AlienClaw sources.
 *
 * Compares the staged codec/operators against the originals they were copied
 * from (src/alienclaw/registry/genome-codec.ts and genome-operators.ts) on
 * fast-check generated inputs with a FIXED seed, so a run is reproducible.
 * Every comparison is outcome-level: either both return the same value, or
 * both throw an Error with the same name and message.
 *
 * mutateDirected is driven by two identically seeded PRNG streams; the test
 * also asserts both implementations consume the same number of draws, so the
 * random-stream contract matches, not only the output.
 *
 * The in-tree modules are loaded with runtime-computed specifiers: tsc does
 * not follow them, and when the package is lifted out of the repo (source
 * paths absent) the whole suite is skipped.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as stagedCodec from '../src/codec.js';
import * as stagedOps from '../src/operators.js';
import type { ParameterField, SlotBrain } from '../src/operators.js';

type CodecModule = typeof stagedCodec;
type OpsModule = typeof stagedOps;

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../../..');
const IN_TREE_CODEC = resolve(REPO_ROOT, 'src/alienclaw/registry/genome-codec.ts');
const IN_TREE_OPS = resolve(REPO_ROOT, 'src/alienclaw/registry/genome-operators.ts');
const inTreePresent = existsSync(IN_TREE_CODEC) && existsSync(IN_TREE_OPS);

const inTreeCodec: CodecModule | null = inTreePresent
  ? ((await import(IN_TREE_CODEC)) as CodecModule)
  : null;
const inTreeOps: OpsModule | null = inTreePresent
  ? ((await import(IN_TREE_OPS)) as OpsModule)
  : null;

/** Fixed fast-check seed; each property offsets it so they explore different streams. */
const SEED = 20261126;

// ---------------------------------------------------------------------------
// Outcome comparison
// ---------------------------------------------------------------------------

type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; name: string; message: string };

function outcome(f: () => unknown): Outcome {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    if (e instanceof Error) return { ok: false, name: e.name, message: e.message };
    return { ok: false, name: typeof e, message: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const { BASE62_ALPHABET, GENOME_LENGTH, SECTION_SIZE, XCODE_MAX } = stagedCodec;

const base62Char = fc.constantFrom(...BASE62_ALPHABET.split(''));
const junkChar = fc.constantFrom('!', '@', '#', '+', '/', '=', ' ', '\n', '\0', '-', '_', 'é', '\u{1F47D}');
const mixedChar = fc.oneof(
  { weight: 9, arbitrary: base62Char },
  { weight: 1, arbitrary: junkChar },
);
const anyCodeUnit = fc.integer({ min: 0, max: 0xffff }).map((n) => String.fromCharCode(n));

const base62String = (len: number) => fc.string({ unit: base62Char, minLength: len, maxLength: len });
const mixedString = (minLength: number, maxLength: number) =>
  fc.string({ unit: mixedChar, minLength, maxLength });

const validGenome = fc
  .tuple(base62String(SECTION_SIZE), base62String(SECTION_SIZE), base62String(SECTION_SIZE))
  .map(([i, e, b]) => stagedCodec.assembleGenome(i, e, b));

/** A valid genome with one position replaced by an arbitrary character. */
const pointMutatedGenome = fc
  .tuple(validGenome, fc.integer({ min: 0, max: GENOME_LENGTH - 1 }), fc.oneof(base62Char, junkChar))
  .map(([g, pos, ch]) => g.slice(0, pos) + ch + g.slice(pos + 1));

/** Mostly 256-char inputs (valid, corrupted, noisy), sometimes the wrong length. */
const genomeLike = fc.oneof(
  { weight: 4, arbitrary: validGenome },
  { weight: 3, arbitrary: pointMutatedGenome },
  { weight: 2, arbitrary: mixedString(GENOME_LENGTH, GENOME_LENGTH) },
  { weight: 1, arbitrary: mixedString(GENOME_LENGTH - 3, GENOME_LENGTH + 3) },
  { weight: 1, arbitrary: fc.string({ maxLength: 300 }) },
);

const smallNumber = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: -3, max: 40 }) },
  { weight: 1, arbitrary: fc.double({ min: -3, max: 40 }) },
);

const direction = fc.constantFrom('lower' as const, 'higher' as const, 'none' as const);

const rangePair = fc.oneof(
  // ordered (the normal case)
  { weight: 9, arbitrary: fc.tuple(fc.integer({ min: -50, max: 4000 }), fc.integer({ min: 0, max: 4000 }))
      .map(([a, span]) => [a, a + span] as const) },
  // unordered — both sides must throw identically
  { weight: 1, arbitrary: fc.tuple(fc.integer({ min: -50, max: 4000 }), fc.integer({ min: -50, max: 4000 })) },
);

const parameterField: fc.Arbitrary<ParameterField> = fc
  .tuple(fc.integer({ min: -2, max: 33 }), rangePair, direction)
  .map(([xcodeIndex, [rangeMin, rangeMax], dir]) => ({ xcodeIndex, rangeMin, rangeMax, direction: dir }));

const slotBrain: fc.Arbitrary<SlotBrain> = fc.record({
  parameterSchema: fc.array(parameterField, { maxLength: 8 }),
});

const slotBrains = fc.array(fc.option(slotBrain, { nil: null }), { minLength: 0, maxLength: 5 });

const mutationRate = fc.oneof(
  fc.constant(stagedOps.PER_XCODE_MUTATION_RATE),
  fc.constant(0),
  fc.constant(1),
  fc.double({ min: 0, max: 1, noNaN: true }),
);

/** Counting LCG (same generator as test/operators.test.ts makeRand). */
function countingRand(seed: number): { rand: () => number; draws: () => number } {
  let s = seed >>> 0;
  let n = 0;
  return {
    rand: () => {
      n++;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x1_0000_0000;
    },
    draws: () => n,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!inTreePresent)('staged genome codec == in-tree genome codec', () => {
  const T = inTreeCodec as CodecModule;
  const TO = inTreeOps as OpsModule;

  it('exports the same codec and operator names', () => {
    expect(Object.keys(stagedCodec).sort()).toEqual(Object.keys(T).sort());
    expect(Object.keys(stagedOps).sort()).toEqual(Object.keys(TO).sort());
  });

  it('exports identical constants', () => {
    for (const [mod, ref] of [[stagedCodec, T], [stagedOps, TO]] as const) {
      for (const [k, v] of Object.entries(mod)) {
        if (typeof v === 'function') continue;
        expect(v, `constant ${k}`).toEqual((ref as unknown as Record<string, unknown>)[k]);
      }
    }
  });

  it('computeChecksum agrees on Base62, arbitrary-code-unit, and wrong-length input', () => {
    const input = fc.oneof(
      base62String(SECTION_SIZE * 3),
      fc.string({ unit: anyCodeUnit, minLength: SECTION_SIZE * 3, maxLength: SECTION_SIZE * 3 }),
      mixedString(SECTION_SIZE * 3 - 4, SECTION_SIZE * 3 + 4),
    );
    fc.assert(
      fc.property(input, (s) => {
        expect(outcome(() => stagedCodec.computeChecksum(s))).toEqual(outcome(() => T.computeChecksum(s)));
      }),
      { seed: SEED + 1, numRuns: 1000 },
    );
  });

  it('assembleGenome agrees (including section-length and non-Base62 errors)', () => {
    const section = fc.oneof(
      { weight: 6, arbitrary: base62String(SECTION_SIZE) },
      { weight: 2, arbitrary: mixedString(SECTION_SIZE, SECTION_SIZE) },
      { weight: 1, arbitrary: mixedString(SECTION_SIZE - 2, SECTION_SIZE + 2) },
    );
    fc.assert(
      fc.property(section, section, section, (i, e, b) => {
        expect(outcome(() => stagedCodec.assembleGenome(i, e, b)))
          .toEqual(outcome(() => T.assembleGenome(i, e, b)));
      }),
      { seed: SEED + 2, numRuns: 1000 },
    );
  });

  it('parseGenome agrees', () => {
    fc.assert(
      fc.property(genomeLike, (g) => {
        expect(outcome(() => stagedCodec.parseGenome(g))).toEqual(outcome(() => T.parseGenome(g)));
      }),
      { seed: SEED + 3, numRuns: 1000 },
    );
  });

  it('validateGenome agrees on valid, point-mutated, noisy, and wrong-length genomes', () => {
    fc.assert(
      fc.property(genomeLike, (g) => {
        expect(outcome(() => stagedCodec.validateGenome(g))).toEqual(outcome(() => T.validateGenome(g)));
      }),
      { seed: SEED + 4, numRuns: 1500 },
    );
  });

  it('decodeXcode agrees (including out-of-range and non-integer indices)', () => {
    fc.assert(
      fc.property(genomeLike, smallNumber, smallNumber, (g, slot, xc) => {
        expect(outcome(() => stagedCodec.decodeXcode(g, slot, xc)))
          .toEqual(outcome(() => T.decodeXcode(g, slot, xc)));
      }),
      { seed: SEED + 5, numRuns: 1500 },
    );
  });

  it('encodeXcode agrees across and beyond [0, XCODE_MAX]', () => {
    const value = fc.oneof(
      { weight: 8, arbitrary: fc.integer({ min: -100, max: XCODE_MAX + 100 }) },
      { weight: 1, arbitrary: fc.double({ min: -100, max: XCODE_MAX + 100 }) },
    );
    fc.assert(
      fc.property(value, (v) => {
        expect(outcome(() => stagedCodec.encodeXcode(v))).toEqual(outcome(() => T.encodeXcode(v)));
      }),
      { seed: SEED + 6, numRuns: 1500 },
    );
  });

  it('xcodeToParamValue and paramValueToXcode agree (including inverted ranges)', () => {
    const x = fc.integer({ min: -10, max: XCODE_MAX + 10 });
    fc.assert(
      fc.property(x, rangePair, fc.integer({ min: -60, max: 8100 }), (xv, [lo, hi], p) => {
        expect(outcome(() => stagedCodec.xcodeToParamValue(xv, lo, hi)))
          .toEqual(outcome(() => T.xcodeToParamValue(xv, lo, hi)));
        expect(outcome(() => stagedCodec.paramValueToXcode(p, lo, hi)))
          .toEqual(outcome(() => T.paramValueToXcode(p, lo, hi)));
        // In-range param: exercise the non-throwing path deliberately.
        if (lo <= hi) {
          const inRange = lo + (Math.abs(p) % (hi - lo + 1));
          expect(outcome(() => stagedCodec.paramValueToXcode(inRange, lo, hi)))
            .toEqual(outcome(() => T.paramValueToXcode(inRange, lo, hi)));
        }
      }),
      { seed: SEED + 7, numRuns: 1500 },
    );
  });

  it('mutateDirected agrees on output and PRNG consumption for identical seeded streams', () => {
    const genome = fc.oneof(
      { weight: 6, arbitrary: validGenome },
      { weight: 2, arbitrary: pointMutatedGenome },
      { weight: 1, arbitrary: mixedString(GENOME_LENGTH - 2, GENOME_LENGTH + 2) },
    );
    fc.assert(
      fc.property(
        genome,
        slotBrains,
        fc.integer({ min: 0, max: 0xffff_ffff }),
        mutationRate,
        (g, brains, seed, rate) => {
          const a = countingRand(seed);
          const b = countingRand(seed);
          const staged = outcome(() => stagedOps.mutateDirected(g, brains, a.rand, rate));
          const inTree = outcome(() => TO.mutateDirected(g, brains, b.rand, rate));
          expect(staged).toEqual(inTree);
          expect(a.draws()).toBe(b.draws());
        },
      ),
      { seed: SEED + 8, numRuns: 1500 },
    );
  });

  it('mutateDirected default rate agrees (rate argument omitted)', () => {
    fc.assert(
      fc.property(validGenome, slotBrains, fc.integer({ min: 0, max: 0xffff_ffff }), (g, brains, seed) => {
        const a = countingRand(seed);
        const b = countingRand(seed);
        expect(outcome(() => stagedOps.mutateDirected(g, brains, a.rand)))
          .toEqual(outcome(() => TO.mutateDirected(g, brains, b.rand)));
        expect(a.draws()).toBe(b.draws());
      }),
      { seed: SEED + 9, numRuns: 500 },
    );
  });
});
