/**
 * Unit tests for the genome Xcode encode/decode helpers (TypeScript side).
 *
 * The Xcode helpers in src/alienclaw/registry/genome-codec.ts implement the
 * genome -> parameter mapping that the entire evolution thesis depends on:
 *
 *   encodeXcode(value)            : int [0,XCODE_MAX]            -> 2 Base62 chars
 *   decodeXcode(genome,slot,xc)   : 2 Base62 chars in a slot    -> int [0,XCODE_MAX]
 *   xcodeToParamValue(x,min,max)  : Xcode value                 -> param value [min,max]
 *   paramValueToXcode(p,min,max)  : param value                 -> minimum Xcode for p
 *
 * The cross-language ts-fixture-runner.test.ts exercises a *data* fixture for a
 * handful of pre-baked cases, but the algebraic properties of these four
 * functions (round-trip, bounds, inverse-consistency) were only asserted on the
 * Python side (test/genome/test_xcode_helpers.py). This file ports and extends
 * those property tests to TypeScript so divergence in the helpers becomes a
 * failing build, not a silent cross-language drift.
 *
 * Every concrete expected value below was cross-checked against the Python
 * reference implementation (alienclaw.genome.codec) and against the Python test
 * suite test/genome/test_xcode_helpers.py:
 *   - encode_xcode:        0->"00", 61->"0z", 62->"10", 3843->"zz"
 *   - decode_xcode:        slot/byte mapping (bytes 1-2, 65-66, 129-130, ...)
 *   - xcode_to_param:      bound clamping + the [0,1] binary split at 1921/1922
 *   - param_value_to_xcode: ceil-division mirror of Python `-(-numer // span)`
 *     (e.g. (3,1,5)->1538, (5,1,5)->3076, (1,0,1)->1922, (2,1,3)->1282)
 */

import { describe, it, expect } from 'vitest';
import {
  XCODE_MAX,
  BASE62_ALPHABET,
  decodeXcode,
  encodeXcode,
  xcodeToParamValue,
  paramValueToXcode,
} from '../../src/alienclaw/registry/genome-codec.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Place a 2-char Xcode into a fresh 256-char genome at (slotIndex, xcodeIndex)
 * using the SAME address arithmetic the codec documents:
 *   base = slotIndex * 64 + 1 + xcodeIndex * 2
 * The rest of the genome is filled with '0' (a valid Base62 char) so reads of
 * other slots are well-defined.
 */
function genomeWithXcode(chars: string, slotIndex: number, xcodeIndex: number): string {
  const g = '0'.repeat(256).split('');
  const base = slotIndex * 64 + 1 + xcodeIndex * 2;
  g[base] = chars[0]!;
  g[base + 1] = chars[1]!;
  return g.join('');
}

// ---------------------------------------------------------------------------
// XCODE_MAX sanity
// ---------------------------------------------------------------------------

describe('XCODE_MAX', () => {
  it('is 62*62 - 1 = 3843 (matches Python XCODE_MAX)', () => {
    expect(XCODE_MAX).toBe(62 * 62 - 1);
    expect(XCODE_MAX).toBe(3843);
  });

  it('BASE62_ALPHABET is 62 chars and indexes the full radix', () => {
    expect(BASE62_ALPHABET.length).toBe(62);
    // The two-char Xcode space is exactly [0, 62*62-1].
    expect((BASE62_ALPHABET.length * BASE62_ALPHABET.length) - 1).toBe(XCODE_MAX);
  });
});

// ---------------------------------------------------------------------------
// encodeXcode
// ---------------------------------------------------------------------------

