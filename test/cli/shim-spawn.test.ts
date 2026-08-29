/**
 * test/cli/shim-spawn.test.ts — PKT-614
 *
 * Verifies that alienclaw.mjs unknown-command passthrough spawns the host
 * binary with shell:false (PKT-614 fix: eliminates DEP0190 + shell injection).
 *
 * Test IDs: T-RSHIM-001 through T-RSHIM-007.
 *
 * Pattern: vi.resetModules() in beforeEach + vi.doMock() + dynamic import
 * per test. Each it() gets a fresh module evaluation. Established pattern:
 * see test/registry/registry-bootstrap.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock state — re-created in beforeEach so each test is isolated.
let mockSpawn: ReturnType<typeof vi.fn>;
let mockChild: { on: ReturnType<typeof vi.fn> };
let savedArgv: typeof process.argv;
let savedExitCode: typeof process.exitCode;
let savedHost: string | undefined;

beforeEach(() => {
  savedArgv = process.argv;
  savedExitCode = process.exitCode;
  savedHost = process.env['ALIENCLAW_HOST'];
  mockChild = { on: vi.fn() };
  mockSpawn = vi.fn().mockReturnValue(mockChild);
  vi.resetModules();
});

afterEach(() => {
  process.argv = savedArgv;
  process.exitCode = savedExitCode;
  if (savedHost === undefined) {
    delete process.env['ALIENCLAW_HOST'];
  } else {
    process.env['ALIENCLAW_HOST'] = savedHost;
  }
});

/**
 * Apply doMocks then dynamically import alienclaw.mjs so the module
 * re-evaluates with fresh mocks for each test.
 *
 * @param type  - What parseCliArgs returns as cmd.type
 * @param argv  - process.argv to set before import
 * @param host  - ALIENCLAW_HOST env override (undefined = delete the var)
 */
async function loadShim(
  type: string,
  argv: string[] = ['node', 'alienclaw.mjs', 'foo'],
  host?: string,
): Promise<void> {
  process.argv = argv;
  if (host !== undefined) {
    process.env['ALIENCLAW_HOST'] = host;
  } else {
    delete process.env['ALIENCLAW_HOST'];
  }

  vi.doMock('node:child_process', () => ({ spawn: mockSpawn }));

  vi.doMock('../../src/alienclaw/cli/args.js', () => ({
    parseCliArgs: vi.fn().mockReturnValue(
      type === 'run'
        ? { type: 'run', args: { goal: 'test goal', verbosity: undefined } }
        : { type, raw: [] },
    ),
  }));

  vi.doMock('../../src/alienclaw/cli/cli.js', () => ({
    runAlienClaw: vi.fn().mockResolvedValue(undefined),
  }));

  await import('../../src/alienclaw/cli/alienclaw.mjs');
}

// ── T-RSHIM-001 — shell:false on spawn options ────────────────────────────────

describe('T-RSHIM-001 — spawn uses shell:false', () => {
  it('unknown-command passthrough → spawn options.shell is false', async () => {
    await loadShim('unknown');

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const opts = mockSpawn.mock.calls[0][2] as Record<string, unknown>;
    expect(opts['shell']).toBe(false);
  });
});

// ── T-RSHIM-002 — metacharacter arg delivered literally ───────────────────────

describe('T-RSHIM-002 — metacharacter arg not interpreted', () => {
  it('argv with ";" → spawn receives the literal arg string', async () => {
    await loadShim('unknown', [
      'node', 'alienclaw.mjs', '--flag', 'foo; touch /tmp/__INJ_PKT614__',
    ]);

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('foo; touch /tmp/__INJ_PKT614__');
  });
});

// ── T-RSHIM-003 — space-in-arg delivered as single array element ─────────────

describe('T-RSHIM-003 — space-in-arg preserved', () => {
  it('argv with embedded space → spawn receives it as one element', async () => {
    await loadShim('unknown', ['node', 'alienclaw.mjs', '--name', 'foo bar']);

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('foo bar');
  });
});

// ── T-RSHIM-004 — stdio:inherit preserved ────────────────────────────────────

describe('T-RSHIM-004 — stdio:inherit preserved', () => {
  it('spawn options include stdio:"inherit"', async () => {
    await loadShim('unknown');

    const opts = mockSpawn.mock.calls[0][2] as Record<string, unknown>;
    expect(opts['stdio']).toBe('inherit');
  });
});

// ── T-RSHIM-005 — exit-code forwarding ───────────────────────────────────────

describe('T-RSHIM-005 — exit-code forwarding', () => {
  it('child exit(42) → process.exitCode = 42', async () => {
    process.exitCode = 0;
    await loadShim('unknown');

    const onCall = mockChild.on.mock.calls.find((c: unknown[]) => c[0] === 'exit');
    expect(onCall).toBeDefined();
    const handler = onCall![1] as (code: number | null) => void;
    handler(42);
    expect(process.exitCode).toBe(42);
  });

  it('child exit(null) → process.exitCode = 0 (null coalesces)', async () => {
    process.exitCode = 99;
    await loadShim('unknown');

    const onCall = mockChild.on.mock.calls.find((c: unknown[]) => c[0] === 'exit');
    const handler = onCall![1] as (code: number | null) => void;
    handler(null);
    expect(process.exitCode).toBe(0);
  });
});

// ── T-RSHIM-006 — ALIENCLAW_HOST resolution ──────────────────────────────────

describe('T-RSHIM-006 — ALIENCLAW_HOST resolution', () => {
  it('no ALIENCLAW_HOST → spawns "openclaw"', async () => {
    await loadShim('unknown');
    expect(mockSpawn.mock.calls[0][0]).toBe('openclaw');
  });

  it('ALIENCLAW_HOST=hermes → spawns "hermes"', async () => {
    await loadShim('unknown', ['node', 'alienclaw.mjs', 'foo'], 'hermes');
    expect(mockSpawn.mock.calls[0][0]).toBe('hermes');
  });

  it('ALIENCLAW_HOST=openclaw → spawns "openclaw"', async () => {
    await loadShim('unknown', ['node', 'alienclaw.mjs', 'foo'], 'openclaw');
    expect(mockSpawn.mock.calls[0][0]).toBe('openclaw');
  });
});

// ── T-RSHIM-007 — spawn NOT called for handled command types ─────────────────

describe('T-RSHIM-007 — spawn not called for handled command types', () => {
  it('help cmd → spawn not called', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await loadShim('help');
      expect(mockSpawn).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('run cmd → spawn not called', async () => {
    await loadShim('run', ['node', 'alienclaw.mjs', 'run', 'test goal']);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
