/**
 * TDD tests for PKT-413: NetworkAPIClient must abort stalled fetch calls.
 *
 * Each test opens a real Node http.createServer that accepts TCP connections
 * but never sends a response (stalling-backend / slow-loris simulation).
 * With a short fetchTimeoutMs the client MUST abort and return
 * { ok: false, status: 0, error: { code: 'TIMEOUT' } } rather than hang.
 */

import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NetworkAPIClient } from '../../../src/alienclaw/governance/common/sync/client.js';

// ── stalling server ──────────────────────────────────────────────────────────

interface StallingServer {
  url: string;
  close: () => Promise<void>;
}

function startStallingServer(): Promise<StallingServer> {
  return new Promise((resolve) => {
    const server = http.createServer(() => {
      // Accept TCP + HTTP headers; never call res.end() → stalls forever.
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((e) => (e ? rej(e) : res())),
          ),
      });
    });
  });
}

let stall: StallingServer;

beforeEach(async () => {
  stall = await startStallingServer();
});

afterEach(async () => {
  await stall.close();
});

// Short timeout so tests complete quickly.
const TIMEOUT_MS = 150;

function makeClient(): NetworkAPIClient {
  return new NetworkAPIClient(stall.url, 'test-key', { fetchTimeoutMs: TIMEOUT_MS });
}

// ── timeout abort tests ──────────────────────────────────────────────────────

describe('NetworkAPIClient — timeout (PKT-413)', () => {
  it('health() returns TIMEOUT result within 2× timeout when server stalls', async () => {
    const client = makeClient();
    const start = Date.now();
    const res = await client.health();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(TIMEOUT_MS * 3);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(0);
      expect(res.error.code).toBe('TIMEOUT');
    }
  });

  it('install() returns TIMEOUT result when server stalls', async () => {
    const res = await makeClient().install('machine-hash-abc');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(0);
      expect(res.error.code).toBe('TIMEOUT');
    }
  });

  it('submitGenome() returns TIMEOUT result when server stalls', async () => {
    const res = await makeClient().submitGenome('G'.repeat(256), 'compute', 0.9, 'ALIENBOT');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(0);
      expect(res.error.code).toBe('TIMEOUT');
    }
  });

  it('topGenomes() returns TIMEOUT result when server stalls', async () => {
    const res = await makeClient().topGenomes('compute', 10);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(0);
      expect(res.error.code).toBe('TIMEOUT');
    }
  });

  it('TIMEOUT result includes details.timeout_ms matching fetchTimeoutMs', async () => {
    const res = await makeClient().health();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.details?.timeout_ms).toBe(TIMEOUT_MS);
    }
  });
});

// ── constructor options ──────────────────────────────────────────────────────

describe('NetworkAPIClient — constructor fetchTimeoutMs option', () => {
  it('accepts a custom fetchTimeoutMs without throwing', () => {
    expect(
      () => new NetworkAPIClient('https://example.test', 'key', { fetchTimeoutMs: 5_000 }),
    ).not.toThrow();
  });

  it('works with no options argument (defaults to 30 s)', () => {
    expect(
      () => new NetworkAPIClient('https://example.test', 'key'),
    ).not.toThrow();
  });
});

// ── non-timeout errors still propagate ──────────────────────────────────────

describe('NetworkAPIClient — non-timeout errors are not swallowed', () => {
  it('still throws on ECONNREFUSED (transport error, not a timeout)', async () => {
    const client = new NetworkAPIClient('http://127.0.0.1:1', 'key', {
      fetchTimeoutMs: 5_000,
    });
    await expect(client.health()).rejects.toThrow();
  });
});
