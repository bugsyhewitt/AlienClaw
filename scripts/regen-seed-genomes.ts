/**
 * scripts/regen-seed-genomes.ts
 * One-off: recompute checksums for all seed .ms files and write them back.
 * Run with: node --import tsx scripts/regen-seed-genomes.ts
 *
 * Does NOT modify genome body (blocks 0-6). Only fixes block 7 (checksum).
 * Does NOT touch genome-codec.ts.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeChecksum,
  validateGenome,
  GENOME_LENGTH,
  BLOCK_SIZE,
} from '../src/alienclaw/registry/genome-codec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_MS_DIR = join(__dirname, '..', 'seed', 'ms');

const BODY_LENGTH = BLOCK_SIZE * 7; // 224 chars — blocks 0-6

let allPassed = true;

for (const filename of readdirSync(SEED_MS_DIR).sort()) {
  if (!filename.endsWith('.ms')) continue;

  const filePath = join(SEED_MS_DIR, filename);
  const original = readFileSync(filePath, 'utf-8');

  // Find the genome line: the line immediately after '[GENOME]'
  const lines = original.split('\n');
  const genomeHeaderIdx = lines.findIndex(l => l.trim() === '[GENOME]');
  if (genomeHeaderIdx === -1) {
    console.error(`[SKIP] ${filename}: no [GENOME] section found`);
    allPassed = false;
    continue;
  }

  const genomeLineIdx = genomeHeaderIdx + 1;
  const currentGenome = lines[genomeLineIdx].trim();

  if (currentGenome.length !== GENOME_LENGTH) {
    console.error(
      `[SKIP] ${filename}: genome is ${currentGenome.length} chars (expected ${GENOME_LENGTH})`
    );
    allPassed = false;
    continue;
  }

  // Extract body (blocks 0-6) and recompute checksum
  const body        = currentGenome.slice(0, BODY_LENGTH);
  const newChecksum = computeChecksum(body);
  const newGenome   = body + newChecksum;

  // Validate
  const result = validateGenome(newGenome);
  if (!result.valid) {
    console.error(`[FAIL] ${filename}: validation failed after recompute:`, result.errors);
    allPassed = false;
    continue;
  }

  if (newGenome === currentGenome) {
    console.log(`[OK]   ${filename}: checksum already correct — no change needed`);
    continue;
  }

  // Write back, preserving everything except the genome line
  lines[genomeLineIdx] = newGenome;
  writeFileSync(filePath, lines.join('\n'), 'utf-8');

  console.log(`[FIXED] ${filename}`);
  console.log(`        old checksum: ${currentGenome.slice(BODY_LENGTH)}`);
  console.log(`        new checksum: ${newChecksum}`);
  console.log(`        validate: PASS`);
}

if (allPassed) {
  console.log('\nAll seed .ms files have valid genomes.');
} else {
  console.error('\nOne or more files failed — see errors above.');
  process.exit(1);
}
