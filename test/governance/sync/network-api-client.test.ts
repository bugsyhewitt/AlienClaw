/**
 * Tests for NetworkAPIClient transport-side guards.
 * Verifies HTTPS pin, host allowlist, and redirect: 'error' on _get and _post.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkAPIClient } from '../../../src/alienclaw/governance/common/sync/client.js';

const CANONICAL = 'https://api.alienclaw.net';

describe('NetworkAPIClient constructor', () => {
  it('accepts canonical https URL', () => {
    expect(() => new NetworkAPIClient(CANONICAL, 'k')).not.toThrow();
  });
  it('rejects http URL', () => {
    expect(() => new NetworkAPIClient('http://api.alienclaw.net', 'k'))
      .toThrow('refusing non-https');
  });
  it('rejects off-allowlist URL', () => {
    expect(() => new NetworkAPIClient('https://attacker.com', 'k'))
      .toThrow('refusing off-allowlist host: attacker.com');
  });
  it('rejects malformed URL', () => {
    expect(() => new NetworkAPIClient('not a url', 'k')).toThrow();
  });
});

describe('NetworkAPIClient._get', () => {
  let client: NetworkAPIClient;

  beforeEach(() => {
    client = new NetworkAPIClient(CANONICAL, 'k');
  });

  it('uses redirect: "error"', async () => {
    const mock = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ status: 'ok', version: '1', uptime_seconds: 0 }),
    });
    vi.stubGlobal('fetch', mock);
    await client.health();
    expect(mock).toHaveBeenCalledWith(
      `${CANONICAL}/v1/health`,
      expect.objectContaining({ redirect: 'error' }),
    );
  });
  it('propagates 2xx JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ status: 'ok', version: '1', uptime_seconds: 0 }),
    }));
    const result = await client.health();
    expect(result).toEqual({ ok: true, status: 200, data: { status: 'ok', version: '1', uptime_seconds: 0 } });
  });
  it('propagates non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({ error: { code: 'INTERNAL', message: 'oops' } }),
    }));
    const result = await client.health();
    expect(result).toEqual({ ok: false, status: 500, error: { code: 'INTERNAL', message: 'oops' } });
  });
  it.skip('aborts on timeout (_get has no AbortController; add when _get gains one — packet 046 §6.4.1)', async () => {
    // Conditional per §6.4.1: _get has no timeout on origin/main. Skipped.
  });
});

describe('NetworkAPIClient._post', () => {
  let client: NetworkAPIClient;

  beforeEach(() => {
    client = new NetworkAPIClient(CANONICAL, 'k');
  });

  it('uses redirect: "error"', async () => {
    const mock = vi.fn().mockResolvedValueOnce({
      ok: true, status: 201, json: async () => ({ submission_id: 'sub_x', rank: 1, is_new_top: true }),
    });
    vi.stubGlobal('fetch', mock);
    await client.submitGenome('A'.repeat(256), 'compute', 0.9);
    expect(mock).toHaveBeenCalledWith(
      `${CANONICAL}/v1/genomes`,
      expect.objectContaining({ redirect: 'error' }),
    );
  });
  it('sends JSON body + correct headers', async () => {
    const mock = vi.fn().mockResolvedValueOnce({
      ok: true, status: 201, json: async () => ({ submission_id: 'sub_x', rank: 1, is_new_top: true }),
    });
    vi.stubGlobal('fetch', mock);
    await client.submitGenome('A'.repeat(256), 'compute', 0.9);
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ genome: 'A'.repeat(256), martian_type: 'compute', fitness: 0.9, run_metadata: {} });
  });
  it('propagates 2xx JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, status: 201, json: async () => ({ submission_id: 'sub_x', rank: 5, is_new_top: true }),
    }));
    const result = await client.submitGenome('A'.repeat(256), 'compute', 0.9);
    expect(result).toEqual({ ok: true, status: 201, data: { submission_id: 'sub_x', rank: 5, is_new_top: true } });
  });
  it('propagates non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 400, json: async () => ({ error: { code: 'INVALID_GENOME_LENGTH', message: 'must be 256 chars' } }),
    }));
    const result = await client.submitGenome('A'.repeat(256), 'compute', 0.9);
    expect(result).toEqual({ ok: false, status: 400, error: { code: 'INVALID_GENOME_LENGTH', message: 'must be 256 chars' } });
  });
});
