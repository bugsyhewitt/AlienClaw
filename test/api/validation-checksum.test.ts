/**
 * validation-checksum.test.ts
 *
 * Ship-gate for the genome checksum forgery-gap fix (Packet 31.5).
 *
 * validateSubmission() previously checked genome length + alphabet but NOT the
 * trailing 64-char CHECKSUM section. A tampered/forged genome with a valid
 * length and alphabet but a wrong checksum was accepted and persisted to the
 * leaderboard. These tests assert the new step rejects such genomes with the
 * canonical INVALID_GENOME_CHECKSUM code, while genomes built via
 * assembleGenome() (and the existing valid contract fixture) still pass.
 *
 * Pure unit tests — no DB, no HTTP server, no env-var dependencies. Calls
 * validateSubmission() directly so the suite is fast and fully headless.
 */

import { describe, it, expect } from 'vitest';

import {
  validateSubmission,
  type ValidationResult,
} from '../../src/alienclaw/api/validation.js';
import {
  assembleGenome,
  computeChecksum,
  GENOME_LENGTH,
  SECTION_SIZE,
  BASE62_ALPHABET,
} from '../../src/alienclaw/registry/genome-codec.js';
import type { SubmissionRequest } from '../../src/alienclaw/api/types.js';

// Martian type the submissions claim; registered so validation reaches/clears
// the martian-type check and either fails earlier (checksum) or returns ok().
const REGISTERED = new Set<string>(['compute']);

// Build a submission around a genome, with all *other* fields valid so the
// checksum step is the only thing that can fail (or the request is fully valid).
function submission(genome: string, overrides: Partial<SubmissionRequest> = {}): SubmissionRequest {
  return {
    genome,
    martian_type:     'compute',
    fitness:          0.5,
    leaderboard_name: 'TESTBOTA',
    run_metadata:     {},
    ...overrides,
  };
}

// A deterministic 192-char Base62 body (sections 0-2: IDENTITY/EXECUTION/BEHAVIOR).
function body192(seedStart = 7): string {
  let body = '';
  let seed = seedStart >>> 0;
  for (let i = 0; i < SECTION_SIZE * 3; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    body += BASE62_ALPHABET[seed % 62];
  }
  return body;
}

// Flip the final checksum character to a different Base62 char, corrupting the
// CHECKSUM section while keeping length=256 and the genome 100% Base62.
function corruptLastChar(genome: string): string {
  const last = genome[genome.length - 1]!;
  const replacement = last === 'X' ? 'Y' : 'X';
  return genome.slice(0, -1) + replacement;
}

