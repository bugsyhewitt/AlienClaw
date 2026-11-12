/**
 * PKT-1490 — `alienclaw status` online_fitness.jsonl reader: canonical fitness
 * RANGE guard ([0.0, 1.0]).
 *
 * THE DEFECT
 * ----------
 * src/alienclaw/cli/status.ts reads `online_fitness.jsonl` and prints
 * operator-facing rows `${type}\t${count}\t${maxFitness.toFixed(4)}`. Its
 * per-entry guard (PKT-1141) is:
 *
 *     if (typeof e.martian_type !== 'string'
 *         || typeof e.fitness !== 'number'
 *         || !Number.isFinite(e.fitness)) continue;
 *
 * `Number.isFinite` is necessary but NOT sufficient: the canonical fitness
 * range is [0.0, 1.0], enforced at submission time by
 * src/alienclaw/api/validation.ts:72 ("fitness must be in [0.0, 1.0]"). An
 * out-of-range value (e.g. 1.5 or -0.3) is finite, so it survives the guard,
 * flows into `Math.max(cur.maxFitness, e.fitness)`, and is rendered VERBATIM
 * on operator stdout as e.g. `compute\t1\t1.5000` — a number the API would
 * have refused to accept in the first place. The two sister readers of the
 * SAME file already enforce the range:
 *
 *   - src/alienclaw/telemetry/telemetry-reader.ts:171-174
 *     (`parsed.fitness >= 0 && parsed.fitness <= 1`)
 *   - src/alienclaw/evolution/online_fitness.py:23-34
 *     (`return 0.0 <= f <= 1.0`)
 *
 * This reader was the only one of the three that accepted an out-of-range
 * value.
 *
 * Corrective re-author of REJECTED PKT-1369 (overmind review 2026-10-13,
 * managers/alienclaw/issues.md:35872), whose finding and fix direction were
 * upheld; this is the "higher-value pickup" the overmind named.
 *
 * BOUNDARY SEMANTICS
 * ------------------
 * The range clause is boundary-INCLUSIVE: 0.0 and 1.0 are LEGITIMATE fitness
 * values (the API accepts them — see validation.ts:72) and MUST be kept.
 * Only values strictly outside [0.0, 1.0] are dropped.
 *
 * DESIGN NOTE (PKT-1405 ground-2 shape)
 * -------------------------------------
 * No assertion in this file compares a REJECTED value against the same
 * expected string as a LEGITIMATE one. Every rejected value (1.5, -0.3, 2.0,
 * 1e308) has a distinct expected outcome from every legitimate value (0.0,
 * 0.4, 0.6, 0.87, 0.9, 1.0): the two sets never share an expected string.
 * The gate is therefore neither vacuous (a rejected value slipping through
 * would be caught by a DIFFERENT expectation than the legitimate one) nor
 * tautological (the legitimate values are not merely "whatever the code
 * happens to print"). PKT-1490-3 and PKT-1490-7 additionally pin the
 * "No fitness data found." survivor so the reader is provably alive and
 * correct when every entry is rejected — a non-vacuity check.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import { runStatus } from '../../src/alienclaw/cli/status.js';

afterEach(() => { vi.restoreAllMocks(); });

function captureStdout(): { text: () => string; lines: () => string[] } {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    text:  () => chunks.join(''),
    lines: () => chunks.join('').trimEnd().split('\n').filter(Boolean),
  };
}

/** Hand-rolled JSONL line — Node's JSON.stringify refuses Infinity (emits
 *  null) and cannot express raw tokens like `1e500`, `-0.3` or `1e308`, so the
 *  fitness token is interpolated raw into the JSON body. */
function _line(martian_type: string, fitnessToken: string, ts: string): string {
  return `{"martian_type":"${martian_type}","fitness":${fitnessToken},"ts":"${ts}"}`;
}

const TS = '2026-09-12T00:00:00Z';

describe('alienclaw status — PKT-1490 online_fitness.jsonl canonical fitness range', () => {
  it('PKT-1490-1: out-of-range fitness > 1 is excluded from count and max', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1490-'));
    const ts = TS;
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('compute', '0.6', ts),
        _line('compute', '1.5', ts),   // finite, but > 1.0 → must be dropped
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe('compute\t1\t0.6000');   // RED on pristine: 'compute\t2\t1.5000'
  });

  it('PKT-1490-2: out-of-range fitness < 0 is excluded from count and max', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1490-'));
    const ts = TS;
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('compute', '0.6', ts),
        _line('compute', '-0.3', ts),  // finite, but < 0.0 → must be dropped
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe('compute\t1\t0.6000');   // RED on pristine: 'compute\t2\t0.6000'
  });

  it('PKT-1490-3: a martian with ONLY out-of-range entries renders no row at all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1490-'));
    const ts = TS;
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('ghost', '2.0', ts),
        _line('ghost', '1.5', ts),
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const out = cap.text();

    expect(out).not.toContain('ghost');
    // Non-vacuity: the reader is alive and correct — nothing survived, so the
    // CLI reports the empty-state line instead of a bogus row.
    expect(out.trim()).toBe('No fitness data found.');   // RED on pristine: 'ghost\t2\t2.0000'
  });

  it('PKT-1490-4: fitness 0.0 (lower boundary, in range) is KEPT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1490-'));
    const ts = TS;
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('compute', '0.0', ts),
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe('compute\t1\t0.0000');
  });

  it('PKT-1490-5: fitness 1.0 (upper boundary, in range) is KEPT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1490-'));
    const ts = TS;
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('compute', '1', ts),
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe('compute\t1\t1.0000');
  });

  it('PKT-1490-6: an in-range interior value (0.87) is KEPT verbatim', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1490-'));
    const ts = TS;
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('compute', '0.87', ts),
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe('compute\t1\t0.8700');
  });

  it('PKT-1490-7: a large finite value (1e308) is rejected by the RANGE clause', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1490-'));
    const ts = TS;
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('a', '1e308', ts),   // finite (isFinite === true) but > 1.0 → RANGE clause rejects
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const out = cap.text();

    expect(out).not.toContain('1e+308');
    // Non-vacuity: the reader is alive and correct — nothing survived.
    expect(out.trim()).toBe('No fitness data found.');   // RED on pristine: 'a\t1\t1e+308'
  });

  it('PKT-1490-8 CONTROL: in-range entries are counted and maxed unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-pkt-1490-'));
    const ts = TS;
    writeFileSync(join(dir, 'online_fitness.jsonl'),
      [
        _line('compute', '0.4', ts),
        _line('compute', '0.9', ts),
      ].join('\n') + '\n',
    );

    const cap = captureStdout();
    await runStatus(dir);
    const rows = cap.lines();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe('compute\t2\t0.9000');
  });
});
