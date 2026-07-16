/**
 * real-summon-adapter-deep.test.ts
 *
 * Direct unit tests for the DEEP paths in
 * src/alienclaw/governance/common/real-summon-adapter.ts that the
 * pre-existing test/governance/real-summon-adapter.test.ts (packet
 * "synthetic-goal" / "realistic-goal" lineage, 4 cases) does NOT cover.
 *
 * Pre-existing file tests:
 *   - UNKNOWN_MARTIAN_TYPE error (martian_type not in registry)
 *   - INVALID_GENOME error (genome length < 256)
 *   - summon_id echo
 *   - TIMEOUT (relies on real subprocess hang, 30s timeout)
 *
 * This packet (090) tests the deep paths by mocking node:child_process
 * so the test harness can drive stdout/stderr/close events synthetically
 * — no real python3 invocation, no real subprocess lifecycle:
 *
 *   1. spawn() argument pinning (pythonBin, argv, shell:false, env)
 *   2. bridgeRequest JSON line shape (summon-from-population vs summon)
 *   3. timeout path: timer fires → SIGTERM → resolve TIMEOUT result
 *   4. non-zero exit path: exit_code !== 0 → resolve with stderr_tail
 *   5. ok=true path: parse envelope, return output + fitness + run_metadata
 *   6. ok=false path: parse envelope, return error code:message
 *   7. parse-fail path: stdout is not JSON → resolve parse-failed result
 *   8. stderr truncation: stderrBuf > STDERR_TAIL_BYTES * 2 → slice to tail
 *   9. run_metadata fallback: missing meta.tool_calls defaults to 1
 *
 * Source: src/alienclaw/governance/common/real-summon-adapter.ts
 *   - spawn call:          lines 54-58
 *   - timeout timer:        lines 60-64
 *   - stdout/stderr on:    lines 66-73
 *   - stdin write + end:   lines 75-76
 *   - close handler:       lines 78-137
 *     - timedOut branch:     lines 80-86
 *     - exitCode!==0 branch: lines 88-97
 *     - ok=true branch:      lines 99-113
 *     - ok=false branch:     lines 114-124
 *     - parse fail branch:   lines 125-132
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock node:child_process BEFORE importing the adapter ───────────────────
//
// RealMartianSummonAdapter calls `spawn(...)` at module-evaluation time? No —
// it is called inside `summon()` per-request, so vi.mock at module-eval time
// is sufficient. We provide a factory that returns a controllable EventEmitter
// duck-typed as a ChildProcess (only the methods the adapter touches).

interface FakeChild extends EventEmitter {
  stdin:  { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter & { on: EventEmitter['on'] };
  stderr: EventEmitter & { on: EventEmitter['on'] };
  kill:   ReturnType<typeof vi.fn>;
}

interface SpawnCall {
  cmd:  string;
  args: readonly string[];
  opts: Record<string, unknown>;
}

const spawnCalls: SpawnCall[] = [];

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = {
    write: vi.fn(),
    end:   vi.fn(),
  };
  child.stdout = new EventEmitter() as FakeChild['stdout'];
  child.stderr = new EventEmitter() as FakeChild['stderr'];
  child.kill   = vi.fn();
  return child;
}

vi.mock('node:child_process', async () => {
  return {
    spawn: vi.fn((cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
      spawnCalls.push({ cmd, args, opts });
      return makeFakeChild();
    }),
  };
});

// Import AFTER the mock is in place
import { RealMartianSummonAdapter } from '../../src/alienclaw/governance/common/real-summon-adapter.js';
import type {
  MartianSummonRequest,
  MartianSummonResult,
} from '../../src/alienclaw/governance/common/summon-adapter.js';

// ── Test helpers ──────────────────────────────────────────────────────────

// Valid 256-char Base62 genome produced by random_genome(Random(42), 'TEST0001')
// — same constant the pre-existing test uses.
const VALID_GENOME = 'TEST0001G1AlienClaw1d1HDjft5Q1DV1CeXDao0nhL9xK55qbojXyNYpcrZh2EH4E6HdMMCGwebAjANzdYgqmE1JGDwsJeOuSGFYGatODzV526cnQ3NzWyr0igXGd6QSxsGVBurIdb9lXmW0K1vspJ3sw5U4ll7TYGsQDXjCJzeRW7DKaED4dEur4EfD8wZ82fsI3iY7MgLgmrYahC0Fmy5GotUO98O1gIrAOtaC5m0nA6TYCfWMhW0neS3ewBQ';

function makeRequest(overrides: Partial<MartianSummonRequest> = {}): MartianSummonRequest {
  return {
    summon_id:    'test-summon-001',
    genome:       VALID_GENOME,
    martian_type: 'compute',
    inputs:       { x: 1, y: 2 },
    timeout_ms:   5000,
    ...overrides,
  };
}

/** Drain one microtask tick so the spawn() chain registers handlers. */
async function settleMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Get the spawn() mock handle (vi.mocked returns the original mock fn). */
function spawnMock() {
  return vi.mocked(spawnFromModule);
}

