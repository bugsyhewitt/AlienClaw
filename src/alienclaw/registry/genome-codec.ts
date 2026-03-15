/**
 * genome-codec.ts
 * Parse, validate, and inspect 256-char Base62 Meeseeks genomes.
 *
 * HARD INVARIANTS enforced here:
 *   - Genome is always exactly 256 chars
 *   - 8 blocks × 32 chars
 *   - Block 0 (header) and Block 7 (checksum) are IMMUTABLE
 *   - Only CreatorBot may write or mutate .ms genome files
 *   - This codec is READ-ONLY from everyone else's perspective
 */

export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const GENOME_LENGTH = 256;
export const BLOCK_SIZE    = 32;
export const BLOCK_COUNT   = 8;

export const BLOCK = {
  HEADER:           0,
  TOOL_DECLARATION: 1,
  EXECUTION_FLOW:   2,
  RETRY_LOGIC:      3,
  ESCALATION:       4,
  PERFORMANCE:      5,
  OUTPUT_CONTRACT:  6,
  CHECKSUM:         7,
} as const;

export type BlockIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface GenomeBlocks {
  header:          string;
  toolDeclaration: string;
  executionFlow:   string;
  retryLogic:      string;
  escalation:      string;
  performance:     string;
  outputContract:  string;
  checksum:        string;
}

export interface GenomeValidationResult {
  valid:  boolean;
  errors: string[];
}

function isBase62(s: string): boolean {
  return [...s].every(c => BASE62_ALPHABET.includes(c));
}

/**
 * Compute a deterministic 32-char Base62 checksum over blocks 0-6.
 * FNV-1a-inspired rolling hash, mapped to Base62.
 */
export function computeChecksum(blocks0to6: string): string {
  if (blocks0to6.length !== BLOCK_SIZE * 7) {
    throw new Error(
      `computeChecksum: expected ${BLOCK_SIZE * 7} chars, got ${blocks0to6.length}`
    );
  }

  let a = 0x811c9dc5 >>> 0;
  let b = 0xc59d1c81 >>> 0;
  for (let i = 0; i < blocks0to6.length; i++) {
    const ch = blocks0to6.charCodeAt(i);
    a = (Math.imul(a ^ ch,          0x01000193)) >>> 0;
    b = (Math.imul(b ^ (ch >>> 4),  0x01000193)) >>> 0;
  }

  // Produce 32 Base62 chars from two 32-bit values
  let digits = '';
  let carry  = (a * 0x100000000 + b);   // NOTE: this is a float but fine for mod
  // Work in integer space to stay deterministic
  let hi = a;
  let lo = b;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const idx = (hi ^ lo ^ i) % 62;
    digits += BASE62_ALPHABET[Math.abs(idx)];
    hi = (Math.imul(hi, 31) + lo + i) >>> 0;
    lo = (Math.imul(lo, 37) + hi)     >>> 0;
  }
  void carry; // unused — suppress lint
  return digits;
}

export function parseGenome(genome: string): GenomeBlocks {
  if (genome.length !== GENOME_LENGTH) {
    throw new Error(`Genome must be exactly ${GENOME_LENGTH} chars; got ${genome.length}`);
  }
  const g = (n: BlockIndex) => genome.slice(n * BLOCK_SIZE, (n + 1) * BLOCK_SIZE);
  return {
    header:          g(0),
    toolDeclaration: g(1),
    executionFlow:   g(2),
    retryLogic:      g(3),
    escalation:      g(4),
    performance:     g(5),
    outputContract:  g(6),
    checksum:        g(7),
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

  const blocks0to6      = genome.slice(0, BLOCK_SIZE * 7);
  const storedChecksum  = genome.slice(BLOCK_SIZE * 7);
  const expectedChecksum = computeChecksum(blocks0to6);

  if (storedChecksum !== expectedChecksum) {
    errors.push(
      `Checksum mismatch: stored="${storedChecksum}" expected="${expectedChecksum}"`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Assemble a full genome from mutable blocks + an immutable header.
 * ONLY called by CreatorBot. Computes checksum automatically.
 */
export function assembleGenome(
  headerBlock:     string,
  toolDeclaration: string,
  executionFlow:   string,
  retryLogic:      string,
  escalation:      string,
  performance:     string,
  outputContract:  string,
): string {
  const blocks = [
    headerBlock, toolDeclaration, executionFlow,
    retryLogic,  escalation,      performance, outputContract,
  ];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].length !== BLOCK_SIZE) {
      throw new Error(`Block ${i} must be exactly ${BLOCK_SIZE} chars; got ${blocks[i].length}`);
    }
    if (!isBase62(blocks[i])) {
      throw new Error(`Block ${i} contains non-Base62 characters`);
    }
  }
  const body     = blocks.join('');
  const checksum = computeChecksum(body);
  return body + checksum;
}
