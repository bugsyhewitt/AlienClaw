/**
 * api-validation.test.ts — direct unit tests for the 4 untested exports in
 * src/alienclaw/api/validation.ts. The 5th export (`validateLeaderboardName`)
 * is already covered by test/governance/leaderboard.test.ts (12 cases) and
 * test/api/ts-api-server.test.ts (11 cases), both on origin/main.
 *
 * Coverage matrix (4 untested exports):
 *   validateSubmission      (line 37)  — 7 error codes: INVALID_GENOME_LENGTH,
 *                                       INVALID_GENOME_ALPHABET, INVALID_FITNESS_RANGE,
 *                                       UNKNOWN_MARTIAN_TYPE, MISSING_LEADERBOARD_NAME,
 *                                       INVALID_LEADERBOARD_NAME, METADATA_TOO_LARGE
 *   validateInstallRequest  (line 92)  — 2 error codes: INVALID_API_KEY_FORMAT,
 *                                       INVALID_MACHINE_HASH
 *   isValidApiKeyFormat     (line 108) — positive (43 Base62) + negative
 *                                       (non-43-length, non-Base62)
 *   isValidMachineHash      (line 112) — positive (64 hex lowercase) + negative
 *                                       (non-64-length, non-hex, mixed-case)
 *
 * Packet 055.
 */
import { describe, it, expect } from 'vitest';
import {
  validateSubmission,
  validateInstallRequest,
  isValidApiKeyFormat,
  isValidMachineHash,
} from '../../src/alienclaw/api/validation.js';
import { computeChecksum, SECTION_SIZE } from '../../src/alienclaw/registry/genome-codec.js';
import type {
  SubmissionRequest, InstallRequest,
} from '../../src/alienclaw/api/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────

// Build a 256-char genome with a valid checksum so validateSubmission's step-3
// (INVALID_GENOME_CHECKSUM) doesn't mask the error codes under test in steps 4+.
const _GENOME_BODY = 'A'.repeat(SECTION_SIZE * 3);
const VALID_GENOME_256 = _GENOME_BODY + computeChecksum(_GENOME_BODY);
const VALID_KEY_43     = 'A'.repeat(43);
const VALID_HASH_64    = 'a'.repeat(64);

function makeValidSubmission(): SubmissionRequest {
  return {
    genome:           VALID_GENOME_256,
    martian_type:     'search_text',
    fitness:          0.5,
    leaderboard_name: 'ALIENBOT',
    run_metadata:     { run_id: 'test-1', started_at: '2026-06-19T15:00:00Z' },
  };
}

function makeValidInstallRequest(): Pick<InstallRequest, 'api_key' | 'machine_hash'> {
  return { api_key: VALID_KEY_43, machine_hash: VALID_HASH_64 };
}

// ── validateSubmission ────────────────────────────────────────────────────