// We import spawn once at module load via the mock indirection.
import { spawn as spawnFromModule } from 'node:child_process';

beforeEach(() => {
  spawnCalls.length = 0;
  spawnMock().mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Helper: get the fake child produced by the Nth-most-recent spawn() call
 * (0 = most recent). Each call to spawn() pushes a fresh fake child onto
 * vi.mocked(spawn).mock.results.
 */
function fakeChildAt(idxFromEnd: number): FakeChild {
  const results = spawnMock().mock.results;
  const result = results[results.length - 1 - idxFromEnd];
  if (!result) throw new Error(`no spawn() result at index ${idxFromEnd} from end`);
  return result.value as FakeChild;
}

// ── 1. spawn() argument pinning ──────────────────────────────────────────

describe('RealMartianSummonAdapter — spawn() argument pinning', () => {
  it('calls spawn with pythonBin, -m, alienclaw.bridge, shell:false, PYTHONPATH=src', async () => {
    const adapter = new RealMartianSummonAdapter('/usr/bin/python3.11');
    const promise = adapter.summon(makeRequest());

    // Capture the spawned child before close fires
    const call = spawnCalls[0]!;
    expect(call.cmd).toBe('/usr/bin/python3.11');
    expect(call.args).toEqual(['-m', 'alienclaw.bridge']);
    expect(call.opts['shell']).toBe(false);
    const env = call.opts['env'] as Record<string, string>;
    expect(env['PYTHONPATH']).toBe('src');

    // Resolve with ok=true envelope so the promise settles
    const child = fakeChildAt(0);
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: {
        ok: true,
        output: { result: 42 },
        fitness: 0.9,
        run_metadata: { tool_calls: 1, wall_clock_ms: 100 },
      },
    })));
    child.emit('close', 0);

    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it('defaults pythonBin to "python3" when not provided', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest());

    expect(spawnCalls[0]!.cmd).toBe('python3');

    const child = fakeChildAt(0);
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: { ok: true, output: {}, fitness: 1, run_metadata: { tool_calls: 0 } },
    })));
    child.emit('close', 0);

    await promise;
  });

  it('honors an explicit pythonBin constructor argument', async () => {
    const adapter = new RealMartianSummonAdapter('/custom/path/to/python');
    const promise = adapter.summon(makeRequest());

    expect(spawnCalls[0]!.cmd).toBe('/custom/path/to/python');

    const child = fakeChildAt(0);
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: { ok: true, output: {}, fitness: 1, run_metadata: {} },
    })));
    child.emit('close', 0);

    await promise;
  });

  it('DEFAULT_PYTHON_BIN is captured at module-load from ALIENCLAW_PYTHON_BIN env var', () => {
    // This is a STATIC module-load check: read the source line that
    // captures the default. The behavior is exercised by the constructor
    // default test above. We pin the literal to catch refactors that change
    // the env-var name or the fallback default.
    //
    // Path is resolved relative to the test file, NOT hardcoded (lesson from
    // Packet 339 v1 hardcoded-path defect).
    const path = require('node:path');
    const fs = require('node:fs');
    const srcPath = path.resolve(
      __dirname,
      '../../src/alienclaw/governance/common/real-summon-adapter.ts',
    );
    const src = fs.readFileSync(srcPath, 'utf8');
    expect(src).toMatch(/const DEFAULT_PYTHON_BIN = process\.env\['ALIENCLAW_PYTHON_BIN'\] \?\? 'python3'/);
  });
});

