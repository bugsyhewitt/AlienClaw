/**
 * Request/response types for the AlienClaw community API.
 * Mirrors LEADERBOARD_API_SPEC.md v1.0 exactly.
 * TypeScript port of api/types.py (Packet 31.5).
 */

// ── Install ───────────────────────────────────────────────────────────────

export interface InstallRequest {
  api_key:      string;   // 43-char Base62
  machine_hash: string;   // 64-char hex SHA-256
}

export interface RateLimitInfo {
  submissions_per_hour: number;  // 100
  window_seconds:       number;  // 3600
}

export interface InstallResponse {
  status:     'registered' | 'known';
  install_id: string;
  rate_limit: RateLimitInfo;
}

// ── Genome submission ─────────────────────────────────────────────────────

export interface SubmissionRequest {
  genome:           string;
  martian_type:     string;
  fitness:          number;
  leaderboard_name: string;   // ^[A-Z]{8}$
  run_metadata:     Record<string, unknown>;
}

export interface SubmissionResponse {
  submission_id: string;
  submitted_at:  string;   // ISO 8601
  rank:          number;
  is_new_top:    boolean;
}

// ── Top genomes ───────────────────────────────────────────────────────────

export interface GenomeEntry {
  genome:           string;
  fitness:          number;
  submission_id:    string;
  submitted_at:     string;
  leaderboard_name: string;   // ^[A-Z]{8}$
  generation?:      number;
}

export interface TopGenomesResponse {
  martian_type:    string;
  genomes:         GenomeEntry[];
  total_for_type:  number;
}

// ── Martian types ─────────────────────────────────────────────────────────

export interface MartianTypeInfo {
  name:                string;
  current_top_fitness: number;       // evolved fitness from leaderboard DB
  submission_count:    number;
  last_submission_at:  string;
  online_fitness:      number | null; // mean runtime fitness from OnlineFitnessLog; null when no entries
}

export interface MartianTypesResponse {
  martian_types: MartianTypeInfo[];
  total:         number;
}

// ── Health ────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status:         'ok' | 'degraded';
  version:        string;
  uptime_seconds: number;
  message?:       string;
}

// ── Stats ─────────────────────────────────────────────────────────────────

export interface StatsResponse {
  total_genomes:              number;
  total_installs:             number;
  total_fitness_evaluations:  number;
  top_fitness_by_type:        Record<string, number>;
}

// ── Errors ────────────────────────────────────────────────────────────────

export interface APIError {
  code:     string;
  message:  string;
  details:  Record<string, unknown>;
}

export interface ErrorResponse {
  error: APIError;
}

export function apiError(code: string, message: string, details: Record<string, unknown> = {}): ErrorResponse {
  return { error: { code, message, details } };
}
