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

  it('sparklineAscii: non-empty frontier generates sparkline characters', () => {
    const frontier = [
      { genomeId: 'g1', perInstance: new Map(), aggregate: { correctness: 0.60, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.8 }, legacyScalar: 0 },
      { genomeId: 'g2', perInstance: new Map(), aggregate: { correctness: 0.80, efficiency: 0.6, costInv: 0.6, latencyInv: 0.6, confidence: 0.9 }, legacyScalar: 0 },
      { genomeId: 'g3', perInstance: new Map(), aggregate: { correctness: 0.90, efficiency: 0.7, costInv: 0.7, latencyInv: 0.7, confidence: 0.95 }, legacyScalar: 0 },
    ];
    const out = generateShadowReport(makeRun({ frontier }), '2026-07-19');
    // sparkline body ran: no "no data" and at least one block element character
    expect(out).not.toContain('no data');
    expect(out).toMatch(/[▁▂▃▄▅▆▇█]/u);
  });

  it('sparklineAscii: uniform frontier (all same correctness) applies || 1 fallback — no NaN', () => {
    // min === max === 0.75, so max-min = 0; the || 1 guard fires → range = 1
    const uniformEntry = (id: string) => ({
      genomeId: id,
      perInstance: new Map(),
      aggregate: { correctness: 0.75, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.8 },
      legacyScalar: 0,
    });
    const frontier = [uniformEntry('g1'), uniformEntry('g2'), uniformEntry('g3')];
    const out = generateShadowReport(makeRun({ frontier }), '2026-07-21');
    // sparkline ran without NaN — all buckets are 0 (v === min), all chars are ▁
    expect(out).not.toContain('no data');
    expect(out).not.toContain('NaN');
    expect(out).toMatch(/[▁▂▃▄▅▆▇█]/u);
  });

  it('evalCountDelta ≤ 0 renders without leading plus sign', () => {
    const out = generateShadowReport(makeRun({ evalCountDelta: -5 }), '2026-07-19');
    // sign ternary on line 30 picks "" (no "+"); -5 appears literally
    expect(out).toContain('-5');
    expect(out).not.toMatch(/\+\-5/);
  });

  it('costDeltaUsd ≤ 0 renders "lower" in Flip-to-ON recommendation', () => {
    // scalar=0.70, heldOut.correctness=0.80 → delta=0.10 > 0.05 → Flip-to-ON path
    // costDeltaUsd=-0.01 → sign ternary picks "" on line 31, "lower" on line 90
    const out = generateShadowReport(makeRun({ costDeltaUsd: -0.01 }), '2026-07-19');
    expect(out).toContain('lower');
    expect(out).toContain('Flip to ON');
  });
});

// PKT-612 — sparkline non-finite input-safety guards
describe('generateShadowReport — PKT-612 sparkline input-safety guards', () => {
  function fe(id: string, correctness: number) {
    return {
      genomeId: id,
      perInstance: new Map(),
      aggregate: { correctness, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.8 },
      legacyScalar: 0,
    };
  }

  it('R-SPARK-601: frontier with one NaN produces non-▁ sparkline for the finite values', () => {
    // [0.5, NaN, 0.7, 0.8, 0.9] — finite spread should render blocks above ▁
    const frontier = [fe('g1', 0.5), fe('g2', NaN), fe('g3', 0.7), fe('g4', 0.8), fe('g5', 0.9)];
    const out = generateShadowReport(makeRun({ frontier }), '2026-08-12');
    expect(out).not.toContain('no finite data');
    expect(out).toMatch(/[▂▃▄▅▆▇█]/u);
  });

  it('R-SPARK-602: frontier with +Infinity produces non-▁ sparkline for the finite values', () => {
    // [0.5, 0.6, +Infinity, 0.8, 0.9] — Infinity makes range=Infinity, collapsing all buckets to 0
    const frontier = [fe('g1', 0.5), fe('g2', 0.6), fe('g3', Infinity), fe('g4', 0.8), fe('g5', 0.9)];
    const out = generateShadowReport(makeRun({ frontier }), '2026-08-12');
    expect(out).not.toContain('no finite data');
    expect(out).toMatch(/[▂▃▄▅▆▇█]/u);
  });

  it('R-SPARK-603: frontier with -Infinity produces non-▁ sparkline for the finite values', () => {
    // [-Infinity, 0.5, 0.6, 0.7, 0.8] — -Infinity wins min, range=Infinity, all buckets collapse
    const frontier = [fe('g1', -Infinity), fe('g2', 0.5), fe('g3', 0.6), fe('g4', 0.7), fe('g5', 0.8)];
    const out = generateShadowReport(makeRun({ frontier }), '2026-08-12');
    expect(out).not.toContain('no finite data');
    expect(out).toMatch(/[▂▃▄▅▆▇█]/u);
  });

  it('R-SPARK-604: frontier with all NaN produces "no finite data" sentinel', () => {
    // [NaN, NaN, NaN] — no finite values → distinct sentinel, not all-▁ silent corruption
    const frontier = [fe('g1', NaN), fe('g2', NaN), fe('g3', NaN)];
    const out = generateShadowReport(makeRun({ frontier }), '2026-08-12');
    expect(out).toContain('no finite data');
  });

  it('R-SPARK-605: frontier with mix of NaN and Infinity produces non-▁ sparkline for the finite values', () => {
    // [NaN, 0.5, +Infinity, 0.7, NaN, 0.9, -Infinity] — finite [0.5, 0.7, 0.9] should render blocks
    const frontier = [
      fe('g1', NaN), fe('g2', 0.5), fe('g3', Infinity),
      fe('g4', 0.7), fe('g5', NaN), fe('g6', 0.9), fe('g7', -Infinity),
    ];
    const out = generateShadowReport(makeRun({ frontier }), '2026-08-12');
    expect(out).not.toContain('no finite data');
    expect(out).toMatch(/[▂▃▄▅▆▇█]/u);
  });

  it('R-SPARK-606: large frontier (length > width) with NaN slots produces non-▁ sparkline for finite values', () => {
    // 25 entries (> width=20) with wide finite spread [0.1..0.9] and 4 NaN values interspersed.
    // The resample loop will access NaN-valued slots; safeV fallback must not collapse the sparkline.
    const entries = [];
    for (let i = 0; i < 25; i++) {
      // positions 5, 10, 15, 20 are NaN; others are finite spread 0.1..0.9
      const c = [5, 10, 15, 20].includes(i) ? NaN : 0.1 + (i / 24) * 0.8;
      entries.push(fe(`g${i}`, c));
    }
    const out = generateShadowReport(makeRun({ frontier: entries }), '2026-08-12');
    expect(out).not.toContain('no finite data');
    expect(out).toMatch(/[▂▃▄▅▆▇█]/u);
  });
});
