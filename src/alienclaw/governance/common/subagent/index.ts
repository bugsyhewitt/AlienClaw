export { decide } from './decision_engine.js';
export type {
  Action,
  Condition,
  ConditionGroup,
  Transition,
  State,
  TransitionTable,
  SummonResult,
  DecisionInput,
} from './decision_engine.js';
export { BudgetTracker, DEFAULT_BUDGETS } from './budget.js';
export type { BudgetLimits, TerminationReason } from './budget.js';
export { aggregate } from './fitness_aggregator.js';
export type { SummonRecord, CampaignFitness } from './fitness_aggregator.js';
export {
  parseTransitionTable,
  validateTransitionTable,
  evaluateInputs,
} from './transition_table.js';
export type {
  ParseResult,
  ValidationResult as TableValidationResult,
} from './transition_table.js';
