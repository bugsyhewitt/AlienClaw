import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedEmptyPopulations } from '../../../src/alienclaw/governance/common/sync/pull.js';
import {
  StubClient,
  makeGenomeEntry,
  topGenomes,
  err,
} from './_stub-client.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'alienclaw-seed-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeEntry(martianType: string, name: string): void {
  const dir = join(root, martianType, 'entries');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.json`),
    JSON.stringify({ genome: 'AAAA', fitness: 0.5, run_metadata: {} }),
    'utf-8',
  );
}

// ── A-001: empty population → 5 genomes pulled ───────────────────────────────

describe('seedEmptyPopulations — empty population is seeded from network', () => {
  it('A-001: given empty local population, pulls 5 genomes and writes them all', async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeGenomeEntry({ submission_id: `s${i}`, fitness: 0.9 - i * 0.05 }),
    );
    const client = new StubClient({ top: { compute: topGenomes('compute', entries) } });

    const result = await seedEmptyPopulations(client.asClient(), ['compute'], root, 5);

    expect(result).toHaveLength(1);
    expect(result[0]!.martianType).toBe('compute');
    expect(result[0]!.received).toBe(5);
    expect(result[0]!.written).toBe(5);
    expect(result[0]!.errors).toEqual([]);
    expect(readdirSync(join(root, 'compute', 'entries'))).toHaveLength(5);
  });
});

// ── A-002: non-empty population → no network call ────────────────────────────

describe('seedEmptyPopulations — non-empty population is skipped', () => {
  it('A-002: given an existing local entry, makes no network call', async () => {
    writeEntry('compute', 'existing');
    const client = new StubClient();

    const result = await seedEmptyPopulations(client.asClient(), ['compute'], root, 10);

    expect(client.topGenomesCalls).toHaveLength(0);
    expect(result).toHaveLength(1);
    expect(result[0]!.martianType).toBe('compute');
    expect(result[0]!.received).toBe(0);
    expect(result[0]!.written).toBe(0);
    expect(result[0]!.errors).toEqual([]);
  });
});

// ── A-003: mixed (empty + non-empty) → only empty type pulled ────────────────

describe('seedEmptyPopulations — mixed: only empty type triggers a pull', () => {
  it('A-003: compute empty → pulled; search_text populated → skipped', async () => {
    writeEntry('search_text', 'existing');
    const client = new StubClient({
      top: { compute: topGenomes('compute', [makeGenomeEntry({ submission_id: 'c1' })]) },
    });

    const result = await seedEmptyPopulations(
      client.asClient(),
      ['compute', 'search_text'],
      root,
      5,
    );

    expect(result).toHaveLength(2);
    expect(client.topGenomesCalls).toHaveLength(1);
    expect(client.topGenomesCalls[0]!.martianType).toBe('compute');
    expect(result[0]!.received).toBe(1);
    expect(result[0]!.written).toBe(1);
    expect(result[1]!.martianType).toBe('search_text');
    expect(result[1]!.received).toBe(0);
    expect(result[1]!.written).toBe(0);
  });
});

// ── A-004: empty population + API error → soft error, no crash ───────────────

describe('seedEmptyPopulations — API error on empty population is tolerated', () => {
  it('A-004: fetch failure records an error and does not throw', async () => {
    const client = new StubClient({ top: { compute: err(503, 'UNAVAILABLE') } });

    const result = await seedEmptyPopulations(client.asClient(), ['compute'], root, 5);

    expect(result).toHaveLength(1);
    expect(result[0]!.martianType).toBe('compute');
    expect(result[0]!.received).toBe(0);
    expect(result[0]!.written).toBe(0);
    expect(result[0]!.errors).toHaveLength(1);
    expect(result[0]!.errors[0]).toMatch(/Fetch failed \(503\): UNAVAILABLE/);
  });
});

// ── A-005: empty martianTypes list → empty result, no calls ─────────────────

describe('seedEmptyPopulations — empty martianTypes list', () => {
  it('A-005: returns empty array and makes no network calls', async () => {
    const client = new StubClient();
    const result = await seedEmptyPopulations(client.asClient(), [], root, 10);
    expect(result).toEqual([]);
    expect(client.topGenomesCalls).toHaveLength(0);
  });
});
