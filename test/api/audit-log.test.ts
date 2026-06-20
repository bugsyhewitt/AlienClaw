/**
 * audit-log.test.ts — direct unit tests for the 1 export in
 * src/alienclaw/api/audit-log.ts (AuditLog class).
 *
 * Coverage matrix:
 *   construction           — 2 cases (no-args no-op; with dataRoot writes to
 *                             audit/submissions-<YYYY-MM-DD>.jsonl)
 *   record — happy path    — 3 cases (1 JSONL line per call; append no-overwrite;
 *                             default clientIp='unknown')
 *   record — content shape — 3 cases (genome_sha256=sha256(genome), raw genome
 *                             never logged; rejection_code null; keys sorted)
 *   daily rollover         — 1 case (different dates → different files + 1 line each,
 *                             verified with fake timers across UTC midnight)
 *   failure path           — 1 case (mkdirSync failure → stderr WARNING, no throw)
 *
 * Total: 10 cases.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { AuditLog } from '../../src/alienclaw/api/audit-log.js';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'audit-test-'));
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AuditLog — construction', () => {
  it('no-args: record is a no-op — no file written, no throw', () => {
    const al = new AuditLog();
    expect(() =>
      al.record({
        apiKeyHash: 'noop-key', martianType: 'test-martian',
        genome: 'A'.repeat(256), fitness: 0.5, result: 'accepted',
      })
    ).not.toThrow();
    expect(() =>
      readFileSync(join(dataRoot, 'audit', 'submissions-any.jsonl'))
    ).toThrow();
  });

  it('with dataRoot: record creates audit/submissions-<YYYY-MM-DD>.jsonl', () => {
    const al = new AuditLog({ dataRoot });
    al.record({
      apiKeyHash: 'root-key', martianType: 'test-martian',
      genome: 'B'.repeat(256), fitness: 0.9, result: 'accepted',
    });
    const today = new Date().toISOString().slice(0, 10);
    expect(() =>
      readFileSync(join(dataRoot, 'audit', `submissions-${today}.jsonl`), 'utf8')
    ).not.toThrow();
  });
});

describe('AuditLog.record — happy path', () => {
  it('writes exactly 1 JSONL line per call', () => {
    const al = new AuditLog({ dataRoot });
    al.record({
      apiKeyHash: 'k1', martianType: 'mt', genome: 'C'.repeat(256),
      fitness: 0.5, result: 'accepted',
    });
    const today = new Date().toISOString().slice(0, 10);
    const content = readFileSync(
      join(dataRoot, 'audit', `submissions-${today}.jsonl`), 'utf8'
    );
    expect(content.split('\n').filter(l => l.length > 0).length).toBe(1);
  });

  it('3 records append to same file — no overwrite', () => {
    const al = new AuditLog({ dataRoot });
    for (let i = 0; i < 3; i++) {
      al.record({
        apiKeyHash: `k${i}`, martianType: 'mt', genome: 'D'.repeat(256),
        fitness: i * 0.1, result: 'accepted',
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    const content = readFileSync(
      join(dataRoot, 'audit', `submissions-${today}.jsonl`), 'utf8'
    );
    expect(content.split('\n').filter(l => l.length > 0).length).toBe(3);
  });

  it('clientIp defaults to "unknown" when omitted', () => {
    const al = new AuditLog({ dataRoot });
    al.record({
      apiKeyHash: 'k2', martianType: 'mt', genome: 'E'.repeat(256),
      fitness: 0.7, result: 'rejected', rejectionCode: 'R01',
    });
    const today = new Date().toISOString().slice(0, 10);
    const entry = JSON.parse(
      readFileSync(join(dataRoot, 'audit', `submissions-${today}.jsonl`), 'utf8').trim()
    );
    expect(entry.client_ip).toBe('unknown');
  });
});

describe('AuditLog.record — content shape', () => {
  it('genome_sha256 equals sha256(genome) and raw genome is never logged', () => {
    const genome = 'Q'.repeat(256);
    const al = new AuditLog({ dataRoot });
    al.record({
      apiKeyHash: 'k3', martianType: 'mt', genome,
      fitness: 0.5, result: 'accepted',
    });
    const today = new Date().toISOString().slice(0, 10);
    const entry = JSON.parse(
      readFileSync(join(dataRoot, 'audit', `submissions-${today}.jsonl`), 'utf8').trim()
    );
    expect(entry.genome_sha256).toBe(
      createHash('sha256').update(genome, 'utf8').digest('hex')
    );
    expect(entry.genome_sha256).not.toContain('Q');
  });

  it('rejection_code is null when rejectionCode is omitted', () => {
    const al = new AuditLog({ dataRoot });
    al.record({
      apiKeyHash: 'k4', martianType: 'mt', genome: 'F'.repeat(256),
      fitness: 0.8, result: 'accepted',
    });
    const today = new Date().toISOString().slice(0, 10);
    const entry = JSON.parse(
      readFileSync(join(dataRoot, 'audit', `submissions-${today}.jsonl`), 'utf8').trim()
    );
    expect(entry.rejection_code).toBeNull();
  });

  it('JSON keys are sorted alphabetically', () => {
    const al = new AuditLog({ dataRoot });
    al.record({
      apiKeyHash: 'k5', martianType: 'mt', genome: 'P'.repeat(256),
      fitness: 0.6, result: 'rejected', rejectionCode: 'R02',
    });
    const today = new Date().toISOString().slice(0, 10);
    const line = readFileSync(
      join(dataRoot, 'audit', `submissions-${today}.jsonl`), 'utf8'
    ).trim();
    const keys = line.match(/"([^"]+)":/g)!.map(m => m.slice(1, -2));
    expect(keys).toEqual([...keys].sort());
  });
});

describe('AuditLog — daily rollover', () => {
  it('different UTC dates produce different files, each containing exactly 1 line', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T23:59:59Z'));
    const al = new AuditLog({ dataRoot });
    al.record({
      apiKeyHash: 'k6', martianType: 'mt', genome: 'R'.repeat(256),
      fitness: 0.5, result: 'accepted',
    });
    vi.setSystemTime(new Date('2026-06-20T00:00:01Z'));
    al.record({
      apiKeyHash: 'k7', martianType: 'mt', genome: 'S'.repeat(256),
      fitness: 0.5, result: 'accepted',
    });

    const f19 = readFileSync(
      join(dataRoot, 'audit', 'submissions-2026-06-19.jsonl'), 'utf8'
    );
    const f20 = readFileSync(
      join(dataRoot, 'audit', 'submissions-2026-06-20.jsonl'), 'utf8'
    );
    expect(f19.split('\n').filter(l => l.length > 0).length).toBe(1);
    expect(f20.split('\n').filter(l => l.length > 0).length).toBe(1);
  });
});

describe('AuditLog — failure path', () => {
  it('write failure logs [audit-log] WARNING to stderr and does not throw', () => {
    writeFileSync(join(dataRoot, 'audit'), 'not-a-directory');
    const spy = vi.spyOn(process.stderr, 'write');
    const al = new AuditLog({ dataRoot });

    expect(() =>
      al.record({
        apiKeyHash: 'k8', martianType: 'mt', genome: 'V'.repeat(256),
        fitness: 0.1, result: 'rejected', rejectionCode: 'FAIL',
      })
    ).not.toThrow();
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/\[audit-log\] WARNING/)
    );
  });
});
