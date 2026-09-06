/**
 * PKT-1039: alienclaw show — print top-N genomes of a persisted population.
 * Tests A-001 through A-004.
 * RED on origin/main: show.ts does not exist → ERR_MODULE_NOT_FOUND at collection.
 * GREEN after fix: all 4 pass.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliArgs } from '../../src/alienclaw/cli/args.js';
import { runShow } from '../../src/alienclaw/cli/show.js';

afterEach(() => { vi.restoreAllMocks(); });

const G256 = (ch: string) => ch.repeat(256);

function captureStdout(): { lines: () => string[] } {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return { lines: () => chunks.join('').trimEnd().split('\n').filter(Boolean) };
}

function makeEntry(
  dir: string,
  filename: string,
  fitness: number,
  genome: string,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), JSON.stringify({
    entry_id:    filename.replace('.json', ''),
    genome,
    fitness,
    generation:  1,
    parent_ids:  [],
    run_metadata: {},
    created_at:  '2026-09-06T00:00:00Z',
  }));
}

describe('alienclaw show', () => {
  it('A-001: parseCliArgs routes "show --martian-type compute" to type:show with defaults', () => {
    const cmd = parseCliArgs(['node', 'alienclaw.mjs', 'show', '--martian-type', 'compute']);
    expect(cmd.type).toBe('show');
    if (cmd.type === 'show') {
      expect(cmd.args.martianType).toBe('compute');
      expect(cmd.args.topN).toBe(10);
    }
  });

  it('A-002: 5 entries, --top 3 → 3 rows in descending fitness order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-show-'));
    const entriesDir = join(root, 'compute', 'entries');

    makeEntry(entriesDir, 'e1.json', 0.9, G256('a'));
    makeEntry(entriesDir, 'e2.json', 0.8, G256('b'));
    makeEntry(entriesDir, 'e3.json', 0.7, G256('c'));
    makeEntry(entriesDir, 'e4.json', 0.6, G256('d'));
    makeEntry(entriesDir, 'e5.json', 0.5, G256('e'));

    const cap = captureStdout();
    const code = await runShow({ martianType: 'compute', topN: 3 }, root);
    const rows = cap.lines();

    expect(code).toBe(0);
    expect(rows).toHaveLength(3);

    const r0 = rows[0]!.split('\t');
    expect(r0[0]).toBe('1');
    expect(r0[1]).toBe('0.9000');
    expect(r0[2]).toBe(G256('a'));

    const r1 = rows[1]!.split('\t');
    expect(r1[0]).toBe('2');
    expect(r1[1]).toBe('0.8000');
    expect(r1[2]).toBe(G256('b'));

    const r2 = rows[2]!.split('\t');
    expect(r2[0]).toBe('3');
    expect(r2[1]).toBe('0.7000');
    expect(r2[2]).toBe(G256('c'));
  });

  it('A-003: fewer entries than topN → all entries printed in descending order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-show-'));
    const entriesDir = join(root, 'compute', 'entries');

    makeEntry(entriesDir, 'e1.json', 0.9, G256('a'));
    makeEntry(entriesDir, 'e2.json', 0.6, G256('d'));
    makeEntry(entriesDir, 'e3.json', 0.7, G256('c'));

    const cap = captureStdout();
    const code = await runShow({ martianType: 'compute', topN: 10 }, root);
    const rows = cap.lines();

    expect(code).toBe(0);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.split('\t')[1]).toBe('0.9000');
    expect(rows[1]!.split('\t')[1]).toBe('0.7000');
    expect(rows[2]!.split('\t')[1]).toBe('0.6000');
  });

  it('A-004: missing population dir → no output, exit 0', async () => {
    const root = join(tmpdir(), `ac-show-nonexistent-${Date.now()}`);

    const cap = captureStdout();
    const code = await runShow({ martianType: 'compute', topN: 10 }, root);

    expect(code).toBe(0);
    expect(cap.lines()).toHaveLength(0);
  });
});
