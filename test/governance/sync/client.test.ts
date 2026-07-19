/**
 * Tests for NetworkAPIClient (src/alienclaw/governance/common/sync/client.ts).
 *
 * Focus: the _parse() result-shaping logic                          client.ts:120-140
 *   - non-JSON body → { ok:false, status, error.code === 'PARSE_ERROR' }
 *   - 2xx + JSON     → { ok:true,  status, data }
 *   - non-2xx + error envelope → error forwarded verbatim
 *   - non-2xx + JSON lacking an `error` field → UNKNOWN_ERROR fallback
 * Plus request-construction checks (trailing-slash strip, auth header,
 * URL encoding) that all flow through the same parser.
 *
 * The real client is exercised against a stubbed global `fetch`; no network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkAPIClient } from '../../../src/alienclaw/governance/common/sync/client.js';
import { makeFetchResponse } from './_stub-client.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── _parse: non-JSON handling ────────────────────────────────────────────────

describe('NetworkAPIClient._parse — non-JSON bodies', () => {
  it('returns a PARSE_ERROR result when the body is not valid JSON (2xx)', async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ status: 200, ok: true, throwOnJson: true }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    const res = await client.health();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(200);
      expect(res.error.code).toBe('PARSE_ERROR');
      expect(res.error.message).toMatch(/not valid JSON/i);
    }
  });

  it('returns PARSE_ERROR (preserving status) when an error body is non-JSON', async () => {
    // e.g. a 502 with an HTML error page body that json() chokes on.
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ status: 502, ok: false, throwOnJson: true }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    const res = await client.health();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(502); // status is preserved from the response
      expect(res.error.code).toBe('PARSE_ERROR');
    }
  });

  it('propagates a true network failure (fetch rejects) as a thrown error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    // The client only catches JSON-parse failures; transport failures throw.
    await expect(client.health()).rejects.toThrow('ECONNREFUSED');
  });
});

// ── _parse: success and error envelopes ──────────────────────────────────────

describe('NetworkAPIClient._parse — success and error envelopes', () => {
  it('wraps a 2xx JSON body as an ok result carrying the data', async () => {
    const body = { status: 'ok', version: '1.2.3', uptime_seconds: 99 };
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ status: 200, ok: true, json: body }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    const res = await client.health();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.status).toBe(200);
      expect(res.data).toEqual(body);
    }
  });

  it('passes a 201 through as ok (used by submitGenome for new submissions)', async () => {
    const body = { submission_id: 's1', rank: 1, is_new_top: true };
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ status: 201, ok: true, json: body }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    const res = await client.submitGenome('GENOME', 'compute', 0.9, 'ALIENBOT');

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.status).toBe(201);
      expect(res.data.submission_id).toBe('s1');
    }
  });

  it('forwards a structured error envelope from a non-2xx response', async () => {
    const body = {
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'slow down', details: { retry_after: 30 } },
    };
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ status: 429, ok: false, json: body }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    const res = await client.submitGenome('GENOME', 'compute', 0.9, 'ALIENBOT');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(429);
      expect(res.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res.error.message).toBe('slow down');
      expect(res.error.details).toEqual({ retry_after: 30 });
    }
  });

  it('falls back to UNKNOWN_ERROR when a non-2xx body has no error field', async () => {
    // Server returned a 500 with a JSON body that is not the expected envelope.
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ status: 500, ok: false, json: { weird: 'shape' } }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    const res = await client.health();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(500);
      expect(res.error.code).toBe('UNKNOWN_ERROR');
      // _parse uses `String(json)` for the message. For a plain object that is
      // the literal "[object Object]" (documents the current behaviour — the
      // message is not a useful serialization of the body).
      expect(res.error.message).toBe('[object Object]');
    }
  });

  it('surfaces UNKNOWN_ERROR with the stringified body for a primitive non-2xx body', async () => {
    // A bare string body (no `.error`) → fallback code + String() message.
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ status: 500, ok: false, json: 'plain text error' }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    const res = await client.health();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('UNKNOWN_ERROR');
      expect(res.error.message).toBe('plain text error');
    }
  });

  // NOTE (documents current behaviour, not desired behaviour):
  // When a non-2xx body parses to JSON `null`, _parse does `(json as APIError).error`
  // which dereferences null and THROWS a TypeError rather than returning a clean
  // UNKNOWN_ERROR result. This is a latent edge-case in client.ts:134. The test
  // below pins the *actual* behaviour so a future fix (guarding null) will flip it
  // deliberately rather than silently.
  it('throws on a non-2xx body that is JSON null (latent edge-case, pinned)', async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ status: 503, ok: false, json: null }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    await expect(client.health()).rejects.toThrow(TypeError);
  });
});

// ── request construction (all funnel through _parse) ─────────────────────────

describe('NetworkAPIClient — request construction', () => {
  function lastCall() {
    return fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  }

  it('strips a trailing slash from the base URL', async () => {
    fetchMock.mockResolvedValue(makeFetchResponse({ status: 200, json: {} }));
    const client = new NetworkAPIClient('https://api.example.test/', 'key');
    await client.health();

    const [url] = lastCall();
    expect(url).toBe('https://api.example.test/v1/health');
  });

  it('sends the bearer auth header on submitGenome', async () => {
    fetchMock.mockResolvedValue(
      makeFetchResponse({ status: 201, json: { submission_id: 's', rank: 1, is_new_top: true } }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'secret-key');
    await client.submitGenome('GENOME', 'compute', 0.5, 'ALIENBOT', { run: 1 });

    const [url, init] = lastCall();
    expect(url).toBe('https://api.example.test/v1/genomes');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer secret-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      genome: 'GENOME',
      martian_type: 'compute',
      fitness: 0.5,
      leaderboard_name: 'ALIENBOT',
      run_metadata: { run: 1 },
    });
  });

  it('url-encodes the martian_type query param on topGenomes', async () => {
    fetchMock.mockResolvedValue(
      makeFetchResponse({
        status: 200,
        json: { martian_type: 'search text', genomes: [], total_for_type: 0 },
      }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    await client.topGenomes('search text', 25);

    const [url] = lastCall();
    expect(url).toBe(
      'https://api.example.test/v1/genomes/top?martian_type=search%20text&n=25',
    );
  });

  it('sends machine_hash and api_key on install', async () => {
    fetchMock.mockResolvedValue(
      makeFetchResponse({
        status: 200,
        json: { status: 'registered', install_id: 'i', rate_limit: { submissions_per_hour: 10 } },
      }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'the-key');
    await client.install('hash-123');

    const [url, init] = lastCall();
    expect(url).toBe('https://api.example.test/v1/install');
    expect(JSON.parse(init.body)).toEqual({ api_key: 'the-key', machine_hash: 'hash-123' });
  });
});

// ── martianTypes() ──────────────────────────────────────────────────────────

describe('NetworkAPIClient.martianTypes()', () => {
  it('returns the parsed MartianTypesResponse on 200', async () => {
    const body = { martian_types: [{ name: 'compute' }, { name: 'search_text' }], total: 2 };
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ status: 200, ok: true, json: body }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    const res = await client.martianTypes();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.status).toBe(200);
      expect(res.data.total).toBe(2);
      expect(res.data.martian_types).toEqual([{ name: 'compute' }, { name: 'search_text' }]);
    }
  });

  it('hits GET /v1/martian-types with no auth header', async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ status: 200, ok: true, json: { martian_types: [], total: 0 } }),
    );
    const client = new NetworkAPIClient('https://api.example.test', 'key');
    await client.martianTypes();

    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(url).toBe('https://api.example.test/v1/martian-types');
    // GET — no init or no method field (fetch defaults to GET)
    expect(init).toBeUndefined();
  });
});
