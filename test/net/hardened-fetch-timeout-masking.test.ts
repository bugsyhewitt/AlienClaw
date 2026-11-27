/**
 * test/net/hardened-fetch-timeout-masking.test.ts
 *
 * Regression (2026-11-26 review): hardenedFetch's outer catch turned EVERY error
 * into a timeout once the deadline had fired (`if (signal.aborted) throw
 * timeoutError()`), so an SSRF rejection or an HTTP error that settled just as
 * the deadline expired was reported as "Fetch timeout". Only errors that ARE the
 * abort (the deadline's own reason, or an AbortError raised by it) become a
 * timeout now; every other error is reported as itself.
 *
 * Deterministic: setTimeout/clearTimeout are faked and the deadline is fired
 * synchronously (vi.advanceTimersByTime) at the exact point under test. DNS is
 * vi.mock'ed and fetch is stubbed, so nothing touches the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as dnsModule from 'node:dns/promises';
import { hardenedFetch, type FetchPolicy } from '../../src/alienclaw/net/hardened-fetch.js';

const lookup = vi.mocked(dnsModule.lookup);
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const TIMEOUT_MS = 200;
const POLICY: FetchPolicy = { timeoutMs: TIMEOUT_MS, maxBytes: 1024 };
const TIMEOUT = `Fetch timeout: exceeded ${TIMEOUT_MS}ms budget`;

/** Fire hardenedFetch's deadline now, synchronously. */
function fireDeadline(): void {
  vi.advanceTimersByTime(TIMEOUT_MS);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  lookup.mockResolvedValue(PUBLIC as never);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('test: unexpected fetch');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  lookup.mockReset();
});

/** The message hardenedFetch rejects with; fails the test if it resolves. */
async function failure(pending: Promise<string>): Promise<string> {
  try {
    await pending;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('test: hardenedFetch resolved');
}

/**
 * Fire the deadline at the moment a race inside hardenedFetch rejects with an
 * error matching `pattern`: after that error has won the race, before
 * hardenedFetch's own `await` resumes. The handler is attached inside
 * Promise.race, i.e. before hardenedFetch awaits the race, so it runs first.
 */
function fireDeadlineWhenRaceRejects(pattern: RegExp): void {
  const realRace = Promise.race.bind(Promise);
  vi.spyOn(Promise, 'race').mockImplementation(((values: Iterable<unknown>) => {
    const settled = realRace(values);
    settled.then(undefined, (err: unknown) => {
      if (pattern.test(String((err as Error | undefined)?.message))) fireDeadline();
    });
    return settled;
  }) as typeof Promise.race);
}

describe('hardenedFetch reports the real error when it settles as the deadline fires', () => {
  it('a resolver that rejects with "Blocked IP" exactly as the deadline fires', async () => {
    lookup.mockRejectedValue(new Error('Blocked IP 127.0.0.1'));
    fireDeadlineWhenRaceRejects(/Blocked IP/);
    const message = await failure(hardenedFetch('https://example.com/', POLICY));
    expect(message).toBe('DNS resolution failed for "example.com": Blocked IP 127.0.0.1');
  });

  it('a resolver answer in a blocked range, rejected as the deadline fires', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    fireDeadlineWhenRaceRejects(/^SSRF rejected/);
    const message = await failure(hardenedFetch('https://example.com/', POLICY));
    expect(message).toBe('SSRF rejected: resolved address 127.0.0.1 is in a blocked range');
  });

  it('an HTTP error whose response arrives as the deadline fires', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fireDeadline(); // the budget runs out while the 500 is being delivered
      return new Response('nope', { status: 500 });
    });
    const message = await failure(hardenedFetch('https://example.com/', POLICY));
    expect(message).toBe('HTTP 500 from example.com');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('controls: the deadline itself is still reported as a timeout', () => {
  it('a resolver still pending when the deadline fires', async () => {
    lookup.mockImplementation((() => new Promise(() => { /* never answers */ })) as never);
    const pending = failure(hardenedFetch('https://example.com/', POLICY));
    fireDeadline();
    expect(await pending).toBe(TIMEOUT);
  });

  it('fetch rejecting with an AbortError as the deadline fires', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fireDeadline();
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    expect(await failure(hardenedFetch('https://example.com/', POLICY))).toBe(TIMEOUT);
  });

  it("fetch rejecting with the signal's own abort reason (what undici does)", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      fireDeadline();
      throw (init?.signal as AbortSignal).reason;
    });
    expect(await failure(hardenedFetch('https://example.com/', POLICY))).toBe(TIMEOUT);
  });

  it('a redirect that arrives as the deadline fires stops at the next hop', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fireDeadline();
      return new Response(null, { status: 302, headers: { location: 'https://example.com/next' } });
    });
    expect(await failure(hardenedFetch('https://example.com/', POLICY))).toBe(TIMEOUT);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('an error with no deadline in play is unchanged', async () => {
    lookup.mockRejectedValue(new Error('Blocked IP 127.0.0.1'));
    const message = await failure(hardenedFetch('https://example.com/', POLICY));
    expect(message).toBe('DNS resolution failed for "example.com": Blocked IP 127.0.0.1');
  });
});
