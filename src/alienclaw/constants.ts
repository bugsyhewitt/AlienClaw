import { homedir } from 'node:os';

export const ALIENCLAW_PROVIDER = 'anthropic' as const;

export const ALIENCLAW_MODELS = {
  POWER: 'claude-opus-4-6',
  FAST:  'claude-haiku-4-5',
} as const;

export const TIER_A_AGENTS = ['BossBot', 'AdvisorBot', 'CreatorBot'] as const;
export type TierAAgent = typeof TIER_A_AGENTS[number];

export const AGENT_MODELS: Record<TierAAgent, typeof ALIENCLAW_MODELS[keyof typeof ALIENCLAW_MODELS]> = {
  BossBot:    ALIENCLAW_MODELS.POWER,
  AdvisorBot: ALIENCLAW_MODELS.POWER,
  CreatorBot: ALIENCLAW_MODELS.FAST,
};

export const EMPLOYEE_DEFAULT_MODEL = ALIENCLAW_MODELS.FAST;

// Genome hard invariants — 256-char Base62, 4 sections × 64 chars
// Section 0: IDENTITY   (chars 0-63)   — ID, generation, tool family
// Section 1: EXECUTION  (chars 64-127) — flow type, retry, performance
// Section 2: BEHAVIOR   (chars 128-191)— escalation policy, output contract
// Section 3: CHECKSUM   (chars 192-255)— FNV-1a over sections 0-2
export const GENOME_LENGTH        = 256;
export const GENOME_SECTION_COUNT = 4;
export const GENOME_SECTION_SIZE  = 64;

// Martian tool cap — a single Martian file may declare at most 4 tools
export const MAX_MS_TOOLS = 4;

// Martian cannot spawn other Martian (depth must stay at 0)
export const MAX_MARTIAN_DEPTH = 0;

// Report routing — only these two Tier-A agents receive Martian execution
// reports and sub-agent reports. BossBot is intentionally excluded.
export const REPORT_RECIPIENTS = ['AdvisorBot', 'CreatorBot'] as const;
export type ReportRecipient = typeof REPORT_RECIPIENTS[number];

// Report code lengths
export const MARTIAN_REPORT_LEN = 8;
export const EMPLOYEE_REPORT_LEN = 20;

// Escalation
export const MAX_STRIKE_COUNT         = 3;
export const FAILFORWARD_MAX_ATTEMPTS = 2;

// Scheduled job intervals
export const REGISTRY_HEALTH_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
export const GENOME_AUDIT_INTERVAL_MS    = 15 * 60 * 1000;  // 15 minutes

// Fitness loop
export const FITNESS_UPDATE_INTERVAL_MS       = 5 * 60 * 1000;  // 5 minutes
export const ADVISE_FROM_TELEMETRY_INTERVAL_MS  = 60 * 60 * 1000; // 1 hour
export const FITNESS_EMA_ALPHA                  = 0.3;
export const FITNESS_EVOLUTION_THRESHOLD         = 0.4;

// Lock/retry
export const LOCK_RETRY_MS   = 50;
export const LOCK_MAX_TRIES  = 10;

// Event loop tick
export const EVENT_TICK_MS   = 50;

// File read adapter — max file size (10 MB)
export const MAX_FILE_READ_BYTES = 10 * 1024 * 1024;

// Default budget extension (number of extra attempts when resuming with budget)
export const DEFAULT_BUDGET_EXTENSION  = 3;

// Domain slug max length (used in employee/specialist ID generation)
export const DOMAIN_SLUG_MAX = 6;

// CreatorBot queue capacity — oldest entries evicted when exceeded
export const CREATOR_QUEUE_MAX = 1000;

// Paths
export const ALIENCLAW_HOME = process.env['ALIENCLAW_HOME']
  ?? `${homedir()}/.alienclaw`;

export const PATHS = {
  home:        ALIENCLAW_HOME,
  workspace:   `${ALIENCLAW_HOME}/workspace`,
  config:      `${ALIENCLAW_HOME}/alienclaw.json`,
  preferences: `${ALIENCLAW_HOME}/preferences.json`,
  goals:       `${ALIENCLAW_HOME}/workspace/goals.json`,
  output:      `${ALIENCLAW_HOME}/workspace/output`,
  registry:    `${ALIENCLAW_HOME}/registry`,
  ms:          `${ALIENCLAW_HOME}/registry/ms`,
  msb:         `${ALIENCLAW_HOME}/registry/msb`,
  lineage:     `${ALIENCLAW_HOME}/registry/lineage/lineage.json`,
  telemetry:   `${ALIENCLAW_HOME}/registry/telemetry`,
} as const;
