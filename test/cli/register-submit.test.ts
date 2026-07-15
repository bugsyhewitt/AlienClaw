/**
 * register-submit.test.ts — `alienclaw submit` units.
 *
 * Layers covered:
 *   1. parseCliArgs 'submit' branch
 *   2. credentials (ensureApiKey persistence + mode, machineHash stability)
 *   3. runSubmit orchestration against a fully stubbed fetch
 *   4. registerSubmitCommand Commander wiring (fake-program pattern)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(),
    close:    vi.fn(),
  })),
}));

import { createInterface } from 'node:readline/promises';

import { parseCliArgs } from '../../src/alienclaw/cli/args.js';
import { ensureApiKey, machineHash } from '../../src/alienclaw/governance/common/sync/credentials.js';
import { runSubmit } from '../../src/alienclaw/cli/submit.js';
import { registerSubmitCommand } from '../../src/alienclaw/cli/register.submit.js';

// ── alienclaw-config mock (Tier 1 / Tier 3 resolveName paths) ────────────────
const { mockAlienClawSave, mockAlienClawPrefs } = vi.hoisted(() => ({
  mockAlienClawSave: vi.fn(),
  mockAlienClawPrefs: {} as { leaderboardName?: string },
}));

vi.mock('../../src/alienclaw/config/alienclaw-config.js', () => ({
  alienClawConfig: {
    savePreferences: mockAlienClawSave,
    preferences: mockAlienClawPrefs,
  },
}));

// ── 1. parseCliArgs submit branch ────────────────────────────────────────────

describe('parseCliArgs — submit', () => {
  it('parses the full flag set', () => {
    const cmd = parseCliArgs(['submit', '--type', 'compute_alone', '--name', 'ALIENBOT', '--yes', '--force']);
    expect(cmd).toEqual({
      type: 'submit',
      args: { martianType: 'compute_alone', name: 'ALIENBOT', yes: true, force: true },
    });
  });

  it('defaults yes/force to false', () => {
    const cmd = parseCliArgs(['submit', '--type', 'compute_alone']);
    expect(cmd).toEqual({
      type: 'submit',
      args: { martianType: 'compute_alone', yes: false, force: false },
    });
  });

  it('rejects submit --type with no value (dangling flag)', () => {
    // Triggers branch 16 arm1 (L101): value = raw[i+1] is undefined → value ?? '' fires
    expect(parseCliArgs(['submit', '--type']).type).toBe('unknown');
  });

  it('rejects submit without --type and with unknown flags', () => {
    expect(parseCliArgs(['submit']).type).toBe('unknown');
    expect(parseCliArgs(['submit', '--type', 'x', '--bogus']).type).toBe('unknown');
  });
});

// ── 2. credentials ───────────────────────────────────────────────────────────

describe('credentials', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'aclaw-creds-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('mints a 43-char Base62 key at 0600 and reuses it thereafter', () => {
    const key = ensureApiKey(home);
    expect(key).toMatch(/^[0-9A-Za-z]{43}$/);
    const mode = statSync(join(home, 'api-key.txt')).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(ensureApiKey(home)).toBe(key);
    expect(readFileSync(join(home, 'api-key.txt'), 'utf-8').trim()).toBe(key);
  });

  it('machineHash returns a stable 64-char hex digest', () => {
    const a = machineHash(home);
    const b = machineHash(home);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });
});

// ── 3. runSubmit orchestration (stubbed fetch) ───────────────────────────────

describe('runSubmit — stubbed network', () => {
  let home: string;
  let popsRoot: string;
  const GENOME = 'A'.repeat(256);

  function seedBest(martianType: string, fitness: number): void {
    const dir = join(popsRoot, martianType, 'entries');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'best.json'),
      JSON.stringify({ genome: GENOME, fitness, generation: 3, run_metadata: {} }),
      'utf-8',
    );
  }

  function stubFetch(overrides: { topGenomes?: unknown[]; submitStatus?: number } = {}): ReturnType<typeof vi.fn> {
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v1/install')) {
        return new Response(JSON.stringify({ install_id: 'i-1', known: false }), {
          status: 201, headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/v1/genomes/top')) {
        return new Response(JSON.stringify({
          martian_type: 'compute_alone',
          genomes: overrides.topGenomes ?? [],
          total_for_type: (overrides.topGenomes ?? []).length,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/v1/genomes') && init?.method === 'POST') {
        return new Response(JSON.stringify({ rank: 1, is_new_top: true }), {
          status: overrides.submitStatus ?? 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchStub);
    return fetchStub;
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'aclaw-submit-home-'));
    popsRoot = mkdtempSync(join(tmpdir(), 'aclaw-submit-pops-'));
    vi.stubEnv('ALIENCLAW_HOME', home);
    vi.stubEnv('ALIENCLAW_POPULATIONS_ROOT', popsRoot);
    vi.stubEnv('ALIENCLAW_LEADERBOARD_NAME', 'TESTNAME');
    vi.stubEnv('ALIENCLAW_API_URL', 'https://api.test.invalid');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(home, { recursive: true, force: true });
    rmSync(popsRoot, { recursive: true, force: true });
  });

  it('submits the best genome end-to-end (install → check → POST)', async () => {
    seedBest('compute_alone', 0.9);
    const fetchStub = stubFetch();

    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: false });

    expect(rc).toBe(0);
    const calls = fetchStub.mock.calls.map(c => String(c[0]));
    expect(calls.some(u => u.includes('/v1/install'))).toBe(true);
    expect(calls.some(u => u.includes('/v1/genomes/top'))).toBe(true);
    const post = fetchStub.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'POST' && String(c[0]).endsWith('/v1/genomes'));
    expect(post).toBeDefined();
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body).toMatchObject({
      genome: GENOME,
      martian_type: 'compute_alone',
      fitness: 0.9,
      leaderboard_name: 'TESTNAME',
    });
    // artifact persisted under the temp home
    expect(existsSync(join(home, 'workspace', 'submissions', 'compute_alone.json'))).toBe(true);
  });

  it('refuses without --force when the public top is better', async () => {
    seedBest('compute_alone', 0.4);
    stubFetch({ topGenomes: [{
      genome: 'B'.repeat(256), fitness: 0.9, submission_id: 's-1',
      submitted_at: '2026-07-01T00:00:00Z', leaderboard_name: 'SOMEBODY',
    }] });

    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: false });
    expect(rc).toBe(1);
  });

  it('--force submits despite a better public top', async () => {
    seedBest('compute_alone', 0.4);
    const fetchStub = stubFetch({ topGenomes: [{
      genome: 'B'.repeat(256), fitness: 0.9, submission_id: 's-1',
      submitted_at: '2026-07-01T00:00:00Z', leaderboard_name: 'SOMEBODY',
    }] });

    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: true });
    expect(rc).toBe(0);
    // force path never needs the top-genomes read
    const calls = fetchStub.mock.calls.map(c => String(c[0]));
    expect(calls.some(u => u.endsWith('/v1/genomes'))).toBe(true);
  });

  it('fails fast on an invalid leaderboard name', async () => {
    vi.stubEnv('ALIENCLAW_LEADERBOARD_NAME', 'bad-name');
    seedBest('compute_alone', 0.9);
    stubFetch();
    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: false });
    expect(rc).toBe(1);
  });

  it('fails with guidance when no local population exists', async () => {
    stubFetch();
    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: false });
    expect(rc).toBe(1);
  });

  it('persists --name flag to preferences via savePreferences', async () => {
    mockAlienClawSave.mockClear();
    delete mockAlienClawPrefs.leaderboardName;
    vi.unstubAllEnvs();
    vi.stubEnv('ALIENCLAW_HOME', home);
    vi.stubEnv('ALIENCLAW_POPULATIONS_ROOT', popsRoot);
    vi.stubEnv('ALIENCLAW_API_URL', 'https://api.test.invalid');
    seedBest('compute_alone', 0.9);
    stubFetch();

    const rc = await runSubmit({ martianType: 'compute_alone', name: 'ALIENBOT', yes: true, force: true });

    expect(rc).toBe(0);
    expect(mockAlienClawSave).toHaveBeenCalledWith({ leaderboardName: 'ALIENBOT' });
  });

  it('yes=false: proceeds when user answers "y"', async () => {
    seedBest('compute_alone', 0.9);
    stubFetch();
    (createInterface as ReturnType<typeof vi.fn>).mockReturnValue({
      question: vi.fn().mockResolvedValue('y'),
      close:    vi.fn(),
    });
    const rc = await runSubmit({ martianType: 'compute_alone', yes: false, force: false });
    expect(rc).toBe(0);
  });

  it('yes=false: aborts when user declines', async () => {
    seedBest('compute_alone', 0.9);
    stubFetch();
    (createInterface as ReturnType<typeof vi.fn>).mockReturnValue({
      question: vi.fn().mockResolvedValue('n'),
      close:    vi.fn(),
    });
    const rc = await runSubmit({ martianType: 'compute_alone', yes: false, force: false });
    expect(rc).toBe(1);
  });

  it('catch: returns 1 and logs when submitFromFile throws an Error', async () => {
    seedBest('compute_alone', 0.9);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v1/install'))
        return new Response(JSON.stringify({ install_id: 'i-1', known: false }), { status: 201, headers: { 'content-type': 'application/json' } });
      if (url.includes('/v1/genomes/top'))
        return new Response(JSON.stringify({ martian_type: 'compute_alone', genomes: [], total_for_type: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
      throw new Error('network failure');
    }));
    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: false });
    expect(rc).toBe(1);
  });

  it('catch: returns 1 and logs String(err) when thrown value is not an Error instance (L139 arm 1)', async () => {
    seedBest('compute_alone', 0.9);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/install'))
        return new Response(JSON.stringify({ install_id: 'i-1', known: false }), {
          status: 201, headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/genomes/top'))
        return new Response(JSON.stringify({ martian_type: 'compute_alone', genomes: [], total_for_type: 0 }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      // Non-Error throw for the POST /v1/genomes → exercises String(err) branch at L139
      throw 'non-error-string';
    }));
    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: false });
    expect(rc).toBe(1);
  });

  it('returns 1 when install registration fails (server 503)', async () => {
    seedBest('compute_alone', 0.9);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/v1/install')) {
        return new Response(
          JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'try later' } }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    }));

    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: false });

    expect(rc).toBe(1);
  });

  it('uses stored preferences.leaderboardName when no flag and no env set', async () => {
    mockAlienClawSave.mockClear();
    mockAlienClawPrefs.leaderboardName = 'PREFNAME';
    vi.unstubAllEnvs();
    vi.stubEnv('ALIENCLAW_HOME', home);
    vi.stubEnv('ALIENCLAW_POPULATIONS_ROOT', popsRoot);
    vi.stubEnv('ALIENCLAW_API_URL', 'https://api.test.invalid');
    seedBest('compute_alone', 0.9);
    const fetchStub = stubFetch();

    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: true });

    expect(rc).toBe(0);
    const post = fetchStub.mock.calls.find(c =>
      (c[1] as RequestInit | undefined)?.method === 'POST' &&
      String(c[0]).endsWith('/v1/genomes'),
    );
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body.leaderboard_name).toBe('PREFNAME');
  });

  it('success path: prints rank without "new top!" when is_new_top=false (L133 arm-1)', async () => {
    seedBest('compute_alone', 0.9);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v1/install'))
        return new Response(JSON.stringify({ install_id: 'i-1', known: false }), {
          status: 201, headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/genomes/top'))
        return new Response(JSON.stringify({
          martian_type: 'compute_alone', genomes: [], total_for_type: 0,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/v1/genomes') && (init as RequestInit)?.method === 'POST')
        return new Response(JSON.stringify({ rank: 3, is_new_top: false }), {
          status: 201, headers: { 'content-type': 'application/json' },
        });
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: false });
    expect(rc).toBe(0);
    const submittedLine = consoleSpy.mock.calls.find(c => String(c[0]).includes('Submitted:'));
    expect(submittedLine?.[0]).toMatch(/rank 3$/);
    expect(submittedLine?.[0]).not.toContain('new top');
    consoleSpy.mockRestore();
  });

  it('returns 1 when stored preferences leaderboardName is invalid', async () => {
    mockAlienClawSave.mockClear();
    mockAlienClawPrefs.leaderboardName = 'bad';      // fails /^[A-Z]{8}$/ → arm=1 fires
    vi.unstubAllEnvs();
    vi.stubEnv('ALIENCLAW_HOME', home);
    vi.stubEnv('ALIENCLAW_POPULATIONS_ROOT', popsRoot);
    vi.stubEnv('ALIENCLAW_API_URL', 'https://api.test.invalid');
    seedBest('compute_alone', 0.9);
    // no ALIENCLAW_LEADERBOARD_NAME, no --name flag → falls through to prefs → 'bad' invalid → null
    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: false });
    expect(rc).toBe(1);
  });

  it('falls back to default populationsRoot and DEFAULT_API_URL when env vars are unset', async () => {
    // Unset ALIENCLAW_POPULATIONS_ROOT → L35 arm=1 fires: join(home, 'populations')
    // Unset ALIENCLAW_API_URL          → L60 arm=1 fires: 'https://api.alienclaw.net'
    vi.unstubAllEnvs();
    vi.stubEnv('ALIENCLAW_HOME', home);              // keep safe — prevents writes to real ~/.alienclaw
    vi.stubEnv('ALIENCLAW_LEADERBOARD_NAME', 'TESTNAME');
    // ALIENCLAW_POPULATIONS_ROOT and ALIENCLAW_API_URL intentionally not set

    // seed best.json at the fallback populations root = join(home, 'populations', ...)
    const fallbackPops = join(home, 'populations', 'compute_alone', 'entries');
    mkdirSync(fallbackPops, { recursive: true });
    writeFileSync(
      join(fallbackPops, 'best.json'),
      JSON.stringify({ genome: GENOME, fitness: 0.9, generation: 3, run_metadata: {} }),
      'utf-8',
    );

    // fetch stub still matches on path fragments regardless of base domain
    stubFetch();

    const rc = await runSubmit({ martianType: 'compute_alone', yes: true, force: true });
    expect(rc).toBe(0);
  });
});

// ── 4. Commander wiring ──────────────────────────────────────────────────────

function makeFakeProgram(): { program: Command;
                              lastCommandName: () => string | null;
                              lastAction:      () => ((...args: unknown[]) => unknown) | null } {
  let _cmdName: string | null = null;
  let _action:  ((...args: unknown[]) => unknown) | null = null;

  const program: Command = {
    command:  (name: string) => { _cmdName = name; return program; },
    description: () => program,
    option:   () => program,
    requiredOption: () => program,
    addHelpText: () => program,
    action:   (fn: (...args: unknown[]) => unknown) => { _action = fn; return program; },
  } as unknown as Command;

  return { program, lastCommandName: () => _cmdName, lastAction: () => _action };
}

describe('registerSubmitCommand', () => {
  it('registers the submit command with an action', () => {
    const fake = makeFakeProgram();
    registerSubmitCommand(fake.program);
    expect(fake.lastCommandName()).toBe('submit');
    expect(fake.lastAction()).toBeTypeOf('function');
  });
});
