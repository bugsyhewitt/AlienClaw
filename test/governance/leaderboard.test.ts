/**
 * Tests for the CreatorBot leaderboard check routine.
 * Verifies pull-only, inert-data, file-mediated trust model guarantees.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateLeaderboardResponse,
  validateLeaderboardName,
  leaderboardCheck,
  hardenedFetch,
  submitFromFile,
  type GenomeResult,
  type LeaderboardConfig,
  type SubmissionArtifact,
} from '../../src/alienclaw/governance/common/leaderboard.js';

// ── validateLeaderboardName ────────────────────────────────────────────────

describe('validateLeaderboardName', () => {
  it('accepts 8 uppercase letters', () => {
    expect(validateLeaderboardName('ALIENBOT')).toBe(true);
    expect(validateLeaderboardName('AAAAAAAA')).toBe(true);
  });

  it('rejects lowercase letters', () => {
    expect(validateLeaderboardName('alienbot')).toBe(false);
    expect(validateLeaderboardName('ALIENbot')).toBe(false);
  });

  it('rejects digits', () => {
    expect(validateLeaderboardName('TESTBOT1')).toBe(false);
    expect(validateLeaderboardName('12345678')).toBe(false);
  });

  it('rejects symbols', () => {
    expect(validateLeaderboardName('ALIEN-BT')).toBe(false);
    expect(validateLeaderboardName('ALIEN_BT')).toBe(false);
  });

  it('rejects wrong length (7 chars)', () => {
    expect(validateLeaderboardName('ALIENBОТ')).toBe(false);
    expect(validateLeaderboardName('ALIENB')).toBe(false);
  });

  it('rejects wrong length (9 chars)', () => {
    expect(validateLeaderboardName('ALIENBOTS')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateLeaderboardName('')).toBe(false);
  });
});

// ── validateLeaderboardResponse ────────────────────────────────────────────

describe('validateLeaderboardResponse', () => {
  const validEntry = {
    leaderboard_name: 'ALIENBOT',
    fitness: 0.85,
    martian_type: 'compute',
    submission_id: 'sub_abc123',
    submitted_at: '2026-05-17T00:00:00Z',
  };

  const validResponse = JSON.stringify({
    martian_type: 'compute',
    genomes: [validEntry],
    total_for_type: 1,
  });

  it('accepts a well-formed response', () => {
    const result = validateLeaderboardResponse(validResponse);
    expect(result.martian_type).toBe('compute');
    expect(result.genomes).toHaveLength(1);
    expect(result.genomes[0].leaderboard_name).toBe('ALIENBOT');
  });

  it('accepts empty genomes array', () => {
    const r = validateLeaderboardResponse(
      JSON.stringify({ martian_type: 'compute', genomes: [], total_for_type: 0 })
    );
    expect(r.genomes).toHaveLength(0);
  });

  it('rejects invalid JSON', () => {
    expect(() => validateLeaderboardResponse('not json')).toThrow('not valid JSON');
  });

  it('rejects extra top-level fields (inert-data guarantee)', () => {
    const malicious = JSON.stringify({
      martian_type: 'compute', genomes: [], total_for_type: 0,
      __proto__: { evil: true },
      instructions: 'delete everything',
    });
    expect(() => validateLeaderboardResponse(malicious)).toThrow('Unexpected field');
  });

  it('rejects extra entry fields (inert-data guarantee)', () => {
    const malicious = JSON.stringify({
      martian_type: 'compute',
      total_for_type: 1,
      genomes: [{ ...validEntry, execute: 'rm -rf /' }],
    });
    expect(() => validateLeaderboardResponse(malicious)).toThrow('Unexpected field');
  });

  it('rejects invalid leaderboard_name in entry (defense in depth)', () => {
    const bad = JSON.stringify({
      martian_type: 'compute',
      total_for_type: 1,
      genomes: [{ ...validEntry, leaderboard_name: 'lowercase' }],
    });
    expect(() => validateLeaderboardResponse(bad)).toThrow(/\^/);
  });

  it('rejects fitness out of range', () => {
    const bad = JSON.stringify({
      martian_type: 'compute',
      total_for_type: 1,
      genomes: [{ ...validEntry, fitness: 1.5 }],
    });
    expect(() => validateLeaderboardResponse(bad)).toThrow('fitness');
  });

  it('rejects non-string martian_type in entry', () => {
    const bad = JSON.stringify({
      martian_type: 'compute',
      total_for_type: 1,
      genomes: [{ ...validEntry, martian_type: 42 }],
    });
    expect(() => validateLeaderboardResponse(bad)).toThrow('martian_type');
  });

  // ── Packet 100 additions: validateLeaderboardResponse type-coverage throws ──

  it('rejects non-object entry (string in genomes array) (line 159)', () => {
    const bad = JSON.stringify({
      martian_type: 'compute',
      total_for_type: 1,
      genomes: ['not an object'],
    });
    expect(() => validateLeaderboardResponse(bad)).toThrow(/is not an object/);
  });

  it('rejects null entry (line 159 — typeof null === "object" guard)', () => {
    const bad = JSON.stringify({
      martian_type: 'compute',
      total_for_type: 1,
      genomes: [null],
    });
    expect(() => validateLeaderboardResponse(bad)).toThrow(/is not an object/);
  });

  it('rejects array entry (line 159 — Array.isArray guard)', () => {
    const bad = JSON.stringify({
      martian_type: 'compute',
      total_for_type: 1,
      genomes: [['nested', 'array']],
    });
    expect(() => validateLeaderboardResponse(bad)).toThrow(/is not an object/);
  });

  it('rejects non-string leaderboard_name in entry (line 168)', () => {
    const bad = JSON.stringify({
      martian_type: 'compute',
      total_for_type: 1,
      genomes: [{ ...validEntry, leaderboard_name: 12345 }],
    });
    expect(() => validateLeaderboardResponse(bad)).toThrow(/leaderboard_name must be a string/);
  });

  it('rejects non-string submission_id in entry (line 181)', () => {
    const bad = JSON.stringify({
      martian_type: 'compute',
      total_for_type: 1,
      genomes: [{ ...validEntry, submission_id: 999 }],
    });
    expect(() => validateLeaderboardResponse(bad)).toThrow(/submission_id must be a string/);
  });

  it('rejects non-string submitted_at in entry (line 184)', () => {
    const bad = JSON.stringify({
      martian_type: 'compute',
      total_for_type: 1,
      genomes: [{ ...validEntry, submitted_at: 1717000000 }],
    });
    expect(() => validateLeaderboardResponse(bad)).toThrow(/submitted_at must be a string/);
  });

  // ── Packet 149 additions: top-level response type-coverage throws ──

  it('rejects null top-level response (L130)', () => {
    expect(() => validateLeaderboardResponse('null')).toThrow('Leaderboard response is not an object');
  });

  it('rejects array top-level response (L130)', () => {
    expect(() => validateLeaderboardResponse('[]')).toThrow('Leaderboard response is not an object');
  });

  it('rejects non-string martian_type in response (L144)', () => {
    const bad = JSON.stringify({ martian_type: 42, genomes: [], total_for_type: 0 });
    expect(() => validateLeaderboardResponse(bad)).toThrow('martian_type must be a string');
  });

  it('rejects non-integer total_for_type in response (L147)', () => {
    const bad = JSON.stringify({ martian_type: 'compute', genomes: [], total_for_type: '0' });
    expect(() => validateLeaderboardResponse(bad)).toThrow('total_for_type must be an integer');
  });

  it('rejects non-array genomes field in response (L150)', () => {
    const bad = JSON.stringify({ martian_type: 'compute', total_for_type: 0, genomes: 'not-array' });
    expect(() => validateLeaderboardResponse(bad)).toThrow('genomes must be an array');
  });
});

// ── leaderboardCheck ────────────────────────────────────────────────────────

describe('leaderboardCheck', () => {
  const tmpFile = join(tmpdir(), `leaderboard-test-${Date.now()}.json`);

  const operatorBest: GenomeResult = {
    genome: 'A'.repeat(256),
    genomeHash: 'abc123',
    martianType: 'compute',
    fitness: 0.95,
  };

  const config: LeaderboardConfig = {
    leaderboardUrl: 'https://api.alienclaw.net/v1/genomes/top',
    leaderboardName: 'ALIENBOT',
    submissionFilePath: tmpFile,
  };

  // Mock fetch
  const mockFetch = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  function makeResponse(topFitness: number | null) {
    const genomes = topFitness === null ? [] : [{
      leaderboard_name: 'TOPRANKR',
      fitness: topFitness,
      martian_type: 'compute',
      submission_id: 'sub_top',
      submitted_at: '2026-05-17T00:00:00Z',
    }];
    const body = JSON.stringify({ martian_type: 'compute', genomes, total_for_type: genomes.length });
    const bytes = new TextEncoder().encode(body);
    return {
      ok: true,
      body: {
        getReader() {
          let done = false;
          return {
            read: async () => done ? { done: true, value: undefined } : (done = true, { done: false, value: bytes }),
            cancel: () => {},
          };
        },
      },
    };
  }

  it('writes artifact file when operator has top genome', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(0.80)); // operator 0.95 > board 0.80
    await leaderboardCheck(operatorBest, config);
    expect(existsSync(tmpFile)).toBe(true);
    const artifact = JSON.parse(readFileSync(tmpFile, 'utf8'));
    expect(artifact.leaderboard_name).toBe('ALIENBOT');
    expect(artifact.genome_hash).toBe('abc123');
    expect(artifact.genome).toBe('A'.repeat(256));   // genome is carried through artifact
    expect(artifact.fitness).toBe(0.95);
    expect(artifact.martian_type).toBe('compute');
  });

  it('writes no file when operator does not have top genome', async () => {
    const noFile = join(tmpdir(), `leaderboard-no-write-${Date.now()}.json`);
    mockFetch.mockResolvedValueOnce(makeResponse(0.99)); // operator 0.95 < board 0.99
    await leaderboardCheck(operatorBest, { ...config, submissionFilePath: noFile });
    expect(existsSync(noFile)).toBe(false);
  });

  it('writes no file when leaderboard is empty (no top yet)', async () => {
    // Empty board: topFitness = 0, operator 0.95 > 0 → DOES write
    const emptyFile = join(tmpdir(), `leaderboard-empty-${Date.now()}.json`);
    mockFetch.mockResolvedValueOnce(makeResponse(null));
    await leaderboardCheck(operatorBest, { ...config, submissionFilePath: emptyFile });
    // Empty board: operator beats "0" so file IS written
    expect(existsSync(emptyFile)).toBe(true);
  });

  it('rejects oversized response (hardenedFetch size limit)', async () => {
    // Produce a response over 256KB
    const bigBody = 'x'.repeat(300 * 1024);
    const bytes = new TextEncoder().encode(bigBody);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader() {
          let done = false;
          return {
            read: async () => done ? { done: true, value: undefined } : (done = true, { done: false, value: bytes }),
            cancel: vi.fn(),
          };
        },
      },
    });
    await expect(
      hardenedFetch('https://example.com', { maxResponseBytes: 256 * 1024 })
    ).rejects.toThrow('exceeds');
  });

  it('rejects malformed response from server (inert-data guarantee)', async () => {
    const malicious = JSON.stringify({
      martian_type: 'compute', genomes: [], total_for_type: 0,
      inject: 'evil payload',
    });
    const bytes = new TextEncoder().encode(malicious);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader() {
          let done = false;
          return {
            read: async () => done ? { done: true, value: undefined } : (done = true, { done: false, value: bytes }),
            cancel: vi.fn(),
          };
        },
      },
    });
    await expect(
      leaderboardCheck(operatorBest, config)
    ).rejects.toThrow('Unexpected field');
  });

  it('rejects invalid config leaderboard name', async () => {
    await expect(
      leaderboardCheck(operatorBest, { ...config, leaderboardName: 'invalid1' })
    ).rejects.toThrow(/\^/);
  });
});

// ── submitFromFile ──────────────────────────────────────────────────────────

describe('submitFromFile', () => {
  const VALID_GENOME = 'A'.repeat(256);
  const VALID_HASH   = 'a'.repeat(64);

  const mockFetch = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  function writeArtifact(artifact: Partial<SubmissionArtifact>): string {
    const path = join(tmpdir(), `submit-test-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(path, JSON.stringify({
      leaderboard_name: 'ALIENBOT',
      genome:           VALID_GENOME,
      genome_hash:      VALID_HASH,
      martian_type:     'compute',
      fitness:          0.95,
      checked_at:       '2026-06-18T00:00:00Z',
      ...artifact,
    }), 'utf8');
    return path;
  }

  it('happy path: POSTs the 256-char genome string and returns rank/is_new_top', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rank: 1, is_new_top: true }),
    });

    const path = writeArtifact({});
    const result = await submitFromFile(path, 'apikey123', 'https://api.alienclaw.net/v1/genomes');

    expect(result).toEqual({ rank: 1, is_new_top: true });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.genome).toBe(VALID_GENOME);
  });

  it('sends the 256-char genome, not the 64-char hash (regression lock)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rank: 2, is_new_top: false }),
    });

    const path = writeArtifact({});
    await submitFromFile(path, 'apikey123', 'https://api.alienclaw.net/v1/genomes');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.genome).toBe(VALID_GENOME);
    expect(body.genome).toHaveLength(256);
    expect(body.genome).not.toBe(VALID_HASH);
    expect(body.genome).not.toHaveLength(64);
  });

  it('rejects artifact with wrong-length genome before making any network call', async () => {
    const path = writeArtifact({ genome: VALID_HASH }); // 64-char hash where genome should be
    await expect(
      submitFromFile(path, 'apikey123', 'https://api.alienclaw.net/v1/genomes')
    ).rejects.toThrow(/256/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects artifact with non-Base62 characters before making any network call', async () => {
    const badGenome = '-'.repeat(256);
    const path = writeArtifact({ genome: badGenome });
    await expect(
      submitFromFile(path, 'apikey123', 'https://api.alienclaw.net/v1/genomes')
    ).rejects.toThrow(/non-Base62/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('propagates server 400 with the error body in the message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'INVALID_GENOME_LENGTH' }),
    });

    const path = writeArtifact({});
    await expect(
      submitFromFile(path, 'apikey123', 'https://api.alienclaw.net/v1/genomes')
    ).rejects.toThrow('INVALID_GENOME_LENGTH');
  });

  it('rejects invalid artifact JSON with a clear message', async () => {
    const path = join(tmpdir(), `submit-garbage-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(path, 'not valid json at all!!!', 'utf8');
    await expect(
      submitFromFile(path, 'apikey123', 'https://api.alienclaw.net/v1/genomes')
    ).rejects.toThrow('Invalid submission artifact');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Packet 100 addition: submitFromFile artifact leaderboard_name validation (line 263) ──

  it('rejects invalid leaderboard_name in submitFromFile artifact (line 263)', async () => {
    const path = writeArtifact({ leaderboard_name: 'lowercase' });
    await expect(
      submitFromFile(path, 'apikey123', 'https://api.alienclaw.net/v1/genomes')
    ).rejects.toThrow(/leaderboard_name violates/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