describe('validateSubmission', () => {
  it('accepts a fully-valid SubmissionRequest', () => {
    const r = validateSubmission(makeValidSubmission(), new Set(['search_text']));
    expect(r.valid).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('rejects when genome length is not 256 chars (returns INVALID_GENOME_LENGTH)', () => {
    const req = makeValidSubmission();
    req.genome = 'A'.repeat(64);  // 64 chars — the pre-PR-21 hash shape
    const r = validateSubmission(req, new Set(['search_text']));
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('INVALID_GENOME_LENGTH');
    expect(r.error?.details.received_length).toBe(64);
    expect(r.error?.details.required_length).toBe(256);
  });

  it('rejects when genome contains non-Base62 characters (returns INVALID_GENOME_ALPHABET)', () => {
    const req = makeValidSubmission();
    req.genome = '!'.repeat(256);  // '!' is not in 0-9A-Za-z
    const r = validateSubmission(req, new Set(['search_text']));
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('INVALID_GENOME_ALPHABET');
    expect((r.error?.details.invalid_chars as string[]).length).toBeGreaterThan(0);
  });

  it('rejects when fitness is out of [0,1] or non-numeric (returns INVALID_FITNESS_RANGE)', () => {
    for (const bad of [-0.1, 1.1, NaN, Infinity, -Infinity, '0.5' as unknown as number]) {
      const req = makeValidSubmission();
      req.fitness = bad;
      const r = validateSubmission(req, new Set(['search_text']));
      expect(r.valid).toBe(false);
      expect(r.error?.code).toBe('INVALID_FITNESS_RANGE');
    }
  });

  it('rejects when martian_type is not registered (returns UNKNOWN_MARTIAN_TYPE)', () => {
    const req = makeValidSubmission();
    req.martian_type = 'unregistered_type_xyz';
    const r = validateSubmission(req, new Set(['search_text', 'web_search']));
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('UNKNOWN_MARTIAN_TYPE');
    expect(r.error?.details.available).toEqual(['search_text', 'web_search']);
  });

  it('rejects when leaderboard_name is missing (returns MISSING_LEADERBOARD_NAME)', () => {
    const req = makeValidSubmission();
    req.leaderboard_name = '';
    const r = validateSubmission(req, new Set(['search_text']));
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('MISSING_LEADERBOARD_NAME');
  });

  it('rejects when leaderboard_name does not match ^[A-Z]{8}$ (returns INVALID_LEADERBOARD_NAME)', () => {
    for (const bad of ['alienbot', 'ALIEN-BT', 'ALIENBOTS', 'ALIENBT', '12345678']) {
      const req = makeValidSubmission();
      req.leaderboard_name = bad;
      const r = validateSubmission(req, new Set(['search_text']));
      expect(r.valid).toBe(false);
      expect(r.error?.code).toBe('INVALID_LEADERBOARD_NAME');
    }
  });

  it('rejects when run_metadata serialized > 4096 bytes (returns METADATA_TOO_LARGE)', () => {
    const req = makeValidSubmission();
    req.run_metadata = { blob: 'x'.repeat(5000) };
    const r = validateSubmission(req, new Set(['search_text']));
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('METADATA_TOO_LARGE');
    expect((r.error?.details.received_bytes as number)).toBeGreaterThan(4096);
  });
});

// ── validateInstallRequest ────────────────────────────────────────────────

describe('validateInstallRequest', () => {
  it('accepts a fully-valid InstallRequest', () => {
    const r = validateInstallRequest(makeValidInstallRequest());
    expect(r.valid).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('rejects when api_key is not 43 Base62 chars (returns INVALID_API_KEY_FORMAT)', () => {
    const req = makeValidInstallRequest();
    req.api_key = 'A'.repeat(42);  // 1 short
    const r = validateInstallRequest(req);
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('INVALID_API_KEY_FORMAT');
    expect(r.error?.details.received_length).toBe(42);
  });

  it('rejects when machine_hash is not 64 lowercase hex chars (returns INVALID_MACHINE_HASH)', () => {
    const req = makeValidInstallRequest();
    req.machine_hash = 'A'.repeat(64);  // uppercase — invalid
    const r = validateInstallRequest(req);
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('INVALID_MACHINE_HASH');
    expect(r.error?.details.received_length).toBe(64);
  });
});

// ── isValidApiKeyFormat ───────────────────────────────────────────────────

describe('isValidApiKeyFormat', () => {
  it('accepts 43 Base62 chars (all digits)', () => {
    expect(isValidApiKeyFormat('1'.repeat(43))).toBe(true);
  });
  it('accepts 43 Base62 chars (mixed digits + letters)', () => {
    // 'aB1' x 14 = 42 + 'a' = 43
    expect(isValidApiKeyFormat('aB1'.repeat(14) + 'a')).toBe(true);
  });
  it('rejects when length is not 43', () => {
    expect(isValidApiKeyFormat('A'.repeat(42))).toBe(false);
    expect(isValidApiKeyFormat('A'.repeat(44))).toBe(false);
    expect(isValidApiKeyFormat('')).toBe(false);
  });
  it('rejects when chars are not Base62', () => {
    expect(isValidApiKeyFormat('!'.repeat(43))).toBe(false);
    expect(isValidApiKeyFormat('-'.repeat(43))).toBe(false);
  });
});

// ── isValidMachineHash ────────────────────────────────────────────────────

describe('isValidMachineHash', () => {
  it('accepts 64 lowercase hex chars', () => {
    expect(isValidMachineHash('a'.repeat(64))).toBe(true);
    expect(isValidMachineHash('0123456789abcdef'.repeat(4))).toBe(true);
  });
  it('rejects when length is not 64', () => {
    expect(isValidMachineHash('a'.repeat(63))).toBe(false);
    expect(isValidMachineHash('a'.repeat(65))).toBe(false);
    expect(isValidMachineHash('')).toBe(false);
  });
  it('rejects when chars are not lowercase hex (uppercase A-F invalid)', () => {
    expect(isValidMachineHash('A'.repeat(64))).toBe(false);
  });
  it('rejects when chars are not hex at all', () => {
    expect(isValidMachineHash('z'.repeat(64))).toBe(false);
    expect(isValidMachineHash('g'.repeat(64))).toBe(false);
  });
});