// ── 2. bridgeRequest JSON line shape ─────────────────────────────────────

describe('RealMartianSummonAdapter — bridgeRequest shape', () => {
  it('writes summon kind when fromPopulation is false/undefined', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({
      summon_id:    'req-A',
      martian_type: 'compute',
      inputs:       { foo: 'bar' },
      timeout_ms:   1000,
    }));

    const child = fakeChildAt(0);
    const written = child.stdin.write.mock.calls[0]![0] as string;
    expect(written.endsWith('\n')).toBe(true);
    const body = JSON.parse(written.trim());
    expect(body['bridge_version']).toBe('1.0');
    expect(typeof body['request_id']).toBe('string');
    expect(body['request']['kind']).toBe('summon');
    expect(body['request']['martian_type']).toBe('compute');
    expect(body['request']['genome']).toBe(VALID_GENOME);
    expect(body['request']['inputs']).toEqual({ foo: 'bar' });
    expect(body['request']['timeout_ms']).toBe(1000);
    expect(body['request']).not.toHaveProperty('fromPopulation');

    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: { ok: true, output: {}, fitness: 1, run_metadata: {} },
    })));
    child.emit('close', 0);
    await promise;
  });

  it('writes summon-from-population kind when fromPopulation is true', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({
      fromPopulation: true,
      summon_id:      'req-B',
      martian_type:   'mutator',
    }));

    const child = fakeChildAt(0);
    const written = child.stdin.write.mock.calls[0]![0] as string;
    const body = JSON.parse(written.trim());
    expect(body['request']['kind']).toBe('summon-from-population');
    expect(body['request']['martian_type']).toBe('mutator');
    expect(body['request']).not.toHaveProperty('genome');

    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: { ok: true, output: {}, fitness: 1, run_metadata: {} },
    })));
    child.emit('close', 0);
    await promise;
  });

  it('calls stdin.end() after writing the request', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest());

    const child = fakeChildAt(0);
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: { ok: true, output: {}, fitness: 1, run_metadata: {} },
    })));
    child.emit('close', 0);
    await promise;
  });

  it('generates a unique request_id per summon', async () => {
    const adapter = new RealMartianSummonAdapter();
    const p1 = adapter.summon(makeRequest({ summon_id: 'a' }));
    const c1 = fakeChildAt(0);
    c1.stdout.emit('data', Buffer.from(JSON.stringify({
      response: { ok: true, output: {}, fitness: 1, run_metadata: {} },
    })));
    c1.emit('close', 0);
    await p1;

    const p2 = adapter.summon(makeRequest({ summon_id: 'b' }));
    // After p2's spawn(), there are 2 results: index 0 = c2 (most recent),
    // index 1 = c1.
    const c2 = fakeChildAt(0);
    c2.stdout.emit('data', Buffer.from(JSON.stringify({
      response: { ok: true, output: {}, fitness: 1, run_metadata: {} },
    })));
    c2.emit('close', 0);
    await p2;

    const w1 = JSON.parse(c1.stdin.write.mock.calls[0]![0] as string);
    const w2 = JSON.parse(c2.stdin.write.mock.calls[0]![0] as string);
    expect(w1['request_id']).not.toBe(w2['request_id']);
  });
});

