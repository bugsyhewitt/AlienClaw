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
  /** Scheme produced during SCHEMING phase (replaces flat SubGoal[] for new goals) */
  scheme?:      Scheme;
}

// ── Campaign / Scheme / Specialist (Phase 3 — Campaign architecture) ──────────

export type CampaignStatus = 'pending' | 'active' | 'complete' | 'failed';

/**
 * A Specialist is a campaign-scoped Employee with deep domain knowledge.
 * It is created by CreatorBot and disposed when its Campaign ends.
 * Specialists never call tools directly — they summon Martian intentionally.
 */
export interface SpecialistRole {
  /** Human-readable role label, e.g. "Frontend Developer" */
  role:         string;
  /** Domain tag used for routing and genome selection, e.g. "implementation" */
  domain:       string;
  /** Campaign-specific expertise loaded into the specialist's soul at build time */
  knowledgeBase: string;
  /** Martian tool tags this specialist is expected to summon */
  martianTags: string[];
}

/**
 * A Campaign is a cohesive unit of work within a Scheme.
 * It has its own set of specialist roles and dependency edges to other campaigns.
 * CreatorBot builds one specialist per role once the campaign becomes ready.
 */
export interface Campaign {
  id:           string;
  name:         string;
  objective:    string;
  specialists:  SpecialistRole[];
  /** IDs of other campaigns that must complete before this one can start */
  dependsOn:    string[];
  status:       CampaignStatus;
  /** Specialist Employee IDs assigned by CreatorBot after build */
  specialistIds?: string[];
}

/**
 * A Scheme is the top-level plan agreed upon by BossBot and AdvisorBot.
 * It describes all campaigns needed to fulfill a Goal.
 * CreatorBot receives the Scheme and builds specialists for each Campaign.
 */
export interface Scheme {
  goalId:              string;
  rationale:           string;
  campaigns:           Campaign[];
  /** AdvisorBot's endorsement summary */
  advisorEndorsement:  string;
  createdAt:           number;
}

// ── Governance state (Phase 2B — defined here for forward compatibility) ──────

export type GovernanceState =
  | 'IDLE'
  | 'SCHEMING'        // BossBot + AdvisorBot iterating on the Scheme
  | 'DECOMPOSING'     // legacy path / folding user input mid-execution
  | 'CREATOR_BUILDING'
  | 'EXECUTING'
  | 'AWAITING_ADVICE'
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
  | { type: 'USER_GOAL';        description: string }
  | { type: 'USER_INPUT';       message: string }
  | { type: 'CAMPAIGN_READY';   goalId: string; campaignId: string }
  | { type: 'JOB_COMPLETE';     subGoalId: string; goalId: string; result: TaskResult }
  | { type: 'JOB_FAILED';       subGoalId: string; goalId: string; error: string };

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

// ── Specialist / Martian summoning ───────────────────────────────────────────

/**
 * Result returned by a specialist after summoning a Martian.
 * Mirrors MartianExecutionResult but typed at the specialist boundary.
 */
export interface SummonResult {
  tag:       string;
  outcome:   'SUCCESS' | 'FAILURE' | 'ESCALATED';
  output?:   unknown;
  error?:    string;
  ts:        number;
}
