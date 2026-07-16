/**
 * run-evolve.test.ts — exercises the `runEvolve` function body directly.
 *
 * This file deliberately does NOT mock `evolve.js` so that the real
 * implementation is exercised. `node:child_process.spawn` is mocked at the
 * module level (vi.mock is hoisted) so the static import inside evolve.ts is
 * intercepted without launching a real subprocess.
 *
 * Covers:
 *   L63 binary-expr (ALIENCLAW_PYTHON_BIN ?? 'python3') — both arms
 *   L84 binary-expr (code ?? 1) — both arms
 *   L80-82 error handler — covered by test 3
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual() as Record<string, unknown>;
  return { ...actual, spawn: vi.fn() };
});

import { runEvolve } from '../../src/alienclaw/cli/evolve.js';

const mockSpawn = vi.mocked(spawn);

function makeChild() {
  const stdout = new Readable({ read() {} });
  return Object.assign(new EventEmitter(), { stdout });
}

describe('runEvolve', () => {
  beforeEach(() => {
    delete process.env['ALIENCLAW_PYTHON_BIN'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['ALIENCLAW_PYTHON_BIN'];
  });

  it('uses ALIENCLAW_PYTHON_BIN when set and resolves with numeric exit code (L63 arm0, L84 arm0)', async () => {
    process.env['ALIENCLAW_PYTHON_BIN'] = '/custom/python3.12';
    const child = makeChild();
    mockSpawn.mockReturnValue(child as ReturnType<typeof spawn>);

    const p = runEvolve({ martianType: 'compute_alone', generations: 3, population: 4 });
    child.emit('close', 2);
    const rc = await p;

    expect(mockSpawn).toHaveBeenCalledWith('/custom/python3.12', expect.any(Array), expect.any(Object));
    expect(rc).toBe(2);
  });

  it('falls back to python3 when ALIENCLAW_PYTHON_BIN is absent and resolves with null→1 (L63 arm1, L84 arm1)', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child as ReturnType<typeof spawn>);

    const p = runEvolve({ martianType: 'compute_alone', generations: 1, population: 2 });
    child.emit('close', null);
    const rc = await p;

    expect(mockSpawn).toHaveBeenCalledWith('python3', expect.any(Array), expect.any(Object));
    expect(rc).toBe(1);
  });

  it('resolves 1 and logs error when child emits error event (L80-82)', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child as ReturnType<typeof spawn>);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const p = runEvolve({ martianType: 'compute_alone', generations: 1, population: 2 });
    child.emit('error', new Error('ENOENT'));
    const rc = await p;

    expect(rc).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  it('formats and logs stdout lines as they arrive (L76 readline callback)', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child as ReturnType<typeof spawn>);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const p = runEvolve({ martianType: 'compute_alone', generations: 5, population: 4 });
    child.stdout.push('{"generation":2,"mean_fitness":0.55,"max_fitness":0.87}\n');
    child.stdout.push(null);
    child.emit('close', 0);
    await p;
    // readline processes 'readable' events asynchronously in Node v17+; drain one tick
    await new Promise(resolve => setImmediate(resolve));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('gen 2/5'));
  });
});