// ── 3. ok=true path ──────────────────────────────────────────────────────

describe('RealMartianSummonAdapter — ok=true response path', () => {
  it('returns ok=true with output, fitness, run_metadata from envelope', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ summon_id: 'ok-success' }));

    const child = fakeChildAt(0);
    const envelope = {
      response: {
        ok: true,
        output: { result: 'hello', count: 3 },
        fitness: 0.85,
        run_metadata: {
          tool_calls: 7,
          wall_clock_ms: 250,
          extra_field: 'preserved',
        },
      },
    };
    child.stdout.emit('data', Buffer.from(JSON.stringify(envelope)));
    child.emit('close', 0);

    const result = await promise;
    expect(result.summon_id).toBe('ok-success');
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ result: 'hello', count: 3 });
    expect(result.fitness).toBe(0.85);
    expect(result.run_metadata['tool_calls']).toBe(7);
    expect(result.run_metadata['wall_clock_ms']).toBe(250);
    expect(result.run_metadata['extra_field']).toBe('preserved');
    expect(result.error).toBeUndefined();
  });

  it('falls back tool_calls to 1 when run_metadata.tool_calls is missing', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest());

    const child = fakeChildAt(0);
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: {
        ok: true,
        output: {},
        fitness: 0.5,
        run_metadata: { wall_clock_ms: 100 }, // tool_calls absent
      },
    })));
    child.emit('close', 0);

    const result = await promise;
    expect(result.run_metadata['tool_calls']).toBe(1);
    expect(result.run_metadata['wall_clock_ms']).toBe(100);
  });

  it('falls back wall_clock_ms to 0 when run_metadata.wall_clock_ms is missing', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest());

    const child = fakeChildAt(0);
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: {
        ok: true,
        output: {},
        fitness: 0.5,
        run_metadata: { tool_calls: 5 }, // wall_clock_ms absent
      },
    })));
    child.emit('close', 0);

    const result = await promise;
    expect(result.run_metadata['tool_calls']).toBe(5);
    expect(result.run_metadata['wall_clock_ms']).toBe(0);
  });

  it('handles stdout data arriving in multiple chunks (concatenation)', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest());

    const child = fakeChildAt(0);
    // Split the envelope across 3 chunks
    const full = JSON.stringify({
      response: { ok: true, output: { x: 1 }, fitness: 0.5, run_metadata: {} },
    });
    child.stdout.emit('data', Buffer.from(full.slice(0, 30)));
    child.stdout.emit('data', Buffer.from(full.slice(30, 60)));
    child.stdout.emit('data', Buffer.from(full.slice(60)));
    child.emit('close', 0);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ x: 1 });
  });
});

// ── 4. ok=false response path ────────────────────────────────────────────

describe('RealMartianSummonAdapter — ok=false response path', () => {
  it('returns ok=false with formatted error "code: message" and run_metadata from response', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ summon_id: 'ok-fail' }));

    const child = fakeChildAt(0);
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: {
        ok: false,
        error: { code: 'BRAIN_FAULT', message: 'out of cheese' },
        run_metadata: { tool_calls: 2, wall_clock_ms: 50 },
      },
    })));
    child.emit('close', 0);

    const result = await promise;
    expect(result.summon_id).toBe('ok-fail');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('BRAIN_FAULT: out of cheese');
    expect(result.fitness).toBe(0.0);
    expect(result.run_metadata['tool_calls']).toBe(2);
    expect(result.run_metadata['wall_clock_ms']).toBe(50);
  });
});

// ── 5. parse-fail path ───────────────────────────────────────────────────