describe('encodeXcode', () => {
  // Concrete values cross-checked against Python encode_xcode.
  const KNOWN: ReadonlyArray<readonly [number, string]> = [
    [0, '00'],
    [1, '01'],
    [61, '0z'],   // last single-radix value: 0*62 + 61
    [62, '10'],   // first carry: 1*62 + 0
    [63, '11'],
    [123, '1z'],  // 1*62 + 61
    [1922, 'V0'], // midpoint-ish; matches Python
    [3842, 'zy'], // XCODE_MAX - 1
    [3843, 'zz'], // XCODE_MAX
  ];

  for (const [value, expected] of KNOWN) {
    it(`encodes ${value} -> "${expected}"`, () => {
      expect(encodeXcode(value)).toBe(expected);
    });
  }

  it('always returns exactly 2 Base62 chars across the whole domain', () => {
    for (let v = 0; v <= XCODE_MAX; v++) {
      const enc = encodeXcode(v);
      expect(enc.length).toBe(2);
      expect(BASE62_ALPHABET.includes(enc[0]!)).toBe(true);
      expect(BASE62_ALPHABET.includes(enc[1]!)).toBe(true);
    }
  });

  it('is the positional Base62 representation: hi*62 + lo', () => {
    // Spot-check the algebra directly against the alphabet.
    for (const v of [0, 7, 61, 62, 100, 1922, 3000, 3843]) {
      const expected = BASE62_ALPHABET[Math.floor(v / 62)]! + BASE62_ALPHABET[v % 62]!;
      expect(encodeXcode(v)).toBe(expected);
    }
  });

  // Out-of-range guard (genome-codec.ts L182).
  it('throws below the lower bound', () => {
    expect(() => encodeXcode(-1)).toThrow(/out of range/);
  });

  it('throws above the upper bound', () => {
    expect(() => encodeXcode(XCODE_MAX + 1)).toThrow(/out of range/);
    expect(() => encodeXcode(3844)).toThrow(/out of range/);
  });
});

// ---------------------------------------------------------------------------
// decodeXcode
// ---------------------------------------------------------------------------

describe('decodeXcode', () => {
  // Mirrors the Python TestDecodeXcode byte-address assertions.
  it('slot 0, xcode 0 reads bytes 1-2', () => {
    const g = genomeWithXcode('10', 0, 0); // "10" -> 1*62 + 0 = 62
    expect(decodeXcode(g, 0, 0)).toBe(62);
  });

  it('slot 1, xcode 0 reads bytes 65-66', () => {
    const g = genomeWithXcode('0z', 1, 0); // "0z" -> 0*62 + 61 = 61
    expect(decodeXcode(g, 1, 0)).toBe(61);
  });

  it('slot 2, xcode 0 reads bytes 129-130', () => {
    const g = genomeWithXcode('zz', 2, 0); // "zz" -> 61*62 + 61 = 3843
    expect(decodeXcode(g, 2, 0)).toBe(3843);
  });

  it('slot 3, xcode 30 reads the last Xcode pair in the genome (bytes 253-254)', () => {
    // base = 3*64 + 1 + 30*2 = 253; bytes 253,254 hold the pair.
    const g = genomeWithXcode('zz', 3, 30);
    expect(decodeXcode(g, 3, 30)).toBe(3843);
    // Confirm the address really is 253 by checking those exact indices.
    expect(g[253]).toBe('z');
    expect(g[254]).toBe('z');
  });

  // Out-of-range guards (genome-codec.ts L172-173).
  it('throws when slotIndex is out of range [0,3]', () => {
    const g = '0'.repeat(256);
    expect(() => decodeXcode(g, 4, 0)).toThrow(/slotIndex out of range/);
    expect(() => decodeXcode(g, -1, 0)).toThrow(/slotIndex out of range/);
  });

  it('throws when xcodeIndex is out of range [0,30]', () => {
    const g = '0'.repeat(256);
    expect(() => decodeXcode(g, 0, 31)).toThrow(/xcodeIndex out of range/);
    expect(() => decodeXcode(g, 0, -1)).toThrow(/xcodeIndex out of range/);
  });
});

// ---------------------------------------------------------------------------
// encodeXcode <-> decodeXcode round-trip across [0, XCODE_MAX]
// ---------------------------------------------------------------------------

