/**
 * PKT-1475 — File-A: `sync/pull.ts` crashes with an uncaught TypeError when the
 * API returns a response whose `genomes` field is not an array.
 *
 * THE COVERAGE GAP THIS FILE CLOSES:
 *   The existing pull.ts suite (`test/governance/sync/pull.test.ts` and
 *   `test/governance/sync/seed-empty-populations.test.ts`) drives the code
 *   through `StubClient`, whose `topGenomes()` is TYPE-CONSTRAINED to return
 *   `APIResult<TopGenomesResponse>`. The stub therefore ALWAYS produces a
 *   well-formed `genomes` array, and the malformed-shape branch is
 *   structurally untestable with it.
 *
 *   This file drives the REAL `NetworkAPIClient` against a stubbed global
 *   `fetch`, so an arbitrary JSON body reaches the real `_parse` cast
 *   (`json as T` — an unchecked cast) and then the real `pull.ts` consumer.
 *
 * THE DEFECT:
 *   `src/alienclaw/governance/common/sync/pull.ts:85-86`
 *       const entries = r.data.genomes;
 *       result.received = entries.length;
 *   `r.data` is an unchecked cast of the parsed JSON body. If the server (or
 *   an intermediary, or a schema drift) returns `genomes` as a string / null /
 *   an object / omits it, then:
 *       - `entries.length` throws TypeError (null/undefined), or
 *       - `entries.filter` throws TypeError (string/object)
 *   The throw propagates out of `pullTopGenomes` / `seedEmptyPopulations`,
 *   aborting the ENTIRE pull for every remaining martian type and, in the
 *   scheduler, suppressing `onCycle(summary)` entirely.
 *
 * EXPECTED BEHAVIOUR (the fix):
 *   A malformed response body is a per-type FAILURE that is RECORDED in
 *   `result.errors` — exactly like the existing `!r.ok` fetch-failure branch
 *   at pull.ts:80-83 — not an uncaught exception that kills the whole cycle.
 *
 * Test IDs are prefixed `R-1475-*` for traceability.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NetworkAPIClient } from '../../../src/alienclaw/governance/common/sync/client.js';
import { pullTopGenomes, seedEmptyPopulations } from '../../../src/alienclaw/governance/common/sync/pull.js';

let root: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'alienclaw-pull-shape-'));
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
});

/** Install a fetch stub that always answers with `body`. */
function stubFetchBody(body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof globalThis.fetch;
}

/** A well-formed response body (the control arm). */
function goodBody(): unknown {
  return {
    martian_type: 'compute',
    total_for_type: 1,
    genomes: [
      {
        genome: 'A'.repeat(256),
        fitness: 0.5,
        submission_id: 'sub_ok',
        submitted_at: '2026-01-01T00:00:00Z',
        leaderboard_name: 'ALIENBOT',
        verified: true,
      },
    ],
    unverified_genomes: [],
  };
}

const MALFORMED_BODIES: Array<[string, unknown]> = [
  ['genomes is a string', { martian_type: 'compute', total_for_type: 3, genomes: 'not-an-array' }],
  ['genomes is null', { martian_type: 'compute', total_for_type: 3, genomes: null }],
  ['genomes is missing', { martian_type: 'compute', total_for_type: 3 }],
  ['genomes is an object', { martian_type: 'compute', total_for_type: 3, genomes: { a: 1 } }],
  ['genomes is a number', { martian_type: 'compute', total_for_type: 3, genomes: 7 }],
  ['root is an array', [1, 2, 3]],
  ['root is a string', 'totally-not-an-object'],
  ['root is null', null],
];

describe('R-1475 — pull.ts response-shape guard (malformed `genomes` field)', () => {
  for (const [label, body] of MALFORMED_BODIES) {
    it(`R-1475-1 pullTopGenomes records an error and does NOT throw when ${label}`, async () => {
      stubFetchBody(body);
      const client = new NetworkAPIClient('https://api.example.test', 'k');

      let threw: unknown = undefined;
      let results: Awaited<ReturnType<typeof pullTopGenomes>> | undefined;
      try {
        results = await pullTopGenomes(client, ['compute'], root, 5);
      } catch (e) {
        threw = e;
      }

      expect(threw, `pullTopGenomes must not throw for ${label}`).toBeUndefined();
      expect(results).toHaveLength(1);
      expect(results![0]!.martianType).toBe('compute');
      expect(results![0]!.received).toBe(0);
      expect(results![0]!.written).toBe(0);
      expect(results![0]!.errors.length).toBeGreaterThan(0);
      expect(results![0]!.errors.join(' ')).toMatch(/malformed response body/i);
    });

    it(`R-1475-2 seedEmptyPopulations records an error and does NOT throw when ${label}`, async () => {
      stubFetchBody(body);
      const client = new NetworkAPIClient('https://api.example.test', 'k');

      let threw: unknown = undefined;
      let results: Awaited<ReturnType<typeof seedEmptyPopulations>> | undefined;
      try {
        results = await seedEmptyPopulations(client, ['compute'], root, 5);
      } catch (e) {
        threw = e;
      }

      expect(threw, `seedEmptyPopulations must not throw for ${label}`).toBeUndefined();
      expect(results).toHaveLength(1);
      expect(results![0]!.errors.length).toBeGreaterThan(0);
    });
  }

  it('R-1475-3 one malformed type does not abort the pull for the OTHER types', async () => {
    // 'good' is served a valid body; 'bad' is served a malformed one.
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes('martian_type=bad')) {
        return new Response(JSON.stringify({ martian_type: 'bad', genomes: 'oops', total_for_type: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(goodBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    const client = new NetworkAPIClient('https://api.example.test', 'k');
    const results = await pullTopGenomes(client, ['good', 'bad'], root, 5);

    // BOTH types must be represented in the returned array — the malformed
    // one recorded as an error, the good one processed normally.
    expect(results).toHaveLength(2);
    expect(results.map(r => r.martianType)).toEqual(['good', 'bad']);

    const good = results.find(r => r.martianType === 'good')!;
    expect(good.errors).toEqual([]);
    expect(good.received).toBe(1);

    const bad = results.find(r => r.martianType === 'bad')!;
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.written).toBe(0);
  });

  it('R-1475-4 control arm: a well-formed body is still pulled normally (no over-block)', async () => {
    stubFetchBody(goodBody());
    const client = new NetworkAPIClient('https://api.example.test', 'k');

    const [result] = await pullTopGenomes(client, ['compute'], root, 5);
    expect(result!.errors).toEqual([]);
    expect(result!.received).toBe(1);
    expect(result!.written).toBe(1);
  });
});