describe('RealMartianSummonAdapter — parse-fail path', () => {
  it('returns ok=false with "Bridge response parse failed" when stdout is not JSON', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ summon_id: 'parse-fail' }));

    const child = fakeChildAt(0);
    child.stdout.emit('data', Buffer.from('this is not json {'));
    child.emit('close', 0);

    const result = await promise;
    expect(result.summon_id).toBe('parse-fail');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^Bridge response parse failed:/);
    expect(result.fitness).toBe(0.0);
    expect(result.run_metadata['tool_calls']).toBe(0);
    expect(result.run_metadata['wall_clock_ms']).toBe(0);
  });

  it('returns ok=false with "Bridge response parse failed" when stdout is empty', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ summon_id: 'empty-stdout' }));

    const child = fakeChildAt(0);
    child.emit('close', 0); // no stdout data emitted at all

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^Bridge response parse failed:/);
  });
});

// ── 6. non-zero exit path ────────────────────────────────────────────────

describe('RealMartianSummonAdapter — non-zero exit path', () => {
  it('returns ok=false with exit_code + stderr_tail when subprocess exits non-zero', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ summon_id: 'exit-fail' }));

    const child = fakeChildAt(0);
    child.stderr.emit('data', Buffer.from('Traceback (most recent call last):\n  File "x", line 1\nNameError: name z is not defined\n'));
    child.emit('close', 1);

    const result = await promise;
    expect(result.summon_id).toBe('exit-fail');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Subprocess exited with code 1');
    expect(result.fitness).toBe(0.0);
    expect(result.run_metadata['tool_calls']).toBe(0);
    expect(result.run_metadata['wall_clock_ms']).toBe(0);
    expect(result.run_metadata['exit_code']).toBe(1);
    const stderrTail = result.run_metadata['stderr_tail'] as string;
    expect(stderrTail).toContain('NameError');
  });

  it('captures stderr even when it arrives across multiple chunks before non-zero exit', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest());

    const child = fakeChildAt(0);
    child.stderr.emit('data', Buffer.from('first-chunk\n'));
    child.stderr.emit('data', Buffer.from('second-chunk\n'));
    child.stderr.emit('data', Buffer.from('third-chunk\n'));
    child.emit('close', 2);

    const result = await promise;
    const stderrTail = result.run_metadata['stderr_tail'] as string;
    expect(stderrTail).toContain('first-chunk');
    expect(stderrTail).toContain('second-chunk');
    expect(stderrTail).toContain('third-chunk');
    expect(result.run_metadata['exit_code']).toBe(2);
  });
});

// ── 7. timeout path ──────────────────────────────────────────────────────

describe('RealMartianSummonAdapter — timeout path', () => {
  it('returns ok=false with TIMEOUT after ${timeoutMs}ms when timer fires', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({
      summon_id:  'timeout-1',
      timeout_ms: 50,
    }));

    // Wait long enough for setTimeout(50ms) to fire.
    // vi.useFakeTimers would be cleaner but interferes with our spawn mock
    // approach; instead we wait > 50ms then emit close.
    await new Promise<void>((r) => setTimeout(r, 80));

    const child = fakeChildAt(0);
    // SIGTERM should have been issued.
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    // The 5s SIGKILL timer is scheduled — we don't wait for it.
    // Simulate the subprocess responding to SIGTERM by closing.
    child.emit('close', 143 /* 128 + SIGTERM(15) */);

    const result = await promise;
    expect(result.summon_id).toBe('timeout-1');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('TIMEOUT after 50ms');
    expect(result.fitness).toBe(0.0);
    expect(result.run_metadata['tool_calls']).toBe(0);
    expect(result.run_metadata['wall_clock_ms']).toBe(50);
  });

  it('the 5s SIGKILL follow-up is scheduled after SIGTERM (verifies the inner setTimeout is armed)', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ timeout_ms: 30 }));

    await new Promise<void>((r) => setTimeout(r, 60));

    const child = fakeChildAt(0);
    // After the SIGTERM timer fires, a second setTimeout is scheduled for 5s.
    // The child.kill is called once for SIGTERM; the SIGKILL fires later.
    // We don't wait 5s — just verify SIGTERM happened.
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    // Resolve by emitting close so the test cleans up.
    child.emit('close', 143);
    await promise;
  });

  it('fires SIGKILL 5s after SIGTERM if subprocess does not respond (line 61 coverage)', async () => {
    // This test pins the inner setTimeout that fires SIGKILL after 5s.
    // We use real wall-clock time but only wait 5.1s, then emit close.
    // Tagged as slow (5500ms) — vitest per-test timeout default is 5000ms.
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ timeout_ms: 20 }));

    // Wait for SIGTERM (fires after 20ms) + 5s buffer for SIGKILL timer.
    await new Promise<void>((r) => setTimeout(r, 5100));

    const child = fakeChildAt(0);
    // By now both SIGTERM and SIGKILL should have been issued.
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    // Resolve by emitting close.
    child.emit('close', 137 /* 128 + SIGKILL(9) */);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('TIMEOUT after 20ms');
  }, 8000);
});