describe('validateSubmission — genome checksum (forgery gap closed)', () => {
  it('SHIP-GATE: 256-char Base62 genome with corrupted checksum → valid:false, INVALID_GENOME_CHECKSUM', () => {
    const good = assembleGenome(body192().slice(0, 64), body192(99).slice(0, 64), body192(1234).slice(0, 64));
    const forged = corruptLastChar(good);

    // Sanity: the forgery is still a well-formed 256-char Base62 string, so it
    // would have passed the old length+alphabet-only validator.
    expect(forged).toHaveLength(GENOME_LENGTH);
    expect([...forged].every(c => BASE62_ALPHABET.includes(c))).toBe(true);
    expect(forged).not.toBe(good);

    const res: ValidationResult = validateSubmission(submission(forged), REGISTERED);
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe('INVALID_GENOME_CHECKSUM');
    // Error details surface both the stored and the expected checksum.
    expect(res.error?.details['received_checksum']).toBe(forged.slice(SECTION_SIZE * 3));
    expect(res.error?.details['expected_checksum']).toBe(computeChecksum(forged.slice(0, SECTION_SIZE * 3)));
  });

  it('SHIP-GATE: a genome assembled via assembleGenome() passes validation', () => {
    const genome = assembleGenome(
      'ID'.padEnd(SECTION_SIZE, '0'),
      'EXEC'.padEnd(SECTION_SIZE, 'A'),
      'BEHAVE'.padEnd(SECTION_SIZE, 'z'),
    );
    expect(genome).toHaveLength(GENOME_LENGTH);

    const res = validateSubmission(submission(genome), REGISTERED);
    expect(res.valid).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('rejects the exact corrupted-checksum genome from the API contract fixtures (genome-010)', () => {
    // Verbatim from test/fixtures/api-contract-fixtures.json (id genome-010):
    // a real genome with its final checksum char changed s→X.
    const fixtureCorrupted =
      'COMPUT01G1AlienClaw1d1HDjft5Q1DV1CeXDao0nhL9xK55qbojXyNYpcrZh2EH4E6HdMMCGwebAjANzdYgqmE1JGDwsJeOuSGFYGatODzV526cnQ3NzWyr0igXGd6QSxsGVBurIdb9lXmW0K1vspJ3sw5U4ll7TYGsQDXjCJzeRW7DKaED4dEur4EfD8wZEUDIAzeCHAqxUk9K8FOiZkI7YuzacnWclS69ySFoaT287oYPI0ZmihS8XcEdaqxX';
    expect(fixtureCorrupted).toHaveLength(GENOME_LENGTH);

    const res = validateSubmission(submission(fixtureCorrupted), REGISTERED);
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe('INVALID_GENOME_CHECKSUM');
  });

  it('accepts the valid-checksum sibling genome from the fixtures (genome-009 body, ends ...aqxs)', () => {
    // The genome-009 fixture genome has a *valid* checksum (only its
    // martian_type was unregistered in that case). With a registered type it
    // must clear the checksum step and pass.
    const fixtureValid =
      'COMPUT01G1AlienClaw1d1HDjft5Q1DV1CeXDao0nhL9xK55qbojXyNYpcrZh2EH4E6HdMMCGwebAjANzdYgqmE1JGDwsJeOuSGFYGatODzV526cnQ3NzWyr0igXGd6QSxsGVBurIdb9lXmW0K1vspJ3sw5U4ll7TYGsQDXjCJzeRW7DKaED4dEur4EfD8wZEUDIAzeCHAqxUk9K8FOiZkI7YuzacnWclS69ySFoaT287oYPI0ZmihS8XcEdaqxs';
    // Confirm it really is a valid-checksum genome before relying on it.
    expect(fixtureValid.slice(SECTION_SIZE * 3)).toBe(computeChecksum(fixtureValid.slice(0, SECTION_SIZE * 3)));

    const res = validateSubmission(submission(fixtureValid), REGISTERED);
    expect(res.valid).toBe(true);
  });

  it('a hand-crafted forged genome (all-Z body + zero-padded fake checksum) is rejected', () => {
    // Classic forgery attempt: plausible-looking sections with a guessed
    // checksum. Length + alphabet are fine; the checksum is wrong.
    const forged = 'Z'.repeat(SECTION_SIZE * 3) + '0'.repeat(SECTION_SIZE);
    expect(forged).toHaveLength(GENOME_LENGTH);

    const res = validateSubmission(submission(forged), REGISTERED);
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe('INVALID_GENOME_CHECKSUM');
  });

  it('checksum check runs before martian-type: forged genome + unknown type → INVALID_GENOME_CHECKSUM', () => {
    const good = assembleGenome(body192().slice(0, 64), body192(99).slice(0, 64), body192(1234).slice(0, 64));
    const forged = corruptLastChar(good);

    const res = validateSubmission(
      submission(forged, { martian_type: 'nonexistent' }),
      REGISTERED,
    );
    expect(res.valid).toBe(false);
    // Checksum is validated (step 3) before martian_type (step 5).
    expect(res.error?.code).toBe('INVALID_GENOME_CHECKSUM');
  });

  it('length error still takes precedence over checksum (short genome)', () => {
    const res = validateSubmission(submission('TOOSHORT'), REGISTERED);
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe('INVALID_GENOME_LENGTH');
  });

  it('alphabet error still takes precedence over checksum (non-Base62 char)', () => {
    // 256 chars but one is '!', so the alphabet check fires before checksum.
    const bad = '!'.repeat(1) + 'a'.repeat(GENOME_LENGTH - 1);
    expect(bad).toHaveLength(GENOME_LENGTH);
    const res = validateSubmission(submission(bad), REGISTERED);
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe('INVALID_GENOME_ALPHABET');
  });

  it('a fully valid assembled genome still passes downstream checks (fitness/name)', () => {
    const genome = assembleGenome(
      'A'.repeat(SECTION_SIZE),
      'B'.repeat(SECTION_SIZE),
      'C'.repeat(SECTION_SIZE),
    );
    // Valid checksum but bad fitness → fitness error (proves checksum passed).
    const badFitness = validateSubmission(submission(genome, { fitness: 1.5 }), REGISTERED);
    expect(badFitness.error?.code).toBe('INVALID_FITNESS_RANGE');

    // Valid checksum, bad leaderboard name → name error.
    const badName = validateSubmission(submission(genome, { leaderboard_name: 'lower' }), REGISTERED);
    expect(badName.error?.code).toBe('INVALID_LEADERBOARD_NAME');
  });
});
