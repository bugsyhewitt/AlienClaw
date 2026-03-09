export const ALIENCLAW_PROVIDER = 'minimax' as const;

export const ALIENCLAW_MODELS = {
  POWER: 'MiniMax-M2.5',
  FAST:  'MiniMax-M2.5-highspeed',
} as const;

export const TIER_A_AGENTS = ['BossBot', 'AdvisorBot', 'CreatorBot'] as const;
export type TierAAgent = typeof TIER_A_AGENTS[number];

export const AGENT_MODELS: Record<TierAAgent, string> = {
  BossBot:    ALIENCLAW_MODELS.POWER,
  AdvisorBot: ALIENCLAW_MODELS.POWER,
  CreatorBot: ALIENCLAW_MODELS.FAST,
};

export const EMPLOYEE_DEFAULT_MODEL = ALIENCLAW_MODELS.FAST;

// Genome hard invariants
export const GENOME_LENGTH      = 256;
export const GENOME_BLOCK_COUNT = 8;
export const GENOME_BLOCK_SIZE  = 32;

// Report code lengths (v0.2 — not implemented yet)
export const MEESEEKS_REPORT_LEN = 8;
export const EMPLOYEE_REPORT_LEN = 20;

// Escalation
export const MAX_STRIKE_COUNT         = 3;
export const FAILFORWARD_MAX_ATTEMPTS = 2;
export const MAX_MEESEEKS_DEPTH       = 1;

// Paths
export const ALIENCLAW_HOME = process.env['ALIENCLAW_HOME']
  ?? `${process.env['HOME']}/.alienclaw`;

export const PATHS = {
  home:        ALIENCLAW_HOME,
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
