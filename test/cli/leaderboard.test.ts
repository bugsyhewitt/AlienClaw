/**
 * PKT-1035: alienclaw leaderboard — read-only top-N command.
 * Tests A-001 through A-006.
 * RED on origin/main: leaderboard.ts does not exist → ERR_MODULE_NOT_FOUND at collection.
 * GREEN after fix: all 6 pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hardenedFetch mock (hoisted so the factory runs before module imports) ────

const { mockHardenedFetch } = vi.hoisted(() => ({
  mockHardenedFetch: vi.fn<() => Promise<string>>(),
}));

vi.mock('../../src/alienclaw/governance/common/leaderboard.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, hardenedFetch: mockHardenedFetch };
});

import { parseCliArgs }            from '../../src/alienclaw/cli/args.js';
import { runLeaderboard }          from '../../src/alienclaw/cli/leaderboard.js';
import { registerLeaderboardCommand } from '../../src/alienclaw/cli/register.leaderboard.js';
import type { Command }            from 'commander';

// ── Fixture: 5 valid leaderboard entries (intentionally unsorted by fitness) ──

const FIXTURE_RAW = JSON.stringify({
  martian_type:   'compute',
  total_for_type: 5,
  genomes: [
    { leaderboard_name: 'ALIENBOT', fitness: 0.9,  submission_id: 's1', submitted_at: '2026-01-01T00:00:00Z' },
    { leaderboard_name: 'BESTCLAW', fitness: 0.7,  submission_id: 's3', submitted_at: '2026-01-01T00:00:00Z' },
    { leaderboard_name: 'TOPAGENT', fitness: 0.8,  submission_id: 's2', submitted_at: '2026-01-01T00:00:00Z' },
    { leaderboard_name: 'FOURTHPL', fitness: 0.6,  submission_id: 's4', submitted_at: '2026-01-01T00:00:00Z' },
    { leaderboard_name: 'FIFTHALE', fitness: 0.5,  submission_id: 's5', submitted_at: '2026-01-01T00:00:00Z' },
  ],
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function captureStdout(): { lines: () => string[] } {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return { lines: () => chunks.join('').trimEnd().split('\n').filter(Boolean) };
}

function captureStderr(): { text: () => string } {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return { text: () => chunks.join('') };
}

function makeFakeProgram(): {
  program:         Command;
  lastCommandName: () => string | null;
} {
  let _cmdName: string | null = null;
  const program: Command = {
    command:     (name: string) => { _cmdName = name; return program; },
    description: () => program,
    option:      () => program,
    requiredOption: () => program,
    addHelpText: () => program,
    action:      () => program,
  } as unknown as Command;
  return { program, lastCommandName: () => _cmdName };
}

// ── A-001: parseCliArgs leaderboard branch (default topN) ────────────────────

describe('parseCliArgs — leaderboard', () => {
  it('A-001: --martian-type only → topN defaults to 10', () => {
    expect(parseCliArgs(['leaderboard', '--martian-type', 'compute'])).toEqual({
      type: 'leaderboard',
      args: { martianType: 'compute', topN: 10 },
    });
  });

  it('A-002: --martian-type + --top 5 → topN=5', () => {
    expect(parseCliArgs(['leaderboard', '--martian-type', 'web', '--top', '5'])).toEqual({
      type: 'leaderboard',
      args: { martianType: 'web', topN: 5 },
    });
  });

  it('A-003: missing --martian-type → type:unknown', () => {
    expect(parseCliArgs(['leaderboard']).type).toBe('unknown');
  });
});

// ── A-004: runLeaderboard happy path (sorted descending) ─────────────────────

describe('runLeaderboard — happy path', () => {
  beforeEach(() => { mockHardenedFetch.mockClear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('A-004: 5 entries printed in descending fitness order', async () => {
    mockHardenedFetch.mockResolvedValueOnce(FIXTURE_RAW);

    const cap = captureStdout();
    const code = await runLeaderboard({ martianType: 'compute', topN: 5 });

    expect(code).toBe(0);
    const rows = cap.lines();
    expect(rows).toHaveLength(5);

    // Row 0: rank 1, highest fitness
    const r0 = rows[0]!.split('\t');
    expect(r0[0]).toBe('1');
    expect(r0[1]).toBe('ALIENBOT');
    expect(r0[2]).toBe('0.9000');

    // Row 4: rank 5, lowest fitness
    const r4 = rows[4]!.split('\t');
    expect(r4[0]).toBe('5');
    expect(r4[1]).toBe('FIFTHALE');
    expect(r4[2]).toBe('0.5000');
  });
});

// ── A-005: runLeaderboard network error ──────────────────────────────────────

describe('runLeaderboard — network error', () => {
  beforeEach(() => { mockHardenedFetch.mockClear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('A-005: hardenedFetch throws → exit code 1, message on stderr, no stdout rows', async () => {
    mockHardenedFetch.mockRejectedValueOnce(new Error('HTTP 503 from leaderboard'));

    const outCap = captureStdout();
    const errCap = captureStderr();
    const code = await runLeaderboard({ martianType: 'compute', topN: 10 });

    expect(code).toBe(1);
    expect(outCap.lines()).toHaveLength(0);
    expect(errCap.text()).toContain('503');
  });
});

// ── A-006: registerLeaderboardCommand Commander wiring ───────────────────────

describe('registerLeaderboardCommand', () => {
  it('A-006: registers "leaderboard" command', () => {
    const fake = makeFakeProgram();
    registerLeaderboardCommand(fake.program);
    expect(fake.lastCommandName()).toBe('leaderboard');
  });
});
