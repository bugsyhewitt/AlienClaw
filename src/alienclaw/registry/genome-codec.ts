/**
 * genome-codec.ts
 * Parse, validate, and inspect 256-char Base62 Meeseeks genomes.
 *
 * HARD INVARIANTS enforced here:
 *   - Genome is always exactly 256 chars
 *   - 4 sections × 64 chars
 *   - Section layout:
 *       0 IDENTITY  (chars   0– 63) — Meeseeks ID, generation, tool family
 *       1 EXECUTION (chars  64–127) — flow type, retry config, performance mode
 *       2 BEHAVIOR  (chars 128–191) — escalation policy, output contract
 *       3 CHECKSUM  (chars 192–255) — 64-char FNV-1a hash of sections 0–2
 *   - Sections 0–2 are mutable by CreatorBot only
 *   - Section 3 (checksum) is recomputed and immutable post-assembly
 *   - This codec is READ-ONLY from everyone else's perspective
 */

export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
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
  /** Section 0: Meeseeks identity — ID tag, generation marker, tool family */
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
  return [...s].every(c => BASE62_ALPHABET.includes(c));
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