describe('encodeXcode/decodeXcode round-trip', () => {
  it('round-trips EVERY value in [0, XCODE_MAX] through a genome slot', () => {
    // Exhaustive: 3844 values. Place each at slot 0 / xcode 0 and read back.
    const failures: number[] = [];
    for (let v = 0; v <= XCODE_MAX; v++) {
      const g = genomeWithXcode(encodeXcode(v), 0, 0);
      if (decodeXcode(g, 0, 0) !== v) failures.push(v);
    }
    expect(failures).toEqual([]);
  });

  it('round-trips across every (slot, xcode) address, not just slot 0', () => {
    // Sweep a representative set of values at each legal address.
    const values = [0, 1, 61, 62, 1922, 3842, 3843];
    for (let slot = 0; slot <= 3; slot++) {
      for (let xc = 0; xc <= 30; xc++) {
        for (const v of values) {
          const g = genomeWithXcode(encodeXcode(v), slot, xc);
          expect(decodeXcode(g, slot, xc)).toBe(v);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// xcodeToParamValue
// ---------------------------------------------------------------------------

describe('xcodeToParamValue', () => {
  it('maps the low end of the Xcode space to rangeMin', () => {
    expect(xcodeToParamValue(0, 1, 5)).toBe(1);
  });

  it('maps the high end (XCODE_MAX) to rangeMax', () => {
    expect(xcodeToParamValue(3843, 1, 5)).toBe(5);
  });

  it('is monotonic non-decreasing across the Xcode space', () => {
    let prev = xcodeToParamValue(0, 1, 5);
    for (const x of [500, 1000, 1922, 2000, 3000, 3843]) {
      const cur = xcodeToParamValue(x, 1, 5);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  it('splits a binary [0,1] range at the half-space boundary 1921/1922', () => {
    // Documented Python behavior: below half -> 0, at/above half -> 1.
    expect(xcodeToParamValue(1921, 0, 1)).toBe(0);
    expect(xcodeToParamValue(1922, 0, 1)).toBe(1);
  });

  it('never leaves the [rangeMin, rangeMax] band for any Xcode in domain', () => {
    const rmin = 1;
    const rmax = 5;
    for (let x = 0; x <= XCODE_MAX; x += 11) {
      const p = xcodeToParamValue(x, rmin, rmax);
      expect(p).toBeGreaterThanOrEqual(rmin);
      expect(p).toBeLessThanOrEqual(rmax);
    }
    // Endpoints explicitly.
    expect(xcodeToParamValue(0, rmin, rmax)).toBe(rmin);
    expect(xcodeToParamValue(XCODE_MAX, rmin, rmax)).toBe(rmax);
  });

  it('matches the documented Python formula floor(x*span/(XCODE_MAX+1)) + min', () => {
    for (const [x, rmin, rmax] of [
      [0, 1, 5], [3843, 1, 5], [1921, 0, 1], [1922, 0, 1],
      [1000, 0, 9], [2000, 10, 20], [3000, -5, 5],
    ] as ReadonlyArray<readonly [number, number, number]>) {
      const span = rmax - rmin + 1;
      const expected = Math.floor((x * span) / (XCODE_MAX + 1)) + rmin;
      expect(xcodeToParamValue(x, rmin, rmax)).toBe(expected);
    }
  });

  it('throws when rangeMin > rangeMax', () => {
    expect(() => xcodeToParamValue(0, 5, 1)).toThrow(/rangeMin > rangeMax/);
  });
});

// ---------------------------------------------------------------------------
// paramValueToXcode  (inverse of xcodeToParamValue, ceil-division mirror)
// ---------------------------------------------------------------------------

describe('paramValueToXcode', () => {
  // Exact Xcode outputs cross-checked against Python param_value_to_xcode.
  const KNOWN: ReadonlyArray<readonly [number, number, number, number]> = [
    // [paramValue, rangeMin, rangeMax, expectedXcode]
    [1, 1, 5, 0],
    [3, 1, 5, 1538],
    [5, 1, 5, 3076],
    [0, 0, 1, 0],
    [1, 0, 1, 1922],
    [1, 1, 3, 0],
    [2, 1, 3, 1282],
    [3, 1, 3, 2563],
  ];

  for (const [p, rmin, rmax, expected] of KNOWN) {
    it(`param ${p} in [${rmin},${rmax}] -> Xcode ${expected}`, () => {
      expect(paramValueToXcode(p, rmin, rmax)).toBe(expected);
    });
  }

  it('returns the MINIMUM Xcode that maps to the param (ceil-division, L206)', () => {
    // The returned Xcode must map back to paramValue, and the value one below it
    // (when in domain) must map to a strictly smaller param — i.e. it is the
    // smallest Xcode producing paramValue.
    const rmin = 1;
    const rmax = 5;
    for (const p of [2, 3, 4, 5]) {
      const x = paramValueToXcode(p, rmin, rmax);
      expect(xcodeToParamValue(x, rmin, rmax)).toBe(p);
      if (x > 0) {
        expect(xcodeToParamValue(x - 1, rmin, rmax)).toBe(p - 1);
      }
    }
  });

  it('mirrors Python ceil-division -(-numer // span) == Math.ceil(numer/span)', () => {
    for (const [p, rmin, rmax] of [
      [3, 1, 5], [5, 1, 5], [1, 0, 1], [2, 1, 3], [3, 1, 3], [7, 0, 9],
    ] as ReadonlyArray<readonly [number, number, number]>) {
      const span = rmax - rmin + 1;
      const numer = (p - rmin) * (XCODE_MAX + 1);
      // Python integer ceiling division for non-negative numer/positive span.
      const pyCeil = -Math.floor(-numer / span);
      expect(paramValueToXcode(p, rmin, rmax)).toBe(pyCeil);
      expect(paramValueToXcode(p, rmin, rmax)).toBe(Math.ceil(numer / span));
    }
  });

  it('throws when paramValue is below rangeMin (L201)', () => {
    expect(() => paramValueToXcode(0, 1, 5)).toThrow(/outside/);
  });

  it('throws when paramValue is above rangeMax (L201)', () => {
    expect(() => paramValueToXcode(6, 1, 5)).toThrow(/outside/);
  });
});

// ---------------------------------------------------------------------------
// Inverse consistency:  xcodeToParamValue(paramValueToXcode(p)) === p
// ---------------------------------------------------------------------------

describe('xcodeToParamValue / paramValueToXcode inverse consistency', () => {
  // Mirrors Python TestParamValueToXcode.test_round_trip plus broader ranges.
  const RANGES: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [1, 3],
    [1, 5],
    [0, 9],
    [10, 20],
    [-5, 5],
    [0, 100],
    [0, XCODE_MAX], // span == XCODE_MAX+1: identity-like mapping
  ];

  for (const [rmin, rmax] of RANGES) {
    it(`param -> xcode -> param is identity for every value in [${rmin},${rmax}]`, () => {
      for (let p = rmin; p <= rmax; p++) {
        const x = paramValueToXcode(p, rmin, rmax);
        // Returned Xcode must itself be a legal Xcode value.
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(XCODE_MAX);
        expect(xcodeToParamValue(x, rmin, rmax)).toBe(p);
      }
    });
  }

  it('full-domain param round-trip when span equals the Xcode cardinality', () => {
    // span = XCODE_MAX+1 -> floor((x*span)/span) == x, so the mapping is the
    // identity on [0, XCODE_MAX]; paramValueToXcode must return p exactly.
    const rmin = 0;
    const rmax = XCODE_MAX; // span = 3844
    for (let p = 0; p <= XCODE_MAX; p += 7) {
      expect(paramValueToXcode(p, rmin, rmax)).toBe(p);
      expect(xcodeToParamValue(p, rmin, rmax)).toBe(p);
    }
  });
});
