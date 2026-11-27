/**
 * Shared SSRF vector corpus: every vector's recorded TS verdict.
 *
 * The corpus (../../vectors/ssrf-vectors.json) is shared with the Python
 * package and RECORDS current behaviour per language; vectors/DIFFERENCES.md
 * lists where they disagree. A failure here means the TS verdict changed: if
 * that is intended, regenerate with `python3 vectors/generate.py --write` and
 * review the diff (see vectors/README.md).
 *
 * Harness (identical to vectors/generate-ts.mjs; change both together):
 *   level "url": hardenedFetch(input, POLICY). dns.lookup answers an IP
 *     literal with itself (as Node's does), never resolves a bracketed name,
 *     and answers every other name with resolves_to (ENOTFOUND when absent).
 *     net.Socket#connect is a tripwire: it records the attempt and destroys
 *     the socket before anything is sent, whatever transport the package uses.
 *     "allow" = a connect was attempted; "block" = hardenedFetch rejected first.
 *   level "ip": validateResolvedAddresses([{ address: input, family: isIP(input) }]).
 */

import { readFileSync } from 'node:fs';
import * as net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as dnsModule from 'node:dns/promises';
import {
  hardenedFetch,
  validateResolvedAddresses,
  type FetchPolicy,
  type ResolvedAddress,
} from '../src/index.js';

type Verdict = 'block' | 'allow';

interface Vector {
  id: string;
  category: string;
  input: string;
  level: 'url' | 'ip';
  resolves_to?: string[];
  expected: { python: Verdict; ts: Verdict };
  rationale: string;
  refs: string[];
}

const corpus = JSON.parse(
  readFileSync(new URL('../../vectors/ssrf-vectors.json', import.meta.url), 'utf8'),
) as { schema_version: number; vectors: Vector[] };

const POLICY: FetchPolicy = { timeoutMs: 5_000, maxBytes: 64 * 1024 };

const lookup = vi.mocked(dnsModule.lookup);

function fakeLookupAnswers(hostname: string, resolvesTo: string[] | undefined): ResolvedAddress[] {
  const family = net.isIP(hostname);
  if (family !== 0) return [{ address: hostname, family }];
  if (hostname.startsWith('[') || resolvesTo === undefined) {
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
  }
  return resolvesTo.map((address) => ({ address, family: net.isIP(address) }));
}

/** Replace net.Socket#connect; returns the list of attempted targets. */
function connectTripwire(): string[] {
  const attempts: string[] = [];
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (
    this: net.Socket,
    ...args: unknown[]
  ) {
    // Node's own callers pass one normalized [options, callback] array.
    const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    const opts = (typeof first === 'object' && first !== null ? first : { port: first }) as
      { host?: string; path?: string; port?: unknown };
    attempts.push(`${opts.host ?? opts.path}:${String(opts.port)}`);
    process.nextTick(() => this.destroy(new Error('connect blocked by the vector harness')));
    return this;
  });
  return attempts;
}

async function tsVerdict(vector: Vector): Promise<{ verdict: Verdict; reason: string }> {
  if (vector.level === 'ip') {
    try {
      validateResolvedAddresses([{ address: vector.input, family: net.isIP(vector.input) }]);
      return { verdict: 'allow', reason: 'every resolved address passed' };
    } catch (err) {
      return { verdict: 'block', reason: (err as Error).message };
    }
  }
  lookup.mockImplementation((async (hostname: string) =>
    fakeLookupAnswers(hostname, vector.resolves_to)) as never);
  const attempts = connectTripwire();
  let outcome = 'resolved';
  try {
    await hardenedFetch(vector.input, POLICY);
  } catch (err) {
    outcome = (err as Error).message;
  }
  if (attempts.length > 0) return { verdict: 'allow', reason: `connect to ${attempts.join(', ')}` };
  if (outcome === 'resolved') throw new Error('hardenedFetch resolved without a connect');
  return { verdict: 'block', reason: outcome };
}

afterEach(() => {
  vi.restoreAllMocks();
  lookup.mockReset();
});

describe('shared SSRF vector corpus (vectors/ssrf-vectors.json)', () => {
  it('is loaded', () => {
    expect(corpus.schema_version).toBe(1);
    expect(corpus.vectors.length).toBeGreaterThanOrEqual(150);
    expect(new Set(corpus.vectors.map((v) => v.id)).size).toBe(corpus.vectors.length);
  });

  for (const vector of corpus.vectors) {
    it(vector.id, async () => {
      const { verdict, reason } = await tsVerdict(vector);
      expect(
        verdict,
        `${vector.id} ${JSON.stringify(vector.input)}: got ${verdict} (${reason}); ` +
          `corpus records ${vector.expected.ts}. ${vector.rationale}`,
      ).toBe(vector.expected.ts);
    });
  }
});
