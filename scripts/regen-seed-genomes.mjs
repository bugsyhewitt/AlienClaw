/**
 * scripts/regen-seed-genomes.mjs
 * One-off: recompute checksums for all seed .ms files and write them back.
 * Run with: node scripts/regen-seed-genomes.mjs
 *
 * Codec functions inlined verbatim from src/alienclaw/registry/genome-codec.ts
 * so this runs as plain Node without a TypeScript toolchain.
 * Does NOT modify genome body (blocks 0-6). Only fixes block 7 (checksum).
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Codec (inlined from genome-codec.ts, no changes) ─────────────────────────

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const GENOME_LENGTH   = 256;
const BLOCK_SIZE      = 32;

function computeChecksum(blocks0to6) {
  if (blocks0to6.length !== BLOCK_SIZE * 7) {
    throw new Error(`computeChecksum: expected ${BLOCK_SIZE * 7} chars, got ${blocks0to6.length}`);
  }
  let a = 0x811c9dc5 >>> 0;
  let b = 0xc59d1c81 >>> 0;
  for (let i = 0; i < blocks0to6.length; i++) {
    const ch = blocks0to6.charCodeAt(i);
    a = (Math.imul(a ^ ch,         0x01000193)) >>> 0;
    b = (Math.imul(b ^ (ch >>> 4), 0x01000193)) >>> 0;
  }
  let digits = '';
  let hi = a;
  let lo = b;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const idx = (hi ^ lo ^ i) % 62;
    digits += BASE62_ALPHABET[Math.abs(idx)];
    hi = (Math.imul(hi, 31) + lo + i) >>> 0;
    lo = (Math.imul(lo, 37) + hi)     >>> 0;
  }
  return digits;
}

function validateGenome(genome) {
  const errors = [];
  if (typeof genome !== 'string') return { valid: false, errors: ['Genome must be a string'] };
  if (genome.length !== GENOME_LENGTH) {
    errors.push(`Length must be ${GENOME_LENGTH}, got ${genome.length}`);
    return { valid: false, errors };
  }
  if (![...genome].every(c => BASE62_ALPHABET.includes(c))) {
    errors.push('Genome must contain only Base62 characters (0-9, A-Z, a-z)');
  }
  const body             = genome.slice(0, BLOCK_SIZE * 7);
  const storedChecksum   = genome.slice(BLOCK_SIZE * 7);
  const expectedChecksum = computeChecksum(body);
  if (storedChecksum !== expectedChecksum) {
    errors.push(`Checksum mismatch: stored="${storedChecksum}" expected="${expectedChecksum}"`);
  }
  return { valid: errors.length === 0, errors };
}

// ── Script ────────────────────────────────────────────────────────────────────

const __dirname   = dirname(fileURLToPath(import.meta.url));
const SEED_MS_DIR = join(__dirname, '..', 'seed', 'ms');
const BODY_LEN    = BLOCK_SIZE * 7; // 224

let allPassed = true;

for (const filename of readdirSync(SEED_MS_DIR).sort()) {
  if (!filename.endsWith('.ms')) continue;

  const filePath = join(SEED_MS_DIR, filename);
  const original = readFileSync(filePath, 'utf-8');
  const lines    = original.split('\n');

  const headerIdx = lines.findIndex(l => l.trim() === '[GENOME]');
  if (headerIdx === -1) {
    console.error(`[SKIP] ${filename}: no [GENOME] section`);
    allPassed = false;
    continue;
  }

  const genomeIdx    = headerIdx + 1;
  const currentGenome = lines[genomeIdx].trim();

  if (currentGenome.length !== GENOME_LENGTH) {
    console.error(`[SKIP] ${filename}: genome length=${currentGenome.length} (expected ${GENOME_LENGTH})`);
    allPassed = false;
    continue;
  }

  const body        = currentGenome.slice(0, BODY_LEN);
  const newChecksum = computeChecksum(body);
  const newGenome   = body + newChecksum;

  const result = validateGenome(newGenome);
  if (!result.valid) {
    console.error(`[FAIL] ${filename}: validate failed after recompute:`, result.errors);
    allPassed = false;
    continue;
  }

  if (newGenome === currentGenome) {
    console.log(`[OK]   ${filename}: checksum already correct`);
    continue;
  }

  lines[genomeIdx] = newGenome;
  writeFileSync(filePath, lines.join('\n'), 'utf-8');

  console.log(`[FIXED] ${filename}`);
  console.log(`        old: ...${currentGenome.slice(BODY_LEN)}`);
  console.log(`        new: ...${newChecksum}`);
  console.log(`        validate: PASS`);
}

console.log(allPassed ? '\nAll seed .ms files have valid genomes.' : '\nErrors — see above.');
if (!allPassed) process.exit(1);
