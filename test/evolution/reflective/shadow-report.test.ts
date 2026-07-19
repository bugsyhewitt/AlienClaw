import { describe, it, expect } from 'vitest';
import { generateShadowReport, type ShadowRunRecord } from
  '../../../src/alienclaw/evolution/reflective/shadow-report.js';

const OBJ = { correctness: 0.80, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.8 };

function makeRun(over: Partial<ShadowRunRecord> = {}): ShadowRunRecord {
  return {
    scalarLoopWinnerLegacyScalar: 0.70,
    reflectiveLoopWinnerHeldOut: OBJ,
    reflectiveLoopWinnerLegacyScalar: 0.75,
    metricCallsScalar: 100,
    metricCallsReflective: 120,
    evalCountDelta: 20,
    costDeltaUsd: 0.02,
    acceptRate: 0.45,
    frontierSize: 10,
    overfitCount: 0,
    frontier: [],
    ...over,
  };
}

describe('generateShadowReport', () => {
  it('smoke: output contains report header', () => {
    const out = generateShadowReport(makeRun(), '2026-07-18');
    expect(out).toContain('# Shadow Run Report');
  });

  it('null held-out correctness renders as N/A', () => {
    const out = generateShadowReport(makeRun({ reflectiveLoopWinnerHeldOut: null }), '2026-07-18');
    expect(out).toContain('N/A');
  });

  it('getRecommendation: overfitCount > 0 → WAIT', () => {
    const out = generateShadowReport(makeRun({ overfitCount: 2 }), '2026-07-18');
    expect(out).toContain('WAIT');
  });

  it('getRecommendation: delta > 0.05 → Flip to ON', () => {
    // scalar=0.70, heldOut.correctness=0.80 → delta=0.10 > 0.05
    const out = generateShadowReport(makeRun(), '2026-07-18');
    expect(out).toContain('Flip to ON');
  });

  it('getRecommendation: 0 < delta ≤ 0.05 → Continue shadowing', () => {
    // scalar=0.70, heldOut.correctness=0.74 → delta=0.04
    const out = generateShadowReport(
      makeRun({ reflectiveLoopWinnerHeldOut: { ...OBJ, correctness: 0.74 } }),
      '2026-07-18',
    );
    expect(out).toContain('Continue shadowing');
  });

  it('getRecommendation: delta ≤ 0 → Do not enable', () => {
    // scalar=0.90, heldOut.correctness=0.80 → delta=-0.10
    const out = generateShadowReport(
      makeRun({ scalarLoopWinnerLegacyScalar: 0.90 }),
      '2026-07-18',
    );
    expect(out).toContain('Do not enable');
  });

  it('sparklineAscii: empty frontier → "no data"', () => {
    const out = generateShadowReport(makeRun({ frontier: [] }), '2026-07-18');
    expect(out).toContain('no data');
  });
});
