/**
 * genome-codec.ts
 * Parse, validate, and inspect 256-char Base62 Martian genomes.
 *
 * HARD INVARIANTS enforced here:
 *   - Genome is always exactly 256 chars
 *   - 4 sections × 64 chars
 *   - Section layout:
 *       0 IDENTITY  (chars   0– 63) — Martian ID, generation, tool family
 *       1 EXECUTION (chars  64–127) — flow type, retry config, performance mode
 *       2 BEHAVIOR  (chars 128–191) — escalation policy, output contract
 *       3 CHECKSUM  (chars 192–255) — 64-char FNV-1a hash of sections 0–2
 *   - Sections 0–2 are mutable by CreatorBot only
 *   - Section 3 (checksum) is recomputed and immutable post-assembly
 *   - This codec is READ-ONLY from everyone else's perspective
 */

export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const _base62Set = new Set(BASE62_ALPHABET);
export const GENOME_LENGTH   = 256;
export const SECTION_SIZE    = 64;
export const SECTION_COUNT   = 4;

export const SECTION = {
  IDENTITY:  0,
  EXECUTION: 1,
  BEHAVIOR:  2,
  CHECKSUM:  3,
} as const;

export type SectionIndex = 0 | 1 | 2 | 3;

export interface GenomeSections {
  /** Section 0: Martian identity — ID tag, generation marker, tool family */
  identity:  string;
  /** Section 1: Execution parameters — flow, retry count/backoff, perf mode */
  execution: string;
  /** Section 2: Behavioral rules — escalation policy, output contract type */
  behavior:  string;
  /** Section 3: Integrity checksum (read-only; recomputed on assembly) */
  checksum:  string;
}

export interface GenomeValidationResult {
  valid:  boolean;
  errors: string[];
}

function isBase62(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (!_base62Set.has(s[i]!)) return false;
  }
  return true;
}

/**
 * Compute a deterministic 64-char Base62 checksum over sections 0–2 (192 chars).
 * FNV-1a-inspired rolling hash, mapped to Base62.
 */
export function computeChecksum(sections012: string): string {
  const expected = SECTION_SIZE * 3;
  if (sections012.length !== expected) {
    throw new Error(
      `computeChecksum: expected ${expected} chars, got ${sections012.length}`
    );
  }

  let a = 0x811c9dc5 >>> 0;
  let b = 0xc59d1c81 >>> 0;
  for (let i = 0; i < sections012.length; i++) {
    const ch = sections012.charCodeAt(i);
    a = (Math.imul(a ^ ch,         0x01000193)) >>> 0;
    b = (Math.imul(b ^ (ch >>> 4), 0x01000193)) >>> 0;
  }

  // Produce 64 Base62 chars from two 32-bit values
  let digits = '';
  let hi = a;
  let lo = b;
  for (let i = 0; i < SECTION_SIZE; i++) {
    const idx = (hi ^ lo ^ i) % 62;
    digits += BASE62_ALPHABET[Math.abs(idx)];
    hi = (Math.imul(hi, 31) + lo + i) >>> 0;
    lo = (Math.imul(lo, 37) + hi)     >>> 0;
  }
  return digits;
}

export function parseGenome(genome: string): GenomeSections {
  if (genome.length !== GENOME_LENGTH) {
    throw new Error(`Genome must be exactly ${GENOME_LENGTH} chars; got ${genome.length}`);
  }
  const s = (n: SectionIndex) => genome.slice(n * SECTION_SIZE, (n + 1) * SECTION_SIZE);
  return {
    identity:  s(0),
    execution: s(1),
    behavior:  s(2),
    checksum:  s(3),
  };
}

