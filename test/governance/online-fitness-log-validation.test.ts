/**
 * test/governance/online-fitness-log-validation.test.ts
 *
 * Packet 485 — OnlineFitnessLog.record() input validation.
 * TDD: written BEFORE fix; tests B-001–B-005 must FAIL first, then PASS after.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync }                          from 'node:fs';
import { tmpdir }                                       from 'node:os';
import path                                             from 'node:path';

import { OnlineFitnessLog } from '../../src/alienclaw/governance/common/online-fitness-log.js';

describe('OnlineFitnessLog.record() — input validation (Packet 485)', () => {
  let tmpDir:     string;
  let fitnessLog: OnlineFitnessLog;

  beforeEach(() => {
    tmpDir     = mkdtempSync(path.join(tmpdir(), 'alienclaw-p485-'));
    fitnessLog = new OnlineFitnessLog(path.join(tmpDir, 'online_fitness.jsonl'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('B-001: rejects Infinity with RangeError', () => {
    expect(() => fitnessLog.record('compute', Infinity)).toThrow(RangeError);
  });

  it('B-002: rejects NaN with RangeError', () => {
    expect(() => fitnessLog.record('compute', NaN)).toThrow(RangeError);
  });

  it('B-003: rejects value above 1.0 with RangeError', () => {
    expect(() => fitnessLog.record('compute', 1.5)).toThrow(RangeError);
  });

  it('B-004: rejects value below 0.0 with RangeError', () => {
    expect(() => fitnessLog.record('compute', -0.5)).toThrow(RangeError);
  });

  it('B-005: accepts boundary values 0.0 and 1.0 (closed interval)', () => {
    expect(() => fitnessLog.record('compute', 0.0)).not.toThrow();
    expect(() => fitnessLog.record('compute', 1.0)).not.toThrow();
    const entries = fitnessLog.read();
    expect(entries).toHaveLength(2);
    expect(entries[0].fitness).toBe(0.0);
    expect(entries[1].fitness).toBe(1.0);
  });
});
