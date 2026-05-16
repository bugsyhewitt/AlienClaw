/**
 * Typed message shapes for the Packet 6 governance loop.
 *
 * Every inter-agent message has: from, to, kind, payload, correlation_id, timestamp.
 * The discriminated-union type encodes the legal (from, to, kind) combinations —
 * the compiler rejects illegal shapes at build time. The runtime guard in
 * comm-graph.ts catches any remaining violations (e.g., dynamic dispatch or any-cast).
 *
 * Canonical comm graph (from README.md):
 *   user        → BossBot     : user-goal
 *   BossBot     → AdvisorBot  : planning-consult
 *   AdvisorBot  → BossBot     : advice
 *   BossBot     → CreatorBot  : campaign-request
 *   CreatorBot  → BossBot     : campaign-report
 *   BossBot     → user        : user-response
 *   Martian     → fitness-ch. : fitness-report (exception — fitness bypasses Boss)
 */

export type Agent =
  | 'user'
  | 'BossBot'
  | 'AdvisorBot'
  | 'CreatorBot'
  | 'Martian'
  | 'fitness-channel';

// ── Message shapes ─────────────────────────────────────────────────────────

export interface UserGoalMessage {
  from:           'user';
  to:             'BossBot';
  kind:           'user-goal';
  payload:        { goal: string; constraints?: string[] };
  correlation_id: string;
  timestamp:      string;
}

export interface AdvisorConsultMessage {
  from:           'BossBot';
  to:             'AdvisorBot';
  kind:           'planning-consult';
  payload:        { draft_plan: string; question?: string };
  correlation_id: string;
  timestamp:      string;
}

export interface AdviceMessage {
  from:           'AdvisorBot';
  to:             'BossBot';
  kind:           'advice';
  payload:        { refined_plan: string; concerns?: string[] };
  correlation_id: string;
  timestamp:      string;
}

export interface CampaignRequestMessage {
  from:           'BossBot';
  to:             'CreatorBot';
  kind:           'campaign-request';
  payload: {
    campaign_id:      string;
    plan:             string;
    success_criteria: string;
    allowed_tools?:   string[];
  };
  correlation_id: string;
  timestamp:      string;
}

export interface CampaignReportMessage {
  from:           'CreatorBot';
  to:             'BossBot';
  kind:           'campaign-report';
  payload: {
    campaign_id: string;
    result:      unknown;
    summary:     string;
  };
  correlation_id: string;
  timestamp:      string;
}

export interface UserResponseMessage {
  from:           'BossBot';
  to:             'user';
  kind:           'user-response';
  payload: {
    goal:    string;
    result:  unknown;
    summary: string;
  };
  correlation_id: string;
  timestamp:      string;
}

export interface FitnessReportMessage {
  from:           'Martian';
  to:             'fitness-channel';
  kind:           'fitness-report';
  payload: {
    martian_id:    string;
    genome:        string;
    martian_type:  string;
    fitness:       number;
    run_metadata:  Record<string, unknown>;
  };
  correlation_id: string;
  timestamp:      string;
}

export type Message =
  | UserGoalMessage
  | AdvisorConsultMessage
  | AdviceMessage
  | CampaignRequestMessage
  | CampaignReportMessage
  | UserResponseMessage
  | FitnessReportMessage;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Generate a fresh RFC 4122 UUID v4 as a correlation ID. */
export function newCorrelationId(): string {
  return crypto.randomUUID();
}

/** ISO-8601 current timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}
