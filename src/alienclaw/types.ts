import type { TierAAgent } from './constants.js';

// ── Config ────────────────────────────────────────────────────────────────────

export interface AlienClawConfig {
  version:     string;
  gatewayPort: number;
}

export type AdvisorPersistenceMode = 'off' | 'per_task' | 'full';
export type VerbosityMode          = 'silent' | 'normal' | 'verbose';

export interface UserPreferences {
  verbosity:          VerbosityMode;
  advisorPersistence: AdvisorPersistenceMode;
}

// ── Agent messages ────────────────────────────────────────────────────────────

export interface AgentMessage {
  from:    string;
  to:      string;
  content: string;
  ts:      number;
}

// ── Advisory ─────────────────────────────────────────────────────────────────

export interface AdviceRequest {
  requesterId: TierAAgent;
  context:     string;
  question:    string;
}

export interface AdviceResponse {
  verdict:        string;
  confidence:     'low' | 'medium' | 'high';
  blindspots:     string[];
  recommendation: string;
}

// ── AdvisorBot session (stateful per caller per task) ─────────────────────────

export interface AdvisorySession {
  callerId:  TierAAgent;
  taskId:    string;
  history:   AgentMessage[];
  createdAt: number;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export interface TaskEnvelope {
  taskId:      string;
  description: string;
  domain:      string;
  priority:    'low' | 'normal' | 'high';
  createdAt:   number;
  assignedTo?: string;
  strikeCount: number;
  attempts:    TaskAttempt[];
}

export interface TaskAttempt {
  attemptNumber:  number;
  employeeId:     string;
  failureReason:  string;
  advisorVerdict: string;
  ts:             number;
}

// ── Employees ─────────────────────────────────────────────────────────────────

export interface EmployeeSpec {
  employeeId: string;
  domain:     string;
  model:      string;
  toolTags:   string[];
  createdBy:  'CreatorBot';
  createdAt:  number;
  generation: number;
}

// ── CreatorBot queue ──────────────────────────────────────────────────────────

export type CreatorQueuePriority = 'URGENT' | 'NOTABLE';

export interface CreatorQueueItem {
  priority:    CreatorQueuePriority;
  observation: string;
  context:     string;
  ts:          number;
}

// ── Goals (Phase 2B — types defined here for forward compatibility) ───────────

export type GoalStatus = 'pending' | 'active' | 'complete' | 'failed';

export interface SubGoal {
  id:          string;
  description: string;
  domain:      string;
  status:      GoalStatus;
  dependsOn:   string[];   // other subgoal IDs that must complete first
  taskId?:     string;     // linked TaskEnvelope once assigned
}

export interface Goal {
  id:           string;
  description:  string;
  subGoals:     SubGoal[];
  status:       GoalStatus;
  createdAt:    number;
  completedAt?: number;
}

// ── Governance state (Phase 2B — defined here for forward compatibility) ──────

export type GovernanceState =
  | 'IDLE'
  | 'DECOMPOSING'
  | 'EXECUTING'
  | 'AWAITING_ADVICE'
  | 'CREATOR_BUILDING'
  | 'CREATOR_INTERRUPT'
  | 'REVIEWING_COMPLETION'
  | 'AWAITING_USER_SIGNOFF'
  | 'AWAITING_USER_INPUT'
  | 'COMPLETE'
  | 'ESCALATED';

// ── Governance hooks & events (Phase 2B) ─────────────────────────────────────

export type TransitionHook = (
  from:   GovernanceState,
  to:     GovernanceState,
  reason: string
) => void;

export type GovernanceEvent =
  | { type: 'USER_GOAL';    description: string }
  | { type: 'USER_INPUT';   message: string }
  | { type: 'JOB_COMPLETE'; subGoalId: string; goalId: string; result: TaskResult }
  | { type: 'JOB_FAILED';   subGoalId: string; goalId: string; error: string };

// ── Task results (Phase 2B) ───────────────────────────────────────────────────

export interface TaskResult {
  taskId:         string;
  employeeId:     string;
  outcome:        'SUCCESS' | 'FAILURE' | 'ESCALATED';
  summary:        string;
  failureReason?: string;
  ts:             number;
}

// ── Goals file schema (Phase 2B) ──────────────────────────────────────────────

export interface GoalsFile {
  version:      string;
  activeGoalId: string | null;
  goals:        Goal[];
}
