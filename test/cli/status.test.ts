/**
 * PKT-1034: alienclaw status — live-fitness trends per martian_type.
 * Tests A-001 through A-005.
 * RED on origin/main: status.ts does not exist → ERR_MODULE_NOT_FOUND at collection.
 * GREEN after fix: all 5 pass.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import { parseCliArgs } from '../../src/alienclaw/cli/args.js';
import { runStatus }    from '../../src/alienclaw/cli/status.js';

afterEach(() => { vi.restoreAllMocks(); });

function captureStdout(): { lines: () => string[] } {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return { lines: () => chunks.join('').trimEnd().split('\n').filter(Boolean) };
}

describe('alienclaw status', () => {
  it('A-001: parseCliArgs routes "status" to type:status', () => {
    expect(parseCliArgs(['status']).type).toBe('status');
  });

  it('A-002: prints 2 rows for a 2-martian fixture (live-summary + online data)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-status-'));
    writeFileSync(join(dir, 'live-fitness-summary.json'), JSON.stringify({
      generated_at: '2026-09-05T00:00:00Z',
      martians: [
        { id: 'compute', fitness: 0.9 },
        { id: 'web',     fitness: 0.6 },
      ],
    }));
    const ts = '2026-09-05T00:00:00Z';
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        JSON.stringify({ martian_type: 'compute', fitness: 0.8, ts }),
        JSON.stringify({ martian_type: 'compute', fitness: 0.9, ts }),
        JSON.stringify({ martian_type: 'web',     fitness: 0.6, ts }),
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();

    expect(rows).toHaveLength(2);
    const r0 = rows[0]!.split('\t');
    expect(r0[0]).toBe('compute');
    expect(r0[1]).toBe('2');
    expect(r0[2]).toContain('0.9');

    const r1 = rows[1]!.split('\t');
    expect(r1[0]).toBe('web');
    expect(r1[1]).toBe('1');
    expect(r1[2]).toContain('0.6');
  });

  it('A-003: prints "No fitness data found." when no files exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-status-'));
    const cap = captureStdout();
    await runStatus(dir);
    expect(cap.lines().join('')).toContain('No fitness data found');
  });

  it('A-004: shows online-only martian when no summary exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-status-'));
    const ts = '2026-09-05T00:00:00Z';
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        JSON.stringify({ martian_type: 'bench', fitness: 0.75, ts }),
        JSON.stringify({ martian_type: 'bench', fitness: 0.80, ts }),
      ].join('\n') + '\n',
    );
    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();
    expect(rows).toHaveLength(1);
    const r0 = rows[0]!.split('\t');
    expect(r0[0]).toBe('bench');
    expect(r0[1]).toBe('2');
    expect(r0[2]).toContain('0.8');
  });

  it('A-005: summary-only (no online log) shows count=0 with summary fitness', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-status-'));
    writeFileSync(join(dir, 'live-fitness-summary.json'), JSON.stringify({
      generated_at: '2026-09-05T00:00:00Z',
      martians: [{ id: 'compute', fitness: 0.9 }],
    }));
    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();
    expect(rows).toHaveLength(1);
    const r0 = rows[0]!.split('\t');
    expect(r0[0]).toBe('compute');
    expect(r0[1]).toBe('0');
    expect(r0[2]).toContain('0.9');
  });


// PKT-1141 — Number.isFinite guard on JSONL-parsed fitness (defense-in-depth,
// mirrors cli/runs.ts:55, cli/show.ts:34, telemetry-reader.ts:136 (PKT-589),
// sync/local-population.ts:51 (PKT-654), and ~12 other sites). The
// `typeof === 'number'` check alone is not sufficient: JSON.parse silently
// coerces `1e500` (valid JSON syntax) to Infinity, which poisons
// Math.max(cur.maxFitness, Infinity) permanently for that martian_type, and
// Infinity.toFixed(4) returns the 8-char string "Infinity" instead of a
// 4-char decimal.

/** Hand-rolled JSONL line — Node's JSON.stringify refuses Infinity and emits null,
 *  so a hand-edited / Python-emitted (allow_nan=True) JSONL file is the realistic
 *  vector. */
function _line(martian_type: string, fitnessToken: string, ts: string): string {
  return `{"martian_type":"${martian_type}","fitness":${fitnessToken},"ts":"${ts}"}`;
}

describe('alienclaw status — PKT-1141 JSONL Number.isFinite guard', () => {
  it('B-1141-A: 1e500 in JSONL poisons maxFitness → RED on pristine, GREEN with guard', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1141-'));
    const ts = '2026-09-12T00:00:00Z';
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('compute', '0.5',  ts),
        _line('compute', '1e500', ts),  // valid JSON syntax → Infinity
        _line('compute', '0.9',  ts),
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();
    expect(rows).toHaveLength(1);
    const cells = rows[0]!.split('\t');
    expect(cells[2]).toBe('0.9000');              // RED on pristine (poison shows "Infinity")
    expect(cells[2]).not.toContain('Infinity');
  });

  it('B-1141-B: -1e500 (=-Infinity) is also rejected — no poison', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1141-'));
    const ts = '2026-09-12T00:00:00Z';
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('web', '0.7',    ts),
        _line('web', '-1e500', ts),
        _line('web', '0.8',    ts),
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();
    expect(rows).toHaveLength(1);
    const cells = rows[0]!.split('\t');
    expect(cells[2]).toBe('0.8000');              // RED on pristine
    expect(cells[2]).not.toContain('Infinity');
  });

  it('B-1141-C: poisoned line is dropped from count entirely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1141-'));
    const ts = '2026-09-12T00:00:00Z';
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('compute', '0.5',    ts),
        _line('compute', '1e500',  ts),  // → Infinity, must be skipped
        _line('compute', '-1e500', ts),  // → -Infinity, must be skipped
        _line('compute', '0.7',    ts),
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();
    expect(rows).toHaveLength(1);
    const cells = rows[0]!.split('\t');
    expect(cells[1]).toBe('2');                   // only 2 well-formed counted (RED on pristine = 4)
    expect(cells[2]).toBe('0.7000');              // max is 0.7 not Infinity
  });

  it('B-1141-D: well-formed entries still produce correct maxFitness (regression guard)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1141-'));
    const ts = '2026-09-12T00:00:00Z';
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('bench', '0.5', ts),
        _line('bench', '0.9', ts),
        _line('bench', '0.8', ts),
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();
    expect(rows).toHaveLength(1);
    const cells = rows[0]!.split('\t');
    expect(cells[0]).toBe('bench');
    expect(cells[1]).toBe('3');
    expect(cells[2]).toBe('0.9000');
  });

  it('B-1141-E: 1e308 (finite, large) survives; 1e500 (overflow) rejected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1141-'));
    const ts = '2026-09-12T00:00:00Z';
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('a', '1e308', ts),   // finite, large → accepted
        _line('a', '1e500', ts),   // overflow → Infinity, rejected
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();
    expect(rows).toHaveLength(1);
    const cells = rows[0]!.split('\t');
    expect(cells[1]).toBe('1');                   // only 1e308 counted
    expect(cells[2]).not.toContain('Infinity');   // 1e308 is finite, so toFixed gives a number
    // (1e308).toFixed(4) returns "1e+308" in scientific notation — proves
    // the guard accepted it (Number.isFinite(1e308) === true) without
    // collapsing to Infinity. Direct check via parseFloat:
    expect(Number.isFinite(parseFloat(cells[2]!))).toBe(true);
    expect(parseFloat(cells[2]!)).toBeGreaterThan(1e307);  // confirms the 1e308 value
  });
});
});
