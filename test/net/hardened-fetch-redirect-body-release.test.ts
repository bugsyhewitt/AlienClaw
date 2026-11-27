/**
 * hardenedFetch must release the body of every response it does not read: redirect hops
 * and non-2xx responses. Otherwise each hop's connection and buffered body stay held
 * until the whole call ends (up to MAX_REDIRECTS_CEILING of them). Found by the second
 * /code-review pass on 2026-11-26. Network-free: fetch and DNS are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as dnsModule from 'node:dns/promises';
import { hardenedFetch, type FetchPolicy } from '../../src/alienclaw/net/hardened-fetch.js';

const lookup = vi.mocked(dnsModule.lookup);
const POLICY: FetchPolicy = { timeoutMs: 5_000, maxBytes: 1024 };

beforeEach(() => {
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  lookup.mockReset();
});

/** A response whose body records whether the caller cancelled it. */
function tracked(status: number, headers: Record<string, string>): {
  response: Response;
  cancelled: () => boolean;
} {
  let wasCancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode('unread body'));
    },
    cancel() {
      wasCancelled = true;
    },
  });
  return { response: new Response(body, { status, headers }), cancelled: () => wasCancelled };
}

describe('hardenedFetch releases bodies it does not read', () => {
  it('cancels the body of each redirect hop', async () => {
    const hop1 = tracked(302, { location: 'https://two.example/' });
    const hop2 = tracked(301, { location: 'https://three.example/' });
    const responses = [hop1.response, hop2.response, new Response('done')];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses.shift()!);

    await expect(hardenedFetch('https://one.example/', POLICY)).resolves.toBe('done');
    expect(hop1.cancelled()).toBe(true);
    expect(hop2.cancelled()).toBe(true);
  });

  it('cancels the body of a non-2xx response before throwing', async () => {
    const failing = tracked(500, {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => failing.response);

    await expect(hardenedFetch('https://one.example/', POLICY)).rejects.toThrow('HTTP 500');
    expect(failing.cancelled()).toBe(true);
  });
});
