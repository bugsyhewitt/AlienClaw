/**
 * Server-side validation for genome submissions.
 * TypeScript port of api/validation.py (Packet 31.5).
 *
 * Behavioral equivalence: all Python test cases produce identical results,
 * including genome checksum validation. The checksum step reuses the codec's
 * computeChecksum() so the server rejects any genome whose trailing 64-char
 * CHECKSUM section does not match the FNV-dual-hash of sections 0-2. This
 * closes the forgery gap: a tampered or hand-crafted genome with valid length
 * and alphabet but an invalid checksum is now refused, not persisted.
 */

import { BASE62_ALPHABET, computeChecksum, SECTION_SIZE } from '../registry/genome-codec.js';
import { GENOME_LENGTH } from '../constants.js';
import type { SubmissionRequest, InstallRequest } from './types.js';

const _BASE62_SET = new Set(BASE62_ALPHABET);
// Sections 0-2 (IDENTITY, EXECUTION, BEHAVIOR) occupy the first 192 chars;
// section 3 (CHECKSUM) is the trailing 64 chars verified against them.
const _GENOME_BODY_LENGTH = SECTION_SIZE * 3;
const _LEADERBOARD_NAME_RE = /^[A-Z]{8}$/;
const _API_KEY_LENGTH = 43;

export interface ValidationResult {
  valid: boolean;
  error?: { code: string; message: string; details: Record<string, unknown> };
}

function ok(): ValidationResult { return { valid: true }; }

function fail(
  code: string,
  message: string,
  details: Record<string, unknown> = {}
): ValidationResult {
  return { valid: false, error: { code, message, details } };
}

export function validateLeaderboardName(name: string): boolean {
  return _LEADERBOARD_NAME_RE.test(name);
}

export function validateSubmission(
  req: SubmissionRequest,
  registeredTypes: Set<string>,
): ValidationResult {
  // 1. Genome length
  if (req.genome.length !== GENOME_LENGTH) {
    return fail('INVALID_GENOME_LENGTH',
      `Genome must be exactly ${GENOME_LENGTH} characters; got ${req.genome.length}.`,
      { received_length: req.genome.length, required_length: GENOME_LENGTH });
  }

  // 2. Genome alphabet
  const bad = [...req.genome].filter(c => !_BASE62_SET.has(c));
  if (bad.length > 0) {
    return fail('INVALID_GENOME_ALPHABET',
      `Genome contains ${bad.length} non-Base62 character(s).`,
      { invalid_chars: bad.slice(0, 5) });
  }

  // 3. Genome checksum — the trailing 64-char CHECKSUM section must equal the
  // FNV-dual-hash of sections 0-2. Rejects tampered/forged genomes (forgery gap).
  // Safe to run here: length (256) and alphabet are already validated above, so
  // the body slice is exactly 192 Base62 chars and computeChecksum cannot throw.
  const storedChecksum   = req.genome.slice(_GENOME_BODY_LENGTH);
  const expectedChecksum = computeChecksum(req.genome.slice(0, _GENOME_BODY_LENGTH));
  if (storedChecksum !== expectedChecksum) {
    return fail('INVALID_GENOME_CHECKSUM',
      'Genome checksum does not match its contents; the genome may be forged or corrupted.',
      { received_checksum: storedChecksum, expected_checksum: expectedChecksum });
  }

  // 4. Fitness range
  if (typeof req.fitness !== 'number' || req.fitness < 0 || req.fitness > 1 || !isFinite(req.fitness)) {
    return fail('INVALID_FITNESS_RANGE',
      `fitness must be in [0.0, 1.0]; got ${req.fitness}.`,
      { received: req.fitness });
  }

  // 5. Martian type registered
  if (!registeredTypes.has(req.martian_type)) {
    return fail('UNKNOWN_MARTIAN_TYPE',
      `martian_type '${req.martian_type}' is not registered.`,
      { available: [...registeredTypes].sort() });
  }

  // 6. Leaderboard name: exactly 8 uppercase letters
  if (!req.leaderboard_name) {
    return fail('MISSING_LEADERBOARD_NAME',
      'leaderboard_name is required. Choose 8 uppercase letters (e.g. ALIENBOT).');
  }
  if (!_LEADERBOARD_NAME_RE.test(req.leaderboard_name)) {
    return fail('INVALID_LEADERBOARD_NAME',
      'leaderboard_name must be exactly 8 uppercase ASCII letters (A-Z).',
      { received: req.leaderboard_name, pattern: '^[A-Z]{8}$' });
  }

  // 7. run_metadata size
  const metaBytes = JSON.stringify(req.run_metadata).length;
  if (metaBytes > 4096) {
    return fail('METADATA_TOO_LARGE',
      `run_metadata exceeds 4096 bytes (${metaBytes} bytes serialized).`,
      { received_bytes: metaBytes, limit_bytes: 4096 });
  }

  return ok();
}

export function validateInstallRequest(
  req: Pick<InstallRequest, 'api_key' | 'machine_hash'>
): ValidationResult {
  if (!isValidApiKeyFormat(req.api_key)) {
    return fail('INVALID_API_KEY_FORMAT',
      'api_key must be exactly 43 Base62 characters.',
      { received_length: req.api_key.length });
  }
  if (!isValidMachineHash(req.machine_hash)) {
    return fail('INVALID_MACHINE_HASH',
      'machine_hash must be exactly 64 lowercase hex characters.',
      { received_length: req.machine_hash.length });
  }
  return ok();
}

export function isValidApiKeyFormat(key: string): boolean {
  return key.length === _API_KEY_LENGTH && [...key].every(c => _BASE62_SET.has(c));
}

export function isValidMachineHash(h: string): boolean {
  return h.length === 64 && /^[0-9a-f]{64}$/.test(h);
}
