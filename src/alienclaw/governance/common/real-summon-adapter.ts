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

/**
 * Validate and parse a raw SUMMON_BRIDGE_SPEC v1.0 stdout JSON string into a
 * fully-typed MartianSummonResult. Mirrors validateLeaderboardResponse at the
 * subprocess IPC trust boundary — closes the cast-only type-assertion gap at
 * real-summon-adapter.ts:101-138 (PKT-666).
 *
 * Throws `Error('bridge response validation failed: <precise reason>')` on any
 * contract violation; the adapter's catch block maps it to ok=false.
 */
export function validateBridgeResponse(raw: string, summonId: string): MartianSummonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('bridge response validation failed: response is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('bridge response validation failed: envelope is not an object');
  }

  const envelope = parsed as Record<string, unknown>;

  if (envelope['bridge_version'] !== BRIDGE_VERSION) {
    throw new Error(
      `bridge response validation failed: bridge_version must be "${BRIDGE_VERSION}", got ${JSON.stringify(envelope['bridge_version'])}`,
    );
  }

  const rawResp = envelope['response'];
  if (typeof rawResp !== 'object' || rawResp === null || Array.isArray(rawResp)) {
    throw new Error('bridge response validation failed: response must be an object');
  }
  const resp = rawResp as Record<string, unknown>;

  if (typeof resp['ok'] !== 'boolean') {
    throw new Error(`bridge response validation failed: response.ok must be a boolean, got ${typeof resp['ok']}`);
  }
  const ok = resp['ok'];

  if (ok) {
    // Validate output is a plain object (not string, number, null, array)
    const output = resp['output'];
    if (Array.isArray(output)) {
      throw new Error('bridge response validation failed: response.output must be a plain object (not an array)');
    }
    if (typeof output !== 'object' || output === null) {
      throw new Error(
        `bridge response validation failed: response.output must be a plain object, got ${output === null ? 'null' : typeof output}`,
      );
    }

    // Validate fitness is a finite number in [0.0, 1.0]
    const fitness = resp['fitness'];
    if (typeof fitness !== 'number' || !Number.isFinite(fitness) || fitness < 0 || fitness > 1) {
      throw new Error(
        `bridge response validation failed: response.fitness must be a finite number in [0,1], got ${JSON.stringify(fitness)}`,
      );
    }

    // Validate run_metadata shape
    const rawMeta = resp['run_metadata'];
    if (typeof rawMeta !== 'object' || rawMeta === null || Array.isArray(rawMeta)) {
      throw new Error('bridge response validation failed: response.run_metadata must be an object');
    }
    const meta = rawMeta as Record<string, unknown>;

    // Validate tool_calls is a non-negative integer
    const toolCalls = meta['tool_calls'];
    if (typeof toolCalls !== 'number' || !Number.isInteger(toolCalls) || toolCalls < 0) {
      throw new Error(
        `bridge response validation failed: run_metadata.tool_calls must be a non-negative integer, got ${JSON.stringify(toolCalls)}`,
      );
    }

    // Validate wall_clock_ms is a non-negative integer
    const wallClockMs = meta['wall_clock_ms'];
    if (typeof wallClockMs !== 'number' || !Number.isInteger(wallClockMs) || wallClockMs < 0) {
      throw new Error(
        `bridge response validation failed: run_metadata.wall_clock_ms must be a non-negative integer, got ${JSON.stringify(wallClockMs)}`,
      );
    }

    return {
      summon_id: summonId,
      ok: true,
      output: output as Record<string, unknown>,
      fitness,
      run_metadata: {
        tool_calls: toolCalls,
        wall_clock_ms: wallClockMs,
        ...meta,
      },
    };
  } else {
    // Error path: validate response.error shape
    const rawErr = resp['error'];
    if (typeof rawErr !== 'object' || rawErr === null || Array.isArray(rawErr)) {
      throw new Error(
        `bridge response validation failed: response.error must be an object with code and message, got ${typeof rawErr}`,
      );
    }
    const err = rawErr as Record<string, unknown>;
    if (typeof err['code'] !== 'string') {
      throw new Error(
        `bridge response validation failed: response.error.code must be a string, got ${typeof err['code']}`,
      );
    }
    if (typeof err['message'] !== 'string') {
      throw new Error(
        `bridge response validation failed: response.error.message must be a string, got ${typeof err['message']}`,
      );
    }

    // run_metadata on error path: best-effort, default to zeros if absent/malformed
    let runMetadata: MartianSummonResult['run_metadata'] = { tool_calls: 0, wall_clock_ms: 0 };
    const rawMeta = resp['run_metadata'];
    if (typeof rawMeta === 'object' && rawMeta !== null && !Array.isArray(rawMeta)) {
      const meta = rawMeta as Record<string, unknown>;
      runMetadata = {
        ...meta,
        tool_calls: Number.isInteger(meta['tool_calls']) ? meta['tool_calls'] as number : 0,
        wall_clock_ms: Number.isInteger(meta['wall_clock_ms']) ? meta['wall_clock_ms'] as number : 0,
      };
    }

    return {
      summon_id: summonId,
      ok: false,
      error: `${err['code']}: ${err['message']}`,
      fitness: 0.0,
      run_metadata: runMetadata,
    };
  }
}

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
          resolve(validateBridgeResponse(stdout.trim(), request.summon_id));
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