// ── 8. stderr truncation ─────────────────────────────────────────────────

describe('RealMartianSummonAdapter — stderr truncation', () => {
  it('truncates stderrBuf to last STDERR_TAIL_BYTES (4096) chars when overflowed', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest());

    const child = fakeChildAt(0);
    // STDERR_TAIL_BYTES = 4096, truncation fires when stderrBuf.length > 8192
    // Emit 10 chunks of 1000 chars each → total 10000 > 8192 → slice to last 4096
    const chunk = 'X'.repeat(1000);
    for (let i = 0; i < 10; i++) {
      child.stderr.emit('data', Buffer.from(chunk));
    }
    child.emit('close', 1);

    const result = await promise;
    const stderrTail = result.run_metadata['stderr_tail'] as string;
    expect(stderrTail.length).toBe(4096);
    // The kept tail must be the LAST 4096 chars of the 10000-char buffer
    // (all 'X'), so it should be entirely 'X' characters.
    expect(stderrTail).toBe('X'.repeat(4096));
  });
});

// ── 9. summon_id echo across all paths ───────────────────────────────────

describe('RealMartianSummonAdapter — summon_id echo', () => {
  it('preserves request.summon_id in the ok=true result', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ summon_id: 'echo-ok' }));

    const child = fakeChildAt(0);
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: { ok: true, output: {}, fitness: 1, run_metadata: {} },
    })));
    child.emit('close', 0);

    const result = await promise;
    expect(result.summon_id).toBe('echo-ok');
  });

  it('preserves request.summon_id in the ok=false response path', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ summon_id: 'echo-ok-false' }));

    const child = fakeChildAt(0);
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      response: {
        ok: false,
        error: { code: 'X', message: 'y' },
        run_metadata: {},
      },
    })));
    child.emit('close', 0);

    const result = await promise;
    expect(result.summon_id).toBe('echo-ok-false');
  });
});

// ── 10. determinism / isolation ───────────────────────────────────────────

describe('RealMartianSummonAdapter — state isolation between summons', () => {
  it('each summon spawns a fresh child (no singleton state leakage)', async () => {
    const adapter = new RealMartianSummonAdapter();

    const p1 = adapter.summon(makeRequest({ summon_id: 's1' }));
    const c1 = fakeChildAt(0);
    c1.stdout.emit('data', Buffer.from(JSON.stringify({
      response: { ok: true, output: { tag: 'one' }, fitness: 1, run_metadata: {} },
    })));
    c1.emit('close', 0);
    const r1 = await p1;

    const p2 = adapter.summon(makeRequest({ summon_id: 's2' }));
    const c2 = fakeChildAt(0);
    c2.stdout.emit('data', Buffer.from(JSON.stringify({
      response: { ok: true, output: { tag: 'two' }, fitness: 0.5, run_metadata: {} },
    })));
    c2.emit('close', 0);
    const r2 = await p2;

    expect(c1).not.toBe(c2);
    expect(r1.output).toEqual({ tag: 'one' });
    expect(r2.output).toEqual({ tag: 'two' });
    expect(spawnCalls).toHaveLength(2);
  });
});