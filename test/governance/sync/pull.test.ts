/**
 * Tests for pullTopGenomes (src/alienclaw/governance/common/sync/pull.ts).
 *
 * Covers:
 *   - received/written counting from a topGenomes() response   pull.ts:58-76
 *   - per-type directory creation                              pull.ts:61-67
 *   - file naming + record shape (source:'network')            pull.ts:81-95
 *   - fetch-failure path records an error and writes nothing   pull.ts:53-56
 *   - multiple martian types each produce a result             pull.ts:36-41
 *   - n is forwarded to the client
 *
 * Real temp dir for writes; in-memory StubClient for the network. No I/O to
 * the actual API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pullTopGenomes } from '../../../src/alienclaw/governance/common/sync/pull.js';
import {
  StubClient,
  topGenomes,
  makeGenomeEntry,
  err,
} from './_stub-client.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'alienclaw-pull-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── happy path ───────────────────────────────────────────────────────────────

describe('pullTopGenomes — writing fetched genomes', () => {
  it('counts received and written and writes one file per genome', async () => {
    const entries = [
      makeGenomeEntry({ submission_id: 'a', rank: 1, fitness: 0.9 }),
      makeGenomeEntry({ submission_id: 'b', rank: 2, fitness: 0.8 }),
    ];
    const client = new StubClient({ top: { compute: topGenomes('compute', entries) } });

    const [result] = await pullTopGenomes(client.asClient(), ['compute'], root, 10);

    expect(result.martianType).toBe('compute');
    expect(result.received).toBe(2);
    expect(result.written).toBe(2);
    expect(result.errors).toEqual([]);

    const files = readdirSync(join(root, 'compute')).sort();
    expect(files).toEqual(['network-a.json', 'network-b.json']);
  });

  it('writes a record tagged source:network with the expected fields', async () => {
    const entry = makeGenomeEntry({
      submission_id: 'xyz',
      genome: 'NETGENOME',
      fitness: 0.42,
      rank: 7,
      martian_type: 'compute',
    });
    const client = new StubClient({ top: { compute: topGenomes('compute', [entry]) } });

    await pullTopGenomes(client.asClient(), ['compute'], root, 10);

    const record = JSON.parse(
      readFileSync(join(root, 'compute', 'network-xyz.json'), 'utf-8'),
    );
    expect(record).toEqual({
      genome: 'NETGENOME',
      fitness: 0.42,
      martian_type: 'compute',
      submission_id: 'xyz',
      source: 'network',
      rank: 7,
    });
  });

  it('creates the per-type directory if it does not exist', async () => {
    const client = new StubClient({
      top: { summary: topGenomes('summary', [makeGenomeEntry({ submission_id: 's1' })]) },
    });
    expect(existsSync(join(root, 'summary'))).toBe(false);

    await pullTopGenomes(client.asClient(), ['summary'], root, 5);

    expect(existsSync(join(root, 'summary'))).toBe(true);
    expect(existsSync(join(root, 'summary', 'network-s1.json'))).toBe(true);
  });

  it('handles an empty genome list — directory made, nothing written', async () => {
    const client = new StubClient({ top: { compute: topGenomes('compute', []) } });

    const [result] = await pullTopGenomes(client.asClient(), ['compute'], root, 10);

    expect(result.received).toBe(0);
    expect(result.written).toBe(0);
    expect(result.errors).toEqual([]);
    expect(existsSync(join(root, 'compute'))).toBe(true);
    expect(readdirSync(join(root, 'compute'))).toEqual([]);
  });

  it('forwards topN to the client as n', async () => {
    const client = new StubClient({ top: { compute: topGenomes('compute', []) } });
    await pullTopGenomes(client.asClient(), ['compute'], root, 3);
    expect(client.topGenomesCalls).toEqual([{ martianType: 'compute', n: 3 }]);
  });
});

// ── fetch failure ────────────────────────────────────────────────────────────

describe('pullTopGenomes — fetch failure', () => {
  it('records an error and writes nothing when the fetch fails', async () => {
    const client = new StubClient({
      top: { compute: err(503, 'UNAVAILABLE') },
    });

    const [result] = await pullTopGenomes(client.asClient(), ['compute'], root, 10);

    expect(result.received).toBe(0);
    expect(result.written).toBe(0);
    expect(result.errors).toEqual(['Fetch failed (503): UNAVAILABLE']);
    // No directory is created on the failure path (it returns before mkdir).
    expect(existsSync(join(root, 'compute'))).toBe(false);
  });

  it('continues to the next type after one type fails to fetch', async () => {
    const client = new StubClient({
      top: {
        compute: err(500, 'INTERNAL'),
        search: topGenomes('search', [makeGenomeEntry({ submission_id: 'ok1' })]),
      },
    });

    const results = await pullTopGenomes(client.asClient(), ['compute', 'search'], root, 10);

    const byType = Object.fromEntries(results.map(r => [r.martianType, r]));
    expect(byType['compute'].errors).toEqual(['Fetch failed (500): INTERNAL']);
    expect(byType['compute'].written).toBe(0);
    expect(byType['search'].written).toBe(1);
    expect(existsSync(join(root, 'search', 'network-ok1.json'))).toBe(true);
  });
});

// ── multiple types ───────────────────────────────────────────────────────────

describe('pullTopGenomes — multiple martian types', () => {
  it('returns one result per requested type, in order', async () => {
    const client = new StubClient({
      top: {
        compute: topGenomes('compute', [makeGenomeEntry({ submission_id: 'c1' })]),
        search_text: topGenomes('search_text', [
          makeGenomeEntry({ submission_id: 's1' }),
          makeGenomeEntry({ submission_id: 's2' }),
        ]),
      },
    });

    const results = await pullTopGenomes(
      client.asClient(),
      ['compute', 'search_text'],
      root,
      10,
    );

    expect(results.map(r => r.martianType)).toEqual(['compute', 'search_text']);
    expect(results[0].written).toBe(1);
    expect(results[1].written).toBe(2);
  });

  it('returns an empty array when no martian types are requested', async () => {
    const client = new StubClient();
    const results = await pullTopGenomes(client.asClient(), [], root, 10);
    expect(results).toEqual([]);
    expect(client.topGenomesCalls).toEqual([]);
  });
});
