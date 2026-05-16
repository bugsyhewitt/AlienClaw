/**
 * fitness-aggregator.test.ts — Campaign fitness math (Packet 18).
 */
import { describe, it, expect } from 'vitest';
import {
  aggregate,
  type SummonRecord,
} from '../../../src/alienclaw/governance/common/subagent/fitness_aggregator.js';

const mk = (fitness: number, ok = true): SummonRecord => ({
  state: 's', martian_type: 'm', fitness, tool_calls: 1, ok,
});

describe('aggregate()', () => {
  it('empty + finalized → 0 + 0.2 = 0.2', () => {
    const r = aggregate([], 'state_machine_finalized');
    expect(r.fitness).toBeCloseTo(0.2, 6);
    expect(r.components.completion_bonus_applied).toBe(true);
  });

  it('empty + budget_exhausted → 0', () => {
    const r = aggregate([], 'budget_exhausted_summons');
    expect(r.fitness).toBe(0.0);
    expect(r.components.completion_bonus_applied).toBe(false);
  });

  it('single(0.8) + finalized → 1.0', () => {
    const r = aggregate([mk(0.8)], 'state_machine_finalized');
    expect(r.fitness).toBeCloseTo(1.0, 6);
  });

  it('single(0.5) + finalized → 0.7', () => {
    const r = aggregate([mk(0.5)], 'state_machine_finalized');
    expect(r.fitness).toBeCloseTo(0.7, 6);
  });

  it('single(0.5) + failed → 0.5 (no bonus)', () => {
    const r = aggregate([mk(0.5)], 'state_machine_failed');
    expect(r.fitness).toBeCloseTo(0.5, 6);
  });

  it('multi-summon → uses last fitness', () => {
    const r = aggregate(
      [mk(0.1), mk(0.3), mk(0.6)],
      'state_machine_finalized',
    );
    expect(r.fitness).toBeCloseTo(0.8, 6);
  });

  it('clamps to 1.0 when sum exceeds', () => {
    const r = aggregate([mk(0.95)], 'state_machine_finalized');
    expect(r.fitness).toBe(1.0);
  });

  it('formula version is v1.0', () => {
    const r = aggregate([mk(0.5)], 'state_machine_finalized');
    expect(r.formula_version).toBe('v1.0');
  });
});