export function validateGenome(genome: string): GenomeValidationResult {
  const errors: string[] = [];

  if (typeof genome !== 'string') {
    return { valid: false, errors: ['Genome must be a string'] };
  }
  if (genome.length !== GENOME_LENGTH) {
    errors.push(`Length must be ${GENOME_LENGTH}, got ${genome.length}`);
    return { valid: false, errors };
  }
  if (!isBase62(genome)) {
    errors.push('Genome must contain only Base62 characters (0-9, A-Z, a-z)');
  }

  const body            = genome.slice(0, SECTION_SIZE * 3);
  const storedChecksum  = genome.slice(SECTION_SIZE * 3);
  const expectedChecksum = computeChecksum(body);

  if (storedChecksum !== expectedChecksum) {
    errors.push(
      `Checksum mismatch: stored="${storedChecksum}" expected="${expectedChecksum}"`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Assemble a full 256-char genome from 3 mutable sections + auto-computed checksum.
 * ONLY called by CreatorBot. Each section must be exactly 64 Base62 chars.
 */
export function assembleGenome(
  identity:  string,
  execution: string,
  behavior:  string,
): string {
  const sections = [identity, execution, behavior];
  const names    = ['identity', 'execution', 'behavior'];
  for (let i = 0; i < sections.length; i++) {
    if (sections[i]!.length !== SECTION_SIZE) {
      throw new Error(
        `Section ${i} (${names[i]}) must be exactly ${SECTION_SIZE} chars; got ${sections[i]!.length}`
      );
    }
    if (!isBase62(sections[i]!)) {
      throw new Error(`Section ${i} (${names[i]}) contains non-Base62 characters`);
    }
  }
  const body     = sections.join('');
  const checksum = computeChecksum(body);
  return body + checksum;
}

// ---------------------------------------------------------------------------
// Xcode encoding helpers (ARCHITECTURE §3)
// ---------------------------------------------------------------------------

export const XCODE_MAX = 62 * 62 - 1; // 3843

const _xcodeIndex: Record<string, number> = {};
for (let i = 0; i < BASE62_ALPHABET.length; i++) {
  _xcodeIndex[BASE62_ALPHABET[i]!] = i;
}

/**
 * Read one Xcode (2 Base62 chars) from a genome slot.
 * slotIndex: 0..3 (which 64-char section)
 * xcodeIndex: 0..30 (which Xcode pair within bytes 1-62 of the slot)
 */
export function decodeXcode(genome: string, slotIndex: number, xcodeIndex: number): number {
  if (slotIndex < 0 || slotIndex > 3) throw new Error(`slotIndex out of range [0,3]: ${slotIndex}`);
  if (xcodeIndex < 0 || xcodeIndex > 30) throw new Error(`xcodeIndex out of range [0,30]: ${xcodeIndex}`);
  const base = slotIndex * 64 + 1 + xcodeIndex * 2;
  return (_xcodeIndex[genome[base]!] ?? 0) * 62 + (_xcodeIndex[genome[base + 1]!] ?? 0);
}

/**
 * Encode an int in [0, XCODE_MAX] as 2 Base62 chars.
 */
export function encodeXcode(value: number): string {
  if (value < 0 || value > XCODE_MAX) throw new Error(`xcode value out of range [0,${XCODE_MAX}]: ${value}`);
  return BASE62_ALPHABET[Math.floor(value / 62)]! + BASE62_ALPHABET[value % 62]!;
}

/**
 * Map Xcode value (0..3843) to parameter value (rangeMin..rangeMax) linearly.
 * Mirrors Python: (xcode_value * span) // (XCODE_MAX + 1) + range_min
 */
export function xcodeToParamValue(xcodeValue: number, rangeMin: number, rangeMax: number): number {
  if (rangeMin > rangeMax) throw new Error(`rangeMin > rangeMax: ${rangeMin}, ${rangeMax}`);
  const span = rangeMax - rangeMin + 1;
  return Math.floor((xcodeValue * span) / (XCODE_MAX + 1)) + rangeMin;
}

/**
 * Inverse of xcodeToParamValue (returns minimum Xcode that maps to paramValue).
 * Uses ceiling division to mirror Python's `-(-numer // span)`.
 */
export function paramValueToXcode(paramValue: number, rangeMin: number, rangeMax: number): number {
  if (paramValue < rangeMin || paramValue > rangeMax) {
    throw new Error(`paramValue ${paramValue} outside [${rangeMin},${rangeMax}]`);
  }
  const span = rangeMax - rangeMin + 1;
  const numer = (paramValue - rangeMin) * (XCODE_MAX + 1);
  return Math.ceil(numer / span);
}
