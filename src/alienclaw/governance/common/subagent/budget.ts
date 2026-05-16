/**
 * budget.ts — Layered budget enforcement for Subagent campaigns.
 *
 * Three budgets checked in order before every summon:
 * 1. wall-clock (global)
 * 2. max summons per campaign (global)
 * 3. max summons per state (per-state)
 *
 * Six termination reasons cover every exit path.
 */

export type BudgetLimits = {
  max_summons_per_campaign: number;
  max_wall_clock_seconds: number;
  max_summons_per_state: number;
};

export const DEFAULT_BUDGETS: BudgetLimits = {
  max_summons_per_campaign: 10,
  max_wall_clock_seconds: 300,
  max_summons_per_state: 3,
};

export type TerminationReason =
  | 'state_machine_finalized'
  | 'state_machine_failed'
  | 'budget_exhausted_summons'
  | 'budget_exhausted_wallclock'
  | 'budget_exhausted_per_state'
  | 'decision_rule_error';

export class BudgetTracker {
  private _totalSummons = 0;
  private _perState: Map<string, number> = new Map();

  constructor(
    private readonly limits: BudgetLimits,
    private readonly startedAt: Date,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Check if a summon for `state` is allowed. Returns null if OK, or reason if exhausted. */
  checkPreSummon(state: string): TerminationReason | null {
    // 1. Wall-clock
    const elapsedMs = this.clock().getTime() - this.startedAt.getTime();
    if (elapsedMs / 1000 >= this.limits.max_wall_clock_seconds) {
      return 'budget_exhausted_wallclock';
    }
    // 2. Global summons
    if (this._totalSummons >= this.limits.max_summons_per_campaign) {
      return 'budget_exhausted_summons';
    }
    // 3. Per-state
    const stateCount = this._perState.get(state) ?? 0;
    if (stateCount >= this.limits.max_summons_per_state) {
      return 'budget_exhausted_per_state';
    }
    return null;
  }

  /** Increment counters after a summon. */
  recordSummon(state: string): void {
    this._totalSummons++;
    this._perState.set(state, (this._perState.get(state) ?? 0) + 1);
  }

  snapshot() {
    return {
      summons_this_campaign: this._totalSummons,
      summons_per_state: Object.fromEntries(this._perState),
      wall_clock_elapsed_ms: this.clock().getTime() - this.startedAt.getTime(),
    };
  }
}
