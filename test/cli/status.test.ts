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

  // PKT-1142 D2: Number.isFinite hardening — Array.isArray(parsed.martians)
  // does not validate each element. A summary entry {id:'compute',
  // fitness:1e500} survives the array check and reaches .toFixed(4),
  // which returns "Infinity" — operator sees `compute\t0\tInfinity` in
  // stdout. Filter non-finite fitness and non-string id out at parse time.
  it('A-1142-A: summary entry with fitness=1e500 is dropped (no "Infinity" in stdout)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-status-'));
    writeFileSync(join(dir, 'live-fitness-summary.json'), JSON.stringify({
      generated_at: '2026-09-05T00:00:00Z',
      martians: [
        { id: 'compute', fitness: 1e500 }, // poison candidate
        { id: 'web',     fitness: 0.6 },    // well-formed
      ],
    }));
    const cap = captureStdout();
    await runStatus(dir);
    const out = cap.lines().join('');
    expect(out).not.toContain('Infinity');
    expect(out).toContain('web');
    // compute had no online entries either; with summary entry dropped,
    // there should be exactly 1 row (web) — no orphan compute row printing Infinity.
    const rows = cap.lines().filter(r => r.trim().length > 0);
    expect(rows.length).toBe(1);
  });

  it('A-1142-B: summary entry with fitness=-1e500 is dropped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-status-'));
    writeFileSync(join(dir, 'live-fitness-summary.json'), JSON.stringify({
      generated_at: '2026-09-05T00:00:00Z',
      martians: [
        { id: 'compute', fitness: -1e500 },
        { id: 'web',     fitness: 0.6 },
      ],
    }));
    const cap = captureStdout();
    await runStatus(dir);
    const out = cap.lines().join('');
    expect(out).not.toContain('Infinity');
  });

  it('A-1142-C: summary entry with non-string id is dropped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-status-'));
    writeFileSync(join(dir, 'live-fitness-summary.json'), JSON.stringify({
      generated_at: '2026-09-05T00:00:00Z',
      martians: [
        { id: 42,   fitness: 0.5 },           // id not a string → drop
        { id: 'ok', fitness: 0.7 },           // keep
      ],
    }));
    const cap = captureStdout();
    await runStatus(dir);
    const out = cap.lines().join('');
    expect(out).not.toContain('42\t');
    expect(out).toContain('ok');
  });

  it('A-1142-D: finite summary entries still render with 4-decimal formatting (regression guard)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-status-'));
    writeFileSync(join(dir, 'live-fitness-summary.json'), JSON.stringify({
      generated_at: '2026-09-05T00:00:00Z',
      martians: [{ id: 'compute', fitness: 0.9 }],
    }));
    const cap = captureStdout();
    await runStatus(dir);
    const out = cap.lines().join('');
    expect(out).toContain('compute\t0\t0.9000');
  });
});
