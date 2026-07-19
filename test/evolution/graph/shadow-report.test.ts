import { describe, it, expect } from 'vitest';
import { generateMockShadowReport } from '../../../src/alienclaw/evolution/graph/shadow-report.js';

describe('generateMockShadowReport()', () => {
  const report = generateMockShadowReport();

  it('mode is "mock"', () => {
    expect(report.mode).toBe('mock');
  });

  it('returns exactly 2 comparisons', () => {
    expect(report.comparisons).toHaveLength(2);
  });

  it('generatedAt is an ISO 8601 string', () => {
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('correctnessDelta = mean(evolved - static) = 0.02', () => {
    expect(report.summary.correctnessDelta).toBeCloseTo(0.02, 5);
  });

  it('costDelta = mean(evolvedCost - staticCost) = -0.72', () => {
    expect(report.summary.costDelta).toBeCloseTo(-0.72, 5);
  });

  it('subagentCountDelta = mean(evolved - static) = 1.0', () => {
    expect(report.summary.subagentCountDelta).toBeCloseTo(1.0, 5);
  });

  it('each comparison winner is "static" | "evolved" | "tie"', () => {
    for (const c of report.comparisons) {
      expect(['static', 'evolved', 'tie']).toContain(c.winner);
    }
  });
});
