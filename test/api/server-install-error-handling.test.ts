/**
 * PKT-560: /v1/install route error-handling regression tests.
 *
 * Covers the three behaviors of the catch block on server.ts:237-239:
 *
 *   1. Validation error (handleInstall throws apiError-tagged Error) →
 *      400 with structured error body (INVALID_API_KEY_FORMAT).
 *
 *   2. Non-validation DB error (InstallStore.register throws a plain Error) →
 *      500 INTERNAL_ERROR; the original DB error message does NOT leak to the
 *      client response body.
 *
 *   3. Non-validation DB error → process.stderr records the ORIGINAL error
 *      (e.g. 'ER_ACCESS_DENIED_ERROR'), NOT a JSON.parse SyntaxError wrapper.
 *
 * Test 3 is the primary regression guard: before this fix, the catch at
 * server.ts:238 called JSON.parse(e.message) on the non-JSON DB error string,
 * which threw a SyntaxError that replaced the original error in stderr.
 *
 * Mirrors the vi.doMock pattern from ts-api-server-route-handler-defensive-paths.test.ts.
 * No DB required.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Steerable mock state ──────────────────────────────────────────────────

type RegisterBehavior = 'success' | 'db_error';
let registerBehavior: RegisterBehavior = 'success';

// ── Server fixture ────────────────────────────────────────────────────────

let dataRoot = '';
let testServer: Server;
let base = '';

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'alienclaw-pkt560-'));

  vi.resetModules();

  vi.doMock('../../src/alienclaw/api/storage.js', () => {
    class InstallStore {
      async register(_apiKeyHash: string, _machineHash: string): Promise<[string, boolean]> {
        if (registerBehavior === 'db_error') {
          throw new Error("ER_ACCESS_DENIED_ERROR: Access denied for user 'root'@'localhost'");
        }
        return ['install-pkt560-id', true];
      }
      async exists(_apiKeyHash: string): Promise<boolean> { return true; }
      async count(): Promise<number> { return 0; }
    }
    class SubmissionStore {
      async save(): Promise<[string, string]> { return ['sub-id', '2026-01-01T00:00:00.000Z']; }
      async topForType(): Promise<unknown[]> { return []; }
      async countForType(): Promise<number> { return 0; }
      async rankForFitness(): Promise<number> { return 1; }
      async isNewTop(): Promise<boolean> { return true; }
      async findDuplicate(): Promise<unknown> { return null; }
    }
    class GlobalStats {
      async get(): Promise<unknown> {
        return { total_genomes: 0, total_installs: 0, total_fitness_evaluations: 0, top_fitness_by_type: {} };
      }
    }
    const initPool = (_dbUrl?: string): unknown => ({});
    return { InstallStore, SubmissionStore, GlobalStats, initPool };
  });

  const mod = await import('../../src/alienclaw/api/server.js');
  mod.configure({ dbUrl: 'mysql://mock-not-used', dataRoot });
  testServer = await mod.createApiServer(0, '127.0.0.1');
  const addr = testServer.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  testServer?.close();
  vi.doUnmock('../../src/alienclaw/api/storage.js');
  vi.resetModules();
  if (dataRoot) rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  registerBehavior = 'success';
});

async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* empty / non-JSON body */ }
  return { status: res.status, body: parsed };
}

// 43 Base62 chars — passes format validation; 64 lowercase hex chars for machine_hash
const VALID_API_KEY = 'A'.repeat(43);
const VALID_MACHINE_HASH = 'a'.repeat(64);

describe('PKT-560: /v1/install route error handling', () => {

  // ── (1) Validation error → 400 with structured body ──────────────────────
  //
  // handleInstall throws an apiError-tagged Error (after fix) or a plain Error
  // with JSON message (before fix). Both paths should produce 400 with structured
  // body — this test confirms the post-fix behavior still satisfies the contract.

  it('returns 400 INVALID_API_KEY_FORMAT when api_key fails format validation', async () => {
    const { status, body } = await post('/v1/install', {
      api_key: 'too-short',
      machine_hash: VALID_MACHINE_HASH,
    });
    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe('INVALID_API_KEY_FORMAT');
  });

  // ── (2) DB error → 500 INTERNAL_ERROR, original message NOT in body ───────
  //
  // InstallStore.register throws a non-JSON plain Error. The route's catch must
  // NOT leak the DB error into the client response.

  it('returns 500 INTERNAL_ERROR (no DB message leaked) when InstallStore.register throws', async () => {
    registerBehavior = 'db_error';
    const { status, body } = await post('/v1/install', {
      api_key: VALID_API_KEY,
      machine_hash: VALID_MACHINE_HASH,
    });
    expect(status).toBe(500);
    expect((body as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR');
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('ER_ACCESS_DENIED_ERROR');
    expect(bodyStr).not.toContain('Access denied');
  });

  // ── (3) DB error → original error in stderr, NOT a SyntaxError ────────────
  //
  // PRIMARY REGRESSION GUARD (PKT-560):
  // Before the fix, server.ts:238 called JSON.parse(e.message) on the non-JSON
  // DB error string, throwing a SyntaxError. The outer catch at line 286 then
  // logged "[api] unhandled error: SyntaxError: Unexpected token 'E', ..."
  // instead of the original ER_ACCESS_DENIED_ERROR.
  //
  // After the fix, the inner catch re-throws the original Error, so stderr
  // contains 'ER_ACCESS_DENIED_ERROR', not 'SyntaxError'.

  it('writes the original DB error to stderr (not a SyntaxError wrapper)', async () => {
    registerBehavior = 'db_error';

    const stderrLines: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrLines.push(String(chunk));
      return true;
    });

    try {
      await post('/v1/install', {
        api_key: VALID_API_KEY,
        machine_hash: VALID_MACHINE_HASH,
      });
    } finally {
      spy.mockRestore();
    }

    const combined = stderrLines.join('');
    expect(combined).toContain('ER_ACCESS_DENIED_ERROR');
    expect(combined).not.toContain('SyntaxError');
  });
});
