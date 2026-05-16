/**
 * genome-operators.ts
 * Step-based directional Xcode mutation per ARCHITECTURE §5.
 * TypeScript mirror of src/alienclaw/genome/operators.py mutate_directed().
 *
 * Note: Python's random.Random is not byte-compatible with any JS PRNG, so
 * cross-language determinism is not tested. Compliance is one-way: Python
 * outputs satisfy the TS validator (see mutate_invariant fixture cases).
 */

import {
  encodeXcode,
  xcodeToParamValue,
  paramValueToXcode,
  computeChecksum,
  BASE62_ALPHABET,
} from './genome-codec.js';

export const PER_XCODE_MUTATION_RATE = 2.0 / 256.0;

const STEP_DISTRIBUTION: ReadonlyArray<readonly [number, number]> = [
  [1, 0.60],
  [2, 0.25],
  [3, 0.10],
  [4, 0.05],
];

const DIRECTION_BIAS_LOWER  = 0.70;
const DIRECTION_BIAS_HIGHER = 0.30;
const DIRECTION_BIAS_NONE   = 0.50;

export interface ParameterField {
  xcodeIndex: number;
  rangeMin:   number;
  rangeMax:   number;
  direction:  'lower' | 'higher' | 'none';
}

export interface SlotBrain {
  parameterSchema: ParameterField[];
}

function sampleStepMagnitude(rand: () => number): number {
  const r = rand();
  let cumulative = 0;
  for (const [mag, prob] of STEP_DISTRIBUTION) {
    cumulative += prob;
    if (r < cumulative) return mag;
  }
  return STEP_DISTRIBUTION[STEP_DISTRIBUTION.length - 1]![0];
}

/**
 * Step-based directional mutation — TypeScript mirror of Python mutate_directed().
 *
 * @param genome     256-char Base62 genome string
 * @param slotBrains Array of 4 brain entries (null = empty slot). Slots 0 and 3 skipped.
 * @param rand       Seeded random function returning floats in [0, 1)
 * @param rate       Per-Xcode mutation probability (default: PER_XCODE_MUTATION_RATE)
 */
export function mutateDirected(
  genome: string,
  slotBrains: ReadonlyArray<SlotBrain | null>,
  rand: () => number,
  rate: number = PER_XCODE_MUTATION_RATE,
): string {
  if (genome.length !== 256) throw new Error(`genome must be 256 chars, got ${genome.length}`);

  const idx: Record<string, number> = {};
  for (let i = 0; i < BASE62_ALPHABET.length; i++) idx[BASE62_ALPHABET[i]!] = i;

  const chars = genome.slice(0, 192).split('');

  // Only mutate slots 1 and 2 (EXECUTION + BEHAVIOR)
  for (const slotIdx of [1, 2] as const) {
    if (slotIdx >= slotBrains.length) continue;
    const brain = slotBrains[slotIdx];
    if (!brain || !brain.parameterSchema.length) continue;

    for (const field of brain.parameterSchema) {
      if (rand() >= rate) continue;

      const base      = slotIdx * 64 + 1 + field.xcodeIndex * 2;
      const currXcode = (idx[chars[base]!] ?? 0) * 62 + (idx[chars[base + 1]!] ?? 0);
      const currParam = xcodeToParamValue(currXcode, field.rangeMin, field.rangeMax);

      const stepMag = sampleStepMagnitude(rand);
      const pNeg    = field.direction === 'lower'  ? DIRECTION_BIAS_LOWER
                    : field.direction === 'higher' ? DIRECTION_BIAS_HIGHER
                    : DIRECTION_BIAS_NONE;
      const step    = rand() < pNeg ? -stepMag : stepMag;

      const newParam = Math.max(field.rangeMin, Math.min(field.rangeMax, currParam + step));
      if (newParam === currParam) continue;

      const newXcode = paramValueToXcode(newParam, field.rangeMin, field.rangeMax);
      const enc      = encodeXcode(newXcode);
      chars[base]     = enc[0]!;
      chars[base + 1] = enc[1]!;
    }
  }

  const body     = chars.join('');
  const checksum = computeChecksum(body);
  return body + checksum;
}
