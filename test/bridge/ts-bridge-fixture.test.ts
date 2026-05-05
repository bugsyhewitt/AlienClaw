/**
 * Bridge fixture compliance tests — TypeScript side.
 *
 * Runs each case in test/fixtures/bridge-fixture.json by spawning
 * `python3 -m alienclaw.bridge` as a subprocess — the exact path the
 * RealMartianSummonAdapter uses in production. Any divergence between
 * Python-side direct-call tests and these subprocess tests is a bug.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

interface BridgeCase {
  description: string;
  request: Record<string, unknown>;
  expected_ok: boolean;
  expected_error_code?: string;
  expected_output_field?: string;
  expected_output_value?: unknown;
  expected_bridge_version?: string;
  expected_request_id_echoed?: boolean;
  expected_fitness?: number;
  expected_metadata_keys?: string[];
}

const FIXTURE_PATH = resolve(__dirname, '../fixtures/bridge-fixture.json');
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { cases: BridgeCase[] };

function runCase(req: Record<string, unknown>): Record<string, unknown> {
  const input = JSON.stringify(req) + '\n';
  const result = spawnSync('python3', ['-m', 'alienclaw.bridge'], {
    input,
    env: { ...process.env, PYTHONPATH: 'src' },
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error) throw result.error;
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

describe('Bridge fixture — TypeScript subprocess runner', () => {
  for (const [idx, tc] of fixture.cases.entries()) {
    describe(`case ${String(idx).padStart(2, '0')}: ${tc.description}`, () => {
      let resp: Record<string, unknown>;
      let response: Record<string, unknown>;

      it('runs without crash', () => {
        resp = runCase(tc.request);
        response = resp['response'] as Record<string, unknown>;
        expect(resp).toBeDefined();
      });

      it('ok matches expected', () => {
        resp = runCase(tc.request);
        response = resp['response'] as Record<string, unknown>;
        expect(response['ok']).toBe(tc.expected_ok);
      });

      if (tc.expected_error_code) {
        it(`error.code = ${tc.expected_error_code}`, () => {
          resp = runCase(tc.request);
          response = resp['response'] as Record<string, unknown>;
          const err = response['error'] as Record<string, unknown>;
          expect(err?.['code']).toBe(tc.expected_error_code);
        });
      }

      if (tc.expected_output_field !== undefined) {
        it(`output.${tc.expected_output_field} = ${JSON.stringify(tc.expected_output_value)}`, () => {
          resp = runCase(tc.request);
          response = resp['response'] as Record<string, unknown>;
          const output = response['output'] as Record<string, unknown>;
          expect(output[tc.expected_output_field!]).toEqual(tc.expected_output_value);
        });
      }

      if (tc.expected_bridge_version) {
        it('bridge_version echoed', () => {
          resp = runCase(tc.request);
          expect(resp['bridge_version']).toBe(tc.expected_bridge_version);
        });
      }

      if (tc.expected_request_id_echoed) {
        it('request_id echoed', () => {
          resp = runCase(tc.request);
          expect(resp['request_id']).toBe((tc.request as Record<string, unknown>)['request_id']);
        });
      }

      if (tc.expected_fitness !== undefined) {
        it(`fitness = ${tc.expected_fitness}`, () => {
          resp = runCase(tc.request);
          response = resp['response'] as Record<string, unknown>;
          expect(response['fitness']).toBeCloseTo(tc.expected_fitness!, 6);
        });
      }

      if (tc.expected_metadata_keys && tc.expected_ok) {
        it('run_metadata has required keys', () => {
          resp = runCase(tc.request);
          response = resp['response'] as Record<string, unknown>;
          const meta = response['run_metadata'] as Record<string, unknown>;
          for (const key of tc.expected_metadata_keys!) {
            expect(meta).toHaveProperty(key);
          }
        });
      }
    });
  }
});
