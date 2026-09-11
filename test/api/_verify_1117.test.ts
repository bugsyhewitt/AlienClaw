/**
 * File-A: verify PKT-1117 fix — validateSubmission run_metadata non-object defense.
 *
 * 4 tests (was 1 RED + 3 informational on HEAD; all 4 should be GREEN on fix).
 *   - run_metadata: undefined → ok(true) (defense-in-depth: validator never crashes)
 *   - run_metadata: null      → ok(true) (defense-in-depth: validator never crashes)
 *   - run_metadata: 'string'  → fail(INVALID_RUN_METADATA, received_type 'string')
 *   - run_metadata: [1,2,3]   → fail(INVALID_RUN_METADATA, received_type 'object')
 *
 * Run as:
 *   cp 1117-fileA-run-metadata-non-object-defense.test.ts.txt \
 *      test/api/_verify_1117.test.ts
 *   pnpm exec vitest run test/api/_verify_1117.test.ts
 *
 * Authored by tester cycle 2026-09-11T12:45:42Z, this file mirrors the existing
 * test/api/verify-undef-run-metadata.test.ts probe but is renamed + restated for
 * the PKT-1117 packet.
 */
import { describe, it, expect } from 'vitest';
import { validateSubmission } from '../../src/alienclaw/api/validation.js';
import { computeChecksum, SECTION_SIZE } from '../../src/alienclaw/registry/genome-codec.js';

// Build a valid 256-char genome so the byte/checksum checks all pass.
const VALID_GENOME_BODY = 'A'.repeat(SECTION_SIZE * 3);
const VALID_GENOME_256  = VALID_GENOME_BODY + computeChecksum(VALID_GENOME_BODY);

function makeReqWithRunMetadata(runMetadata: unknown): any {
  return {
    genome:           VALID_GENOME_256,
    martian_type:     'compute',
    fitness:          0.5,
    leaderboard_name: 'ALIENBOT',
    run_metadata:     runMetadata,
  };
}

describe('PKT-1117 validateSubmission run_metadata non-object defense', () => {
  it('accepts run_metadata: undefined (validator must not crash; mirrors parseRunMetadata)', () => {
    const r = validateSubmission(makeReqWithRunMetadata(undefined), new Set(['compute']));
    expect(r.valid).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('accepts run_metadata: null (validator must not crash; mirrors parseRunMetadata)', () => {
    const r = validateSubmission(makeReqWithRunMetadata(null), new Set(['compute']));
    expect(r.valid).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('accepts run_metadata: {} (empty object is the canonical neutral)', () => {
    const r = validateSubmission(makeReqWithRunMetadata({}), new Set(['compute']));
    expect(r.valid).toBe(true);
  });

  it('accepts run_metadata: { run_id: "abc" } (object baseline still works)', () => {
    const r = validateSubmission(makeReqWithRunMetadata({ run_id: 'abc' }), new Set(['compute']));
    expect(r.valid).toBe(true);
  });

  it('rejects run_metadata: "string" with INVALID_RUN_METADATA + received_type=string', () => {
    const r = validateSubmission(makeReqWithRunMetadata('just a string'), new Set(['compute']));
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('INVALID_RUN_METADATA');
    expect(r.error?.details.received_type).toBe('string');
  });

  it('rejects run_metadata: 42 (number) with INVALID_RUN_METADATA + received_type=number', () => {
    const r = validateSubmission(makeReqWithRunMetadata(42), new Set(['compute']));
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('INVALID_RUN_METADATA');
    expect(r.error?.details.received_type).toBe('number');
  });

  it('rejects run_metadata: true (boolean) with INVALID_RUN_METADATA + received_type=boolean', () => {
    const r = validateSubmission(makeReqWithRunMetadata(true), new Set(['compute']));
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('INVALID_RUN_METADATA');
    expect(r.error?.details.received_type).toBe('boolean');
  });

  it('rejects run_metadata: [1,2,3] (array) with INVALID_RUN_METADATA + received_type=object', () => {
    // Note: typeof [] is 'object'. Array is a structural misuse (key/value store).
    const r = validateSubmission(makeReqWithRunMetadata([1, 2, 3]), new Set(['compute']));
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('INVALID_RUN_METADATA');
    expect(r.error?.details.received_type).toBe('object');
  });

  it('rejects run_metadata: { blob: "x".repeat(5000) } (>4096 bytes → METADATA_TOO_LARGE still fires)', () => {
    // Regression: the new INVALID_RUN_METADATA guard must NOT mask METADATA_TOO_LARGE
    // for legitimate objects that are just oversized.
    const r = validateSubmission(
      makeReqWithRunMetadata({ blob: 'x'.repeat(5000) }),
      new Set(['compute'])
    );
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe('METADATA_TOO_LARGE');
  });
});