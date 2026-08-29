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
import { mkdtempSync, readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
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

    const files = readdirSync(join(root, 'compute', 'entries')).sort();
    expect(files).toEqual(['network-a.json', 'network-b.json']);
  });

  it('writes a record tagged source:network with the expected fields', async () => {
    const entry = makeGenomeEntry({
      submission_id: 'xyz',
      genome: 'NETGENOME',
      fitness: 0.42,
      generation: 5,
      submitted_at: '2026-07-01T12:00:00Z',
      leaderboard_name: 'SOMEBODY',
    });
    const client = new StubClient({ top: { compute: topGenomes('compute', [entry]) } });

    await pullTopGenomes(client.asClient(), ['compute'], root, 10);

    // Exactly the PopulationEntry shape evolution/storage.py _entry_from_dict
    // requires — a missing key there raises and poisons Population.load.
    const record = JSON.parse(
      readFileSync(join(root, 'compute', 'entries', 'network-xyz.json'), 'utf-8'),
    );
    expect(record).toEqual({
      entry_id:   'network-xyz',
      genome:     'NETGENOME',
      fitness:    0.42,
      generation: 5,
      parent_ids: [],
      run_metadata: {
        source:           'network',
        submission_id:    'xyz',
        leaderboard_name: 'SOMEBODY',
      },
      created_at: '2026-07-01T12:00:00Z',
    });
  });

  it('creates the per-type directory if it does not exist', async () => {
    const client = new StubClient({
      top: { summary: topGenomes('summary', [makeGenomeEntry({ submission_id: 's1' })]) },
    });
    expect(existsSync(join(root, 'summary'))).toBe(false);

    await pullTopGenomes(client.asClient(), ['summary'], root, 5);

    expect(existsSync(join(root, 'summary'))).toBe(true);
    expect(existsSync(join(root, 'summary', 'entries', 'network-s1.json'))).toBe(true);
  });

  it('handles an empty genome list — directory made, nothing written', async () => {
    const client = new StubClient({ top: { compute: topGenomes('compute', []) } });

    const [result] = await pullTopGenomes(client.asClient(), ['compute'], root, 10);

    expect(result.received).toBe(0);
    expect(result.written).toBe(0);
    expect(result.errors).toEqual([]);
    expect(existsSync(join(root, 'compute', 'entries'))).toBe(true);
    expect(readdirSync(join(root, 'compute', 'entries'))).toEqual([]);
  });

  it('forwards topN to the client as n', async () => {
    const client = new StubClient({ top: { compute: topGenomes('compute', []) } });
    await pullTopGenomes(client.asClient(), ['compute'], root, 3);
    expect(client.topGenomesCalls).toEqual([{ martianType: 'compute', n: 3 }]);
  });

  it('falls back to a non-empty ISO timestamp when submitted_at is empty (pull.ts:102)', async () => {
    const entry = makeGenomeEntry({
      submission_id: 'empty-ts',
      submitted_at: '',  // falsy → triggers the || fallback
    });
    const client = new StubClient({ top: { compute: topGenomes('compute', [entry]) } });

    await pullTopGenomes(client.asClient(), ['compute'], root, 10);

    const record = JSON.parse(
      readFileSync(join(root, 'compute', 'entries', 'network-empty-ts.json'), 'utf-8'),
    );
    // Fallback fires: created_at should be a valid ISO string (not empty).
    expect(record.created_at).toBeTruthy();
    expect(() => new Date(record.created_at)).not.toThrow();
    expect(record.created_at).not.toBe('');
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
    expect(existsSync(join(root, 'search', 'entries', 'network-ok1.json'))).toBe(true);
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

// ── packet 104 additions — uncovered error paths ────────────────────────────
//
// Packet 104 closes the 2 remaining uncovered error branches in pull.ts:
//   - lines 65-66: mkdirSync(..., {recursive:true}) catch (Cannot create directory)
//   - line 74:     _writeEntry writeFileSync catch (Write failed for <id>)
//
// Both are reachable with a "type is a regular file, not a dir" fixture:
// mkdirSync(join(filePath, 'child'), {recursive:true}) throws ENOTDIR
// writeFileSync(join(filePath, 'file.json'), ...)        throws ENOTDIR
//
// This is portable, deterministic, and does not require mocking node:fs
// (real fs behaves the same on Linux/macOS/WSL2 — verified by running the
// test on a tmpdir fixture, not on the project's on-disk state).

describe('pullTopGenomes — write-error resilience (packet 104)', () => {
  it('records a "Cannot create directory" error when typeDir cannot be created (parent is a file) (pull.ts:65-66)', async () => {
    // populationsRoot is a file, not a directory, so mkdirSync(typeDir, recursive:true) throws ENOTDIR.
    const fakeRoot = join(root, 'populationsRoot-is-a-file');
    writeFileSync(fakeRoot, 'I am a file masquerading as the populations root', 'utf-8');

    const client = new StubClient({
      top: { compute: topGenomes('compute', [makeGenomeEntry({ submission_id: 'x1' })]) },
    });

    const [result] = await pullTopGenomes(client.asClient(), ['compute'], fakeRoot, 10);

    expect(result.martianType).toBe('compute');
    expect(result.received).toBe(1);
    expect(result.written).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^Cannot create directory:/);
    expect(result.errors[0]).toMatch(/ENOTDIR/);
  });

  it('records a per-entry "Write failed" error when _writeEntry throws (target file is a dir) (pull.ts:74)', async () => {
    // typeDir (= populationsRoot/compute) is a real directory (so mkdirSync
    // succeeds), but we pre-create a directory at the file path that
    // _writeEntry would write to. writeFileSync on a path that's already a
    // directory throws EISDIR. pull.ts must NOT crash the whole pull — it
    // must record the per-entry error and continue with the next entry.
    const entriesDir = join(root, 'compute', 'entries');
    mkdirSync(entriesDir, { recursive: true });
    // Pre-create a directory at the filename _writeEntry will use, so the
    // writeFileSync('w') throws EISDIR (not ENOENT).
    mkdirSync(join(entriesDir, 'network-a.json'), { recursive: true });
    mkdirSync(join(entriesDir, 'network-b.json'), { recursive: true });

    const client = new StubClient({
      top: {
        compute: topGenomes('compute', [
          makeGenomeEntry({ submission_id: 'a' }),
          makeGenomeEntry({ submission_id: 'b' }),
        ]),
      },
    });

    const [result] = await pullTopGenomes(client.asClient(), ['compute'], root, 10);

    expect(result.martianType).toBe('compute');
    expect(result.received).toBe(2);
    expect(result.written).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^Write failed for a: /);
    expect(result.errors[0]).toMatch(/EISDIR/);
    expect(result.errors[1]).toMatch(/^Write failed for b: /);
    expect(result.errors[1]).toMatch(/EISDIR/);
  });

  it('mixed run: successful entries and failed entries co-exist in the same result (pull.ts:74)', async () => {
    // 'compute' is a real dir with the file path pre-empted by a directory
    // (so writes fail with EISDIR). 'good' is a normal dir with no such trap.
    const goodType = join(root, 'good', 'entries');
    mkdirSync(goodType, { recursive: true });
    const badType = join(root, 'compute', 'entries');
    mkdirSync(badType, { recursive: true });
    mkdirSync(join(badType, 'network-b1.json'), { recursive: true });

    const client = new StubClient({
      top: {
        good: topGenomes('good', [makeGenomeEntry({ submission_id: 'g1', martian_type: 'good' })]),
        compute: topGenomes('compute', [makeGenomeEntry({ submission_id: 'b1', martian_type: 'compute' })]),
      },
    });

    const results = await pullTopGenomes(client.asClient(), ['good', 'compute'], root, 10);
    const byType = Object.fromEntries(results.map(r => [r.martianType, r]));

    expect(byType['good'].written).toBe(1);
    expect(byType['good'].errors).toEqual([]);
    expect(existsSync(join(root, 'good', 'entries', 'network-g1.json'))).toBe(true);

    expect(byType['compute'].written).toBe(0);
    expect(byType['compute'].errors).toHaveLength(1);
    expect(byType['compute'].errors[0]).toMatch(/^Write failed for b1: /);
    expect(byType['compute'].errors[0]).toMatch(/EISDIR/);
  });
});
// ── PKT-906 — sync/pull._writeEntry atomicity on crash ────────────────────

