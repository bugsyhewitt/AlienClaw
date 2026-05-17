/**
 * Server-side validation for genome submissions.
 * TypeScript port of api/validation.py (Packet 31.5).
 *
 * Behavioral equivalence: all Python test cases produce identical results.
 * Known difference: Python version validates genome checksum; this version
 * validates length + alphabet only (no TS checksum equivalent available).
 */

import { BASE62_ALPHABET } from '../registry/genome-codec.js';
import { GENOME_LENGTH } from '../constants.js';
import type { SubmissionRequest, InstallRequest } from './types.js';

const _BASE62_SET = new Set(BASE62_ALPHABET);
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

  // 3. Fitness range
  if (typeof req.fitness !== 'number' || req.fitness < 0 || req.fitness > 1 || !isFinite(req.fitness)) {
    return fail('INVALID_FITNESS_RANGE',
      `fitness must be in [0.0, 1.0]; got ${req.fitness}.`,
      { received: req.fitness });
  }

  // 4. Martian type registered
  if (!registeredTypes.has(req.martian_type)) {
    return fail('UNKNOWN_MARTIAN_TYPE',
      `martian_type '${req.martian_type}' is not registered.`,
      { available: [...registeredTypes].sort() });
  }

  // 5. Leaderboard name: exactly 8 uppercase letters
  if (!req.leaderboard_name) {
    return fail('MISSING_LEADERBOARD_NAME',
      'leaderboard_name is required. Choose 8 uppercase letters (e.g. ALIENBOT).');
  }
  if (!_LEADERBOARD_NAME_RE.test(req.leaderboard_name)) {
    return fail('INVALID_LEADERBOARD_NAME',
      'leaderboard_name must be exactly 8 uppercase ASCII letters (A-Z).',
      { received: req.leaderboard_name, pattern: '^[A-Z]{8}$' });
  }

  // 6. run_metadata size
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
