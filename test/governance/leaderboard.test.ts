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
  assertPinnedUrl,
  submitFromFile,
  type GenomeResult,
  type LeaderboardConfig,
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
      hardenedFetch('https://api.alienclaw.net/v1/genomes/top', { maxResponseBytes: 256 * 1024 })
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

// ── assertPinnedUrl ────────────────────────────────────────────────────────

describe('assertPinnedUrl', () => {
  it('accepts canonical host', () => {
    expect(() => assertPinnedUrl('https://api.alienclaw.net/v1/health')).not.toThrow();
  });
  it('rejects non-https', () => {
    expect(() => assertPinnedUrl('http://api.alienclaw.net/v1/health'))
      .toThrow('refusing non-https');
  });
  it('rejects off-allowlist host', () => {
    expect(() => assertPinnedUrl('https://example.com/x'))
      .toThrow('refusing off-allowlist host: example.com');
  });
  it('rejects suffix-attack (set hostname lookup, not suffix match)', () => {
    expect(() => assertPinnedUrl('https://api.alienclaw-net.attacker.com/x'))
      .toThrow('refusing off-allowlist host: api.alienclaw-net.attacker.com');
  });
  it('rejects malformed URL', () => {
    expect(() => assertPinnedUrl('not a url')).toThrow();
  });
});

// ── hardenedFetch transport-side guards ────────────────────────────────────

describe('hardenedFetch transport-side guards', () => {
  it('rejects non-https URL via assertPinnedUrl', async () => {
    await expect(hardenedFetch('http://api.alienclaw.net/x'))
      .rejects.toThrow('refusing non-https');
  });
  it('rejects off-allowlist URL via assertPinnedUrl', async () => {
    await expect(hardenedFetch('https://attacker.com/x'))
      .rejects.toThrow('refusing off-allowlist host: attacker.com');
  });
  it('uses redirect: "error" on the fetch call', async () => {
    const mock = vi.fn().mockResolvedValueOnce({
      ok: true,
      body: {
        getReader() {
          let done = false;
          const bytes = new TextEncoder().encode('{}');
          return {
            read: async () => done ? { done: true, value: undefined } : (done = true, { done: false, value: bytes }),
            cancel: () => {},
          };
        },
      },
    });
    vi.stubGlobal('fetch', mock);
    await hardenedFetch('https://api.alienclaw.net/v1/health');
    expect(mock).toHaveBeenCalledWith(
      'https://api.alienclaw.net/v1/health',
      expect.objectContaining({ redirect: 'error' }),
    );
  });
  it('accepts canonical URL and returns body (regression: allowlisted https still works)', async () => {
    const body = JSON.stringify({ martian_type: 'compute', genomes: [], total_for_type: 0 });
    const bytes = new TextEncoder().encode(body);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
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
    }));
    const result = await hardenedFetch('https://api.alienclaw.net/v1/health');
    expect(result).toBe(body);
  });
});

// ── submitFromFile ─────────────────────────────────────────────────────────

describe('submitFromFile', () => {
  const tmpArtifact = join(tmpdir(), `submit-artifact-046.json`);

  beforeEach(() => {
    writeFileSync(tmpArtifact, JSON.stringify({
      leaderboard_name: 'ALIENBOT',
      genome_hash: 'a'.repeat(64),
      genome: 'A'.repeat(256),
      martian_type: 'compute',
      fitness: 0.95,
      checked_at: '2026-06-19T00:00:00Z',
    }), 'utf8');
  });

  it('rejects non-https submitUrl', async () => {
    await expect(submitFromFile(tmpArtifact, 'k', 'http://api.alienclaw.net/v1/genomes'))
      .rejects.toThrow('refusing non-https');
  });
  it('rejects off-allowlist submitUrl', async () => {
    await expect(submitFromFile(tmpArtifact, 'k', 'https://attacker.com/v1/genomes'))
      .rejects.toThrow('refusing off-allowlist host: attacker.com');
  });
  it('uses redirect: "error" on the fetch call', async () => {
    const mock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ rank: 1, is_new_top: true }),
    });
    vi.stubGlobal('fetch', mock);
    await submitFromFile(tmpArtifact, 'k', 'https://api.alienclaw.net/v1/genomes');
    expect(mock).toHaveBeenCalledWith(
      'https://api.alienclaw.net/v1/genomes',
      expect.objectContaining({ redirect: 'error' }),
    );
  });
  it('posts canonical body shape', async () => {
    const mock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ rank: 1, is_new_top: true }),
    });
    vi.stubGlobal('fetch', mock);
    await submitFromFile(tmpArtifact, 'k', 'https://api.alienclaw.net/v1/genomes');
    const body = JSON.parse((mock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toHaveProperty('genome');
    expect(body).toHaveProperty('martian_type', 'compute');
    expect(body).toHaveProperty('fitness', 0.95);
    expect(body).toHaveProperty('leaderboard_name', 'ALIENBOT');
  });
  it('returns server rank and is_new_top', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ rank: 3, is_new_top: true }),
    }));
    const result = await submitFromFile(tmpArtifact, 'k', 'https://api.alienclaw.net/v1/genomes');
    expect(result).toEqual({ rank: 3, is_new_top: true });
  });
  it('throws on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 400, text: async () => 'bad request',
    }));
    await expect(submitFromFile(tmpArtifact, 'k', 'https://api.alienclaw.net/v1/genomes'))
      .rejects.toThrow('Submit failed (400): bad request');
  });
});