describe('pullTopGenomes — _writeEntry atomicity (PKT-906)', () => {
  it('produces a complete, parse-valid JSON file (no truncation) (pull.ts:107)', async () => {
    const client = new StubClient({
      top: { compute: topGenomes('compute', [
        makeGenomeEntry({ submission_id: 'atomic-1', fitness: 0.77, generation: 4 }),
      ])},
    });
    await pullTopGenomes(client.asClient(), ['compute'], root, 10);

    const entriesDir = join(root, 'compute', 'entries');
    const files = readdirSync(entriesDir);
    expect(files).toEqual(['network-atomic-1.json']);

    const record = JSON.parse(readFileSync(join(entriesDir, 'network-atomic-1.json'), 'utf-8'));
    expect(record).toMatchObject({
      entry_id:   'network-atomic-1',
      fitness:    0.77,
      generation: 4,
      parent_ids: [],
      run_metadata: expect.objectContaining({ source: 'network', submission_id: 'atomic-1' }),
    });
    expect(typeof record.created_at).toBe('string');
    expect(typeof record.genome).toBe('string');
  });

  it('leaves zero .tmp-* leftovers in the entries dir after a successful pull (atomicity invariant)', async () => {
    const entries = [
      makeGenomeEntry({ submission_id: 'a1' }),
      makeGenomeEntry({ submission_id: 'a2' }),
      makeGenomeEntry({ submission_id: 'a3' }),
    ];
    const client = new StubClient({
      top: { compute: topGenomes('compute', entries) },
    });
    const [result] = await pullTopGenomes(client.asClient(), ['compute'], root, 10);
    expect(result.written).toBe(3);

    const entriesDir = join(root, 'compute', 'entries');
    const all = readdirSync(entriesDir);
    const tmpLeftovers = all.filter(f => f.startsWith('.tmp-'));
    expect(tmpLeftovers).toEqual([]);
    for (const f of all) {
      const raw = readFileSync(join(entriesDir, f), 'utf-8');
      expect(raw.length).toBeGreaterThan(0);
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });
});

// ── PKT-690 — fitness guard on network→disk ingestion ───────────────────────
//
// _writeEntry must reject non-finite, out-of-range, and non-numeric fitness
// values BEFORE writing to disk. Without this guard, JSON.stringify coerces
// Infinity/NaN → null, which crashes Python's float(d["fitness"]) in
// _entry_from_dict mid-loop, poisoning the entire martian_type population
// directory until the file is manually removed.

describe('pullTopGenomes — fitness validation (PKT-690)', () => {
  const BAD_FITNESS_CASES: { label: string; fitness: unknown }[] = [
    { label: 'Infinity',          fitness: Infinity },
    { label: 'NaN',               fitness: NaN },
    { label: 'string-typed',      fitness: '0.5' },
    { label: 'null-typed',        fitness: null },
    { label: 'out-of-range-high', fitness: 1.5 },
    { label: 'out-of-range-low',  fitness: -0.1 },
  ];

  for (const { label, fitness } of BAD_FITNESS_CASES) {
    it(`rejects submission with ${label} fitness before writing to disk (PKT-690)`, async () => {
      const entry = makeGenomeEntry({ submission_id: `bad-${label}`, fitness: fitness as never });
      const client = new StubClient({ top: { compute: topGenomes('compute', [entry]) } });

      const [result] = await pullTopGenomes(client.asClient(), ['compute'], root, 10);

      expect(result.received).toBe(1);
      expect(result.written).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(new RegExp(`bad-${label}`));
      expect(result.errors[0]).toMatch(/non-canonical fitness/);
      // Directory may be created, but no poisoned file must land on disk.
      const entriesDir = join(root, 'compute', 'entries');
      const files = existsSync(entriesDir) ? readdirSync(entriesDir) : [];
      expect(files).toEqual([]);
    });
  }

  it('mixed run: valid entries written, fitness-poisoned entries rejected (PKT-690)', async () => {
    const client = new StubClient({
      top: {
        compute: topGenomes('compute', [
          makeGenomeEntry({ submission_id: 'g1', fitness: 0.7 }),
          makeGenomeEntry({ submission_id: 'p1', fitness: Infinity }),
          makeGenomeEntry({ submission_id: 'g2', fitness: 0.42 }),
          makeGenomeEntry({ submission_id: 'p2', fitness: NaN }),
          makeGenomeEntry({ submission_id: 'p3', fitness: 1.5 }),
        ]),
      },
    });

    const [result] = await pullTopGenomes(client.asClient(), ['compute'], root, 10);

    expect(result.received).toBe(5);
    expect(result.written).toBe(2);   // g1 and g2 only
    expect(result.errors).toHaveLength(3);  // p1, p2, p3
    for (const id of ['p1', 'p2', 'p3']) {
      expect(result.errors.some(e => e.includes(id))).toBe(true);
    }
    expect(existsSync(join(root, 'compute', 'entries', 'network-g1.json'))).toBe(true);
    expect(existsSync(join(root, 'compute', 'entries', 'network-g2.json'))).toBe(true);
    expect(existsSync(join(root, 'compute', 'entries', 'network-p1.json'))).toBe(false);
    expect(existsSync(join(root, 'compute', 'entries', 'network-p2.json'))).toBe(false);
    expect(existsSync(join(root, 'compute', 'entries', 'network-p3.json'))).toBe(false);
  });
});

// ── PKT-561 — submission_id path-traversal rejection ────────────────────────

describe('pullTopGenomes — submission_id path-traversal rejection (PKT-561)', () => {
  const TRAVERSAL_IDS: { label: string; id: string }[] = [
    { label: 'dot-dot traversal',  id: '../../etc/passwd' },
    { label: 'empty string',       id: '' },
    { label: 'forward slash',      id: 'a/b' },
    { label: 'NUL byte',           id: 'a\x00b' },
    { label: 'over 128 chars',     id: 'x'.repeat(129) },
  ];

  for (const { label, id } of TRAVERSAL_IDS) {
    it(`rejects submission_id: ${label}`, async () => {
      const entry = makeGenomeEntry({ submission_id: id });
      const client = new StubClient({ top: { compute: topGenomes('compute', [entry]) } });
      const [result] = await pullTopGenomes(client.asClient(), ['compute'], root, 10);
      expect(result.received).toBe(1);
      expect(result.written).toBe(0);
      expect(result.errors).toHaveLength(1);
      const files = existsSync(join(root, 'compute', 'entries'))
        ? readdirSync(join(root, 'compute', 'entries'))
        : [];
      expect(files).toEqual([]);
    });
  }
});
