/**
 * RealMartianSummonAdapter — spawns python3 -m alienclaw.bridge per summon.
 *
 * Implements SUMMON_BRIDGE_SPEC v1.0:
 * - Sends one JSON line to stdin
 * - Reads one JSON response from stdout
 * - Subprocess exits after each summon (stateless)
 * - Security: non-shell spawn, inputs via JSON only, no user input in argv
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { MartianSummonAdapter, MartianSummonRequest, MartianSummonResult } from './summon-adapter.js';

const BRIDGE_VERSION = '1.0';
const DEFAULT_PYTHON_BIN = process.env['ALIENCLAW_PYTHON_BIN'] ?? 'python3';
const STDERR_TAIL_BYTES = 4096;

export class RealMartianSummonAdapter implements MartianSummonAdapter {
  private readonly pythonBin: string;

  constructor(pythonBin: string = DEFAULT_PYTHON_BIN) {
    this.pythonBin = pythonBin;
  }

  async summon(request: MartianSummonRequest): Promise<MartianSummonResult> {
    const bridgeRequest = JSON.stringify({
      bridge_version: BRIDGE_VERSION,
      request_id: randomUUID(),
      request: request.fromPopulation
        ? {
            kind: 'summon-from-population',
            martian_type: request.martian_type,
            inputs: request.inputs,
            timeout_ms: request.timeout_ms,
          }
        : {
            kind: 'summon',
            genome: request.genome,
            martian_type: request.martian_type,
            inputs: request.inputs,
            timeout_ms: request.timeout_ms,
          },
    });

    const timeoutMs = request.timeout_ms;
    let stdout = '';
    let stderrBuf = '';
    let timedOut = false;

    const result = await new Promise<MartianSummonResult>((resolve) => {
      const child = spawn(
        this.pythonBin,
        ['-m', 'alienclaw.bridge'],
        { shell: false, env: { ...process.env, PYTHONPATH: 'src' } },
      );

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => { child.kill('SIGKILL'); }, 5000);
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8');
        if (stderrBuf.length > STDERR_TAIL_BYTES * 2) {
          stderrBuf = stderrBuf.slice(-STDERR_TAIL_BYTES);
        }
      });

      child.stdin.write(bridgeRequest + '\n');
      child.stdin.end();

      child.on('close', (exitCode) => {
        clearTimeout(timer);

        if (timedOut) {
          resolve({
            summon_id: request.summon_id,
            ok: false,
            error: `TIMEOUT after ${timeoutMs}ms`,
            fitness: 0.0,
            run_metadata: { tool_calls: 0, wall_clock_ms: timeoutMs },
          });
          return;
        }

        if (exitCode !== 0) {
          const stderrTail = stderrBuf.slice(-STDERR_TAIL_BYTES);
          resolve({
            summon_id: request.summon_id,
            ok: false,
            error: `Subprocess exited with code ${exitCode}`,
            fitness: 0.0,
            run_metadata: { tool_calls: 0, wall_clock_ms: 0, exit_code: exitCode, stderr_tail: stderrTail },
          });
          return;
        }

        try {
          const envelope = JSON.parse(stdout.trim()) as Record<string, unknown>;
          const resp = envelope['response'] as Record<string, unknown>;
          const ok = resp['ok'] as boolean;

          if (ok) {
            const meta = resp['run_metadata'] as Record<string, unknown>;
            resolve({
              summon_id: request.summon_id,
              ok: true,
              output: resp['output'] as Record<string, unknown>,
              fitness: resp['fitness'] as number,
              run_metadata: {
                tool_calls: meta['tool_calls'] as number ?? 1,
                wall_clock_ms: meta['wall_clock_ms'] as number ?? 0,
                ...meta,
              },
            });
          } else {
            const err = resp['error'] as Record<string, unknown>;
            resolve({
              summon_id: request.summon_id,
              ok: false,
              error: `${err['code']}: ${err['message']}`,
              fitness: 0.0,
              run_metadata: resp['run_metadata'] as MartianSummonResult['run_metadata'],
            });
          }
        } catch (parseErr) {
          resolve({
            summon_id: request.summon_id,
            ok: false,
            error: `Bridge response parse failed: ${parseErr}`,
            fitness: 0.0,
            run_metadata: { tool_calls: 0, wall_clock_ms: 0 },
          });
        }
      });
    });

    return result;
  }
}
