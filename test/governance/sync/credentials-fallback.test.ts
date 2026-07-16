/**
 * Tests for machineHash() fallback paths (credentials.ts L47–60).
 *
 * Covers:
 *   - /etc/machine-id unreadable, home/machine-id pre-seeded        credentials.ts:48,51,53
 *   - /etc/machine-id unreadable, no home id → generate + persist   credentials.ts:48,51,55,57-60
 *   - Stability: repeated call returns the same hash (UUID was persisted) credentials.ts:53
 *
 * vi.mock is path-aware: intercepts readFileSync only on '/etc/machine-id'
 * when mockState.machineIdMode === 'throw'. All other FS calls (including
 * home/machine-id reads and writes) use the real implementation, so the
 * persistence invariant is tested end-to-end without further stubbing.
 *
 * Kept in a separate file from test/cli/register-submit.test.ts because that
 * file tests machineHash via real FS; adding a file-wide vi.mock('node:fs')
 * there would break ensureApiKey tests that rely on real I/O.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockState = {
  machineIdMode: 'real' as 'real' | 'throw',
};

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    readFileSync: ((path: unknown, opts?: unknown) => {
      if (path === '/etc/machine-id' && mockState.machineIdMode === 'throw') {
        const err: NodeJS.ErrnoException = new Error('ENOENT: no such file (mock)');
        err.code = 'ENOENT';
        throw err;
      }
      return (real.readFileSync as (...args: unknown[]) => unknown)(path, opts);
    }) as typeof real.readFileSync,
  };
});

import { machineHash, ensureApiKey } from '../../../src/alienclaw/governance/common/sync/credentials.js';

describe('machineHash — fallback paths (vi.mock isolates /etc/machine-id)', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'aclaw-mhash-'));
    mockState.machineIdMode = 'throw';
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    mockState.machineIdMode = 'real';
    vi.clearAllMocks();
  });

  it('reads persisted machine-id from home when /etc/machine-id is unreadable', () => {
    const knownId = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';
    writeFileSync(join(home, 'machine-id'), knownId + '\n', 'utf-8');

    const hash = machineHash(home);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update(knownId).digest('hex'));
  });

  it('generates and persists a UUID when /etc/machine-id and home id are both missing', () => {
    const hashA = machineHash(home);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(home, 'machine-id'))).toBe(true);
  });

  it('returns the same hash on repeated calls once the UUID has been persisted', () => {
    const hashA = machineHash(home);
    const hashB = machineHash(home);
    expect(hashB).toBe(hashA);
  });
});

describe('ensureApiKey — governance-local coverage', () => {
  let eHome: string;

  beforeEach(() => { eHome = mkdtempSync(join(tmpdir(), 'aclaw-eapikey-')); });
  afterEach(() => { rmSync(eHome, { recursive: true, force: true }); });

  it('mints a fresh Base62 key when api-key.txt does not exist (catch path)', () => {
    const key = ensureApiKey(eHome);
    expect(key).toMatch(/^[0-9A-Za-z]{43}$/);
  });

  it('reuses the key when api-key.txt already has a valid key (L31 true arm)', () => {
    const k1 = ensureApiKey(eHome);
    const k2 = ensureApiKey(eHome);
    expect(k2).toBe(k1);
  });

  it('remints when api-key.txt exists but is empty or whitespace-only (L31 false arm)', () => {
    writeFileSync(join(eHome, 'api-key.txt'), '\n', { encoding: 'utf-8', mode: 0o600 });
    const key = ensureApiKey(eHome);
    expect(key).toMatch(/^[0-9A-Za-z]{43}$/);
  });
});

describe('machineHash — defaultHome() fallback arm (no ALIENCLAW_HOME)', () => {
  // mockState.machineIdMode is 'real' here (no beforeEach override in this block),
  // so readFileSync('/etc/machine-id', …) reaches the real implementation.
  // On Linux /etc/machine-id is readable, so machineHash() never writes to home.
  // Skipped on non-Linux: /etc/machine-id is absent on macOS/Windows, which would trigger UUID
  // generation and write to the real ~/.alienclaw directory — a non-hermetic side effect.
  it.runIf(process.platform === 'linux')('machineHash() without home arg and without ALIENCLAW_HOME uses the homedir fallback', () => {
    const prev = process.env['ALIENCLAW_HOME'];
    delete process.env['ALIENCLAW_HOME'];
    try {
      const hash = machineHash(); // exercises defaultHome() bid=0 arm=1
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (prev !== undefined) process.env['ALIENCLAW_HOME'] = prev;
    }
  });
});
