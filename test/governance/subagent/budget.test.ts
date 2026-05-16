/**
 * budget.test.ts — Budget tracker semantics (Packet 18).
 */
import { describe, it, expect } from 'vitest';
import {
  BudgetTracker,
  DEFAULT_BUDGETS,
} from '../../../src/alienclaw/governance/common/subagent/budget.js';

describe('BudgetTracker', () => {
  it('default budgets allow first summon', () => {
    const t = new BudgetTracker(DEFAULT_BUDGETS, new Date());
    expect(t.checkPreSummon('s1')).toBeNull();
  });

  it('per-state limit triggers after recordSummon equal to limit', () => {
    const t = new BudgetTracker(
      { ...DEFAULT_BUDGETS, max_summons_per_state: 2 },
      new Date(),
    );
    expect(t.checkPreSummon('s1')).toBeNull();
    t.recordSummon('s1');
    expect(t.checkPreSummon('s1')).toBeNull();
    t.recordSummon('s1');
    expect(t.checkPreSummon('s1')).toBe('budget_exhausted_per_state');
  });

  it('global summons limit triggers when total reaches max', () => {
    const t = new BudgetTracker(
      { ...DEFAULT_BUDGETS, max_summons_per_campaign: 2, max_summons_per_state: 99 },
      new Date(),
    );
    t.recordSummon('s1');
    t.recordSummon('s2');
    expect(t.checkPreSummon('s3')).toBe('budget_exhausted_summons');
  });

  it('wall-clock with fake clock advances and triggers exhaustion', () => {
    let now = new Date('2026-01-01T00:00:00Z').getTime();
    const clock = () => new Date(now);
    const start = clock();
    const t = new BudgetTracker(
      { ...DEFAULT_BUDGETS, max_wall_clock_seconds: 10 },
      start,
      clock,
    );
    expect(t.checkPreSummon('s1')).toBeNull();
    now += 11_000;
    expect(t.checkPreSummon('s1')).toBe('budget_exhausted_wallclock');
  });

  it('zero per-state budget rejects first summon', () => {
    const t = new BudgetTracker(
      { ...DEFAULT_BUDGETS, max_summons_per_state: 0 },
      new Date(),
    );
    expect(t.checkPreSummon('s1')).toBe('budget_exhausted_per_state');
  });

  it('zero global budget rejects first summon', () => {
    const t = new BudgetTracker(
      { ...DEFAULT_BUDGETS, max_summons_per_campaign: 0 },
      new Date(),
    );
    expect(t.checkPreSummon('s1')).toBe('budget_exhausted_summons');
  });

  it('snapshot reflects recorded summons', () => {
    const t = new BudgetTracker(DEFAULT_BUDGETS, new Date());
    t.recordSummon('s1');
    t.recordSummon('s1');
    t.recordSummon('s2');
    const snap = t.snapshot();
    expect(snap.summons_this_campaign).toBe(3);
    expect(snap.summons_per_state['s1']).toBe(2);
    expect(snap.summons_per_state['s2']).toBe(1);
  });

  it('check ordering: wall-clock > summons > per-state', () => {
    let now = new Date('2026-01-01T00:00:00Z').getTime();
    const clock = () => new Date(now);
    const start = clock();
    const t = new BudgetTracker(
      { max_summons_per_campaign: 0, max_wall_clock_seconds: 1, max_summons_per_state: 0 },
      start,
      clock,
    );
    now += 5_000;
    expect(t.checkPreSummon('s1')).toBe('budget_exhausted_wallclock');
  });
});
