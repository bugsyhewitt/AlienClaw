/**
 * leaderboard.ts
 * CreatorBot leaderboard check — pull-only, inert-data, file-mediated.
 *
 * TRUST MODEL:
 *   Pull-only: no inbound listener. This function is called by CreatorBot on
 *   CreatorBot's own schedule. alienclaw.net cannot invoke it.
 *
 *   Inert data: every response field is type-checked and range-checked.
 *   No field is ever interpreted as a command, prompt, or code. The response
 *   is treated as hostile input until fully validated.
 *
 *   File-mediated: the only output is a JSON file on disk. Submission to the
 *   API is a SEPARATE explicit step (submitFromFile). Nothing is transmitted
 *   silently.
 *
 *   Name-constrained: leaderboard_name is ^[A-Z]{8}$ — re-validated on receipt
 *   even though the server enforces it.
 *
 * The routine does exactly four things: fetch → validate → compare → write-file.
 * It is small enough to read and verify in two minutes.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { BASE62_ALPHABET } from '../../registry/genome-codec.js';
import { LEADERBOARD_NAME_RE, validateLeaderboardName } from '../../utils.js';

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_RESPONSE_BYTES = 256 * 1024;   // 256 KB — reject oversized responses
const FETCH_TIMEOUT_MS   = 10_000;       // 10 s

// ── Types ──────────────────────────────────────────────────────────────────

export interface GenomeResult {
  genome:       string;
  genomeHash:   string;
  martianType:  string;
  fitness:      number;
}

export interface LeaderboardConfig {
  leaderboardUrl:     string;      // api.alienclaw.net/v1/genomes/top
  leaderboardName:    string;      // ^[A-Z]{8}$
  submissionFilePath: string;      // path for the local artifact
}

export interface SubmissionArtifact {
  leaderboard_name: string;
  genome:           string;   // 256-char Base62 — sent to /v1/genomes as req.genome
  genome_hash:      string;   // 64-char hex SHA-256 — kept for audit/logging only
  martian_type:     string;
  fitness:          number;
  checked_at:       string;        // ISO timestamp
}

// ── Inert-data response schema ─────────────────────────────────────────────

interface LeaderboardEntry {
  leaderboard_name: string;
  fitness:          number;
  martian_type:     string;
  submission_id:    string;
  submitted_at:     string;
  // T7 (PR #593): per-entry verification fields, emitted by
  // api/handlers/genomes.ts::formatEntry. `verified` is true iff the server
  // has a non-null verified_fitness for the row; `verified_fitness` is null
  // until the P6 verifier has run for that row.
  verified?:         boolean;
  verified_fitness?: number | null;
}

interface LeaderboardResponse {
  martian_type: string;
  genomes:      LeaderboardEntry[];
  // T7 (PR #593): the server splits the board into verified and unverified
  // rows. BOTH arrays are validated and BOTH are returned — dropping
  // unverified_genomes would silently discard the entire board whenever
  // no row has been verified yet (see the topFitness computation below).
  unverified_genomes: LeaderboardEntry[];
  total_for_type: number;
}

// ── Hardened fetch ─────────────────────────────────────────────────────────

export async function hardenedFetch(
  url: string,
  opts: { timeoutMs?: number; maxResponseBytes?: number } = {}
): Promise<string> {
  const timeoutMs       = opts.timeoutMs       ?? FETCH_TIMEOUT_MS;
  const maxResponseBytes = opts.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from leaderboard`);
    }

    // Enforce size limit — read incrementally to catch oversized responses early
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        reader.cancel();
        throw new Error(`Response exceeds ${maxResponseBytes} bytes — rejecting`);
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  } finally {
    clearTimeout(timer);
  }
}

// ── Strict response validation ─────────────────────────────────────────────

/**
 * Closed set of per-entry fields the server is allowed to send.
 *
 * T7 (PR #593) added `verified` and `verified_fitness` to the per-entry
 * shape. `genome_id` is deliberately NOT here: it exists only as an optional
 * type field (api/types.ts) and as a DB column (api/storage.ts) — the
 * handler's `formatEntry` never serialises it into the response. (This is
 * PKT-1180 BLOCKER 1: do not add `genome_id`.)
 */
const allowedEntryFields = new Set([
  'leaderboard_name', 'fitness', 'martian_type', 'submission_id', 'submitted_at',
  'genome', 'generation', 'verified', 'verified_fitness',
]);

/**
 * Validate one genome entry against the closed-set allowlist and the
 * per-field type/range checks. Shared by the `genomes` and
 * `unverified_genomes` arrays so BOTH get the identical treatment — an
 * unvalidated array would gut the inert-data guarantee for exactly the
 * field the server started emitting.
 */
function validateEntry(entry: unknown, i: number, arrayName: string, topLevelMartianType: string): LeaderboardEntry {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`${arrayName}[${i}] is not an object`);
  }
  const e = entry as Record<string, unknown>;
  for (const key of Object.keys(e)) {
    if (!allowedEntryFields.has(key)) {
      throw new Error(`Unexpected field in genome entry [${i}]: ${JSON.stringify(key)}`);
    }
  }
  if (typeof e.leaderboard_name !== 'string') {
    throw new Error(`${arrayName}[${i}].leaderboard_name must be a string`);
  }
  // Defense in depth: re-validate name constraint even though server enforces it
  if (!LEADERBOARD_NAME_RE.test(e.leaderboard_name)) {
    throw new Error(`${arrayName}[${i}].leaderboard_name violates ^[A-Z]{8}$: ${e.leaderboard_name}`);
  }
  if (typeof e.fitness !== 'number' || !Number.isFinite(e.fitness)
      || e.fitness < 0 || e.fitness > 1) {
    throw new Error(`${arrayName}[${i}].fitness must be a finite number in [0,1]`);
  }
  // The deployed server omits per-entry martian_type (the response is
  // already scoped by the top-level field); accept absent, reject non-string.
  if (e.martian_type !== undefined && typeof e.martian_type !== 'string') {
    throw new Error(`${arrayName}[${i}].martian_type must be a string when present`);
  }
  if (typeof e.submission_id !== 'string') {
    throw new Error(`${arrayName}[${i}].submission_id must be a string`);
  }
  if (typeof e.submitted_at !== 'string') {
    throw new Error(`${arrayName}[${i}].submitted_at must be a string`);
  }
  // T7: `verified` must be a boolean when present; `verified_fitness` must be
  // a finite number in [0,1] or null. Rejecting a non-finite verified_fitness
  // here keeps the topFitness computation below free of NaN.
  if (e.verified !== undefined && typeof e.verified !== 'boolean') {
    throw new Error(`${arrayName}[${i}].verified must be a boolean when present`);
  }
  if (e.verified_fitness !== undefined && e.verified_fitness !== null) {
    if (typeof e.verified_fitness !== 'number' || !Number.isFinite(e.verified_fitness)
        || e.verified_fitness < 0 || e.verified_fitness > 1) {
      throw new Error(`${arrayName}[${i}].verified_fitness must be a finite number in [0,1] or null`);
    }
  }
  return {
    leaderboard_name: e.leaderboard_name,
    fitness:          e.fitness,
    martian_type:     (e.martian_type as string | undefined) ?? topLevelMartianType,
    submission_id:    e.submission_id,
    submitted_at:     e.submitted_at,
    verified:         e.verified as boolean | undefined,
    verified_fitness: (e.verified_fitness as number | null | undefined) ?? null,
  };
}

export function validateLeaderboardResponse(raw: string): LeaderboardResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Leaderboard response is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Leaderboard response is not an object');
  }

  const obj = parsed as Record<string, unknown>;

  // Validate top-level fields — reject anything unexpected
  const allowedTopLevel = new Set(['martian_type', 'genomes', 'unverified_genomes', 'total_for_type']);
  for (const key of Object.keys(obj)) {
    if (!allowedTopLevel.has(key)) {
      throw new Error(`Unexpected field in leaderboard response: ${JSON.stringify(key)}`);
    }
  }

  if (typeof obj.martian_type !== 'string') {
    throw new Error('martian_type must be a string');
  }
  if (typeof obj.total_for_type !== 'number' || !Number.isInteger(obj.total_for_type)) {
    throw new Error('total_for_type must be an integer');
  }
  if (!Array.isArray(obj.genomes)) {
    throw new Error('genomes must be an array');
  }
  // T7: `unverified_genomes` is emitted by the server on every top-genomes
  // response. Absent is tolerated (pre-T7 servers); present must be an array.
  if (obj.unverified_genomes !== undefined && !Array.isArray(obj.unverified_genomes)) {
    throw new Error('unverified_genomes must be an array');
  }

  const topLevelMartianType = String(obj.martian_type);
  const entries: LeaderboardEntry[] = obj.genomes.map((entry: unknown, i: number) =>
    validateEntry(entry, i, 'genomes', topLevelMartianType));
  const unverifiedEntries: LeaderboardEntry[] = (obj.unverified_genomes ?? []).map(
    (entry: unknown, i: number) => validateEntry(entry, i, 'unverified_genomes', topLevelMartianType));

  return {
    martian_type: obj.martian_type,
    genomes: entries,
    unverified_genomes: unverifiedEntries,
    total_for_type: obj.total_for_type,
  };
}

// ── Main routine ───────────────────────────────────────────────────────────

/**
 * 1. Fetch the leaderboard (pull-only, hardened).
 * 2. Validate as strictly inert data.
 * 3. Compare operator's best genome against top.
 * 4. Write submission artifact if operator has top genome (file-mediated).
 *
 * Does NOT transmit anything. Submission is a separate explicit step.
 */
export async function leaderboardCheck(
  operatorBest: GenomeResult,
  config: LeaderboardConfig,
): Promise<void> {
  // Validate config name — defense in depth
  if (!LEADERBOARD_NAME_RE.test(config.leaderboardName)) {
    throw new Error(`leaderboardName violates ^[A-Z]{8}$: ${config.leaderboardName}`);
  }

  const url = `${config.leaderboardUrl}?martian_type=${encodeURIComponent(operatorBest.martianType)}&n=1`;

  // 1. FETCH — pull-only, timeout, size-capped
  const raw = await hardenedFetch(url);

  // 2. VALIDATE — strict schema; throws if anything is unexpected or non-inert
  const board = validateLeaderboardResponse(raw);

  // 3. COMPARE — pure data comparison.
  //
  // The board is split by the server into `genomes` (verified) and
  // `unverified_genomes` (not yet verified). The board's real top fitness is
  // the MAX over the UNION of both arrays, where a row's effective fitness is
  // `verified_fitness ?? fitness` — the same ordering the server itself uses
  // (`ORDER BY COALESCE(verified_fitness, -1) DESC, fitness DESC`, see
  // api/storage.ts::topForType).
  //
  // Looking at `genomes` ALONE is wrong: no row is ever verified until the
  // P6 verifier runs (nothing in src/ writes `verified_fitness`), so
  // `genomes` is empty on a default board and the old `board.genomes[0]` /
  // zero-fallback would report a top fitness of 0 — letting an operator at
  // 0.01 fitness "beat the top" of a board whose real top is 0.99.
  const effective = (e: LeaderboardEntry): number =>
    (typeof e.verified_fitness === 'number' && Number.isFinite(e.verified_fitness))
      ? e.verified_fitness
      : e.fitness;
  const allEntries = [...board.genomes, ...board.unverified_genomes];
  const topFitness = allEntries.reduce(
    (best, e) => Math.max(best, effective(e)),
    0,
  );
  if (operatorBest.fitness <= topFitness) {
    return;  // Operator does not hold top result — nothing to do
  }

  // 4. WRITE-FILE — the only output; file-mediated submission
  const artifact: SubmissionArtifact = {
    leaderboard_name: config.leaderboardName,
    genome:           operatorBest.genome,     // 256-char Base62 string
    genome_hash:      operatorBest.genomeHash, // 64-char hex; kept for audit
    martian_type:     operatorBest.martianType,
    fitness:          operatorBest.fitness,
    checked_at:       new Date().toISOString(),
  };
  writeFileSync(config.submissionFilePath, JSON.stringify(artifact, null, 2), 'utf8');
}

// ── Separate submission function ────────────────────────────────────────────

/**
 * Read the artifact file written by leaderboardCheck and POST it to the API.
 * This is a SEPARATE, explicit, logged step — not called by leaderboardCheck.
 */
export async function submitFromFile(
  filePath: string,
  apiKey: string,
  submitUrl: string,
): Promise<{ rank: number; is_new_top: boolean }> {
  const raw = readFileSync(filePath, 'utf8');
  let artifact: SubmissionArtifact;
  try {
    artifact = JSON.parse(raw) as SubmissionArtifact;
  } catch {
    throw new Error(`Invalid submission artifact at ${filePath}`);
  }

  if (!LEADERBOARD_NAME_RE.test(artifact.leaderboard_name)) {
    throw new Error(`Artifact leaderboard_name violates ^[A-Z]{8}$`);
  }

  // Client-side fitness validation (defense in depth — server re-validates)
  if (typeof artifact.fitness !== 'number' || !Number.isFinite(artifact.fitness)
      || artifact.fitness < 0 || artifact.fitness > 1) {
    throw new Error(
      `Artifact fitness must be a finite number in [0,1]; ` +
      `got ${typeof artifact.fitness === 'number' ? artifact.fitness : typeof artifact.fitness}`,
    );
  }

  // Client-side genome validation (defense in depth — server re-validates)
  if (typeof artifact.genome !== 'string' || artifact.genome.length !== 256) {
    throw new Error(`Artifact genome must be a 256-char Base62 string (got ${typeof artifact.genome === 'string' ? artifact.genome.length : typeof artifact.genome} chars)`);
  }
  const base62Set = new Set(BASE62_ALPHABET);
  for (const ch of artifact.genome) {
    if (!base62Set.has(ch)) {
      throw new Error(`Artifact genome contains non-Base62 character: ${JSON.stringify(ch)}`);
    }
  }

  // POST for submission — native fetch. URL is operator-configured, not genome-controlled.
  const response = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      genome:           artifact.genome,         // was: artifact.genome_hash (BUG)
      martian_type:     artifact.martian_type,
      fitness:          artifact.fitness,
      leaderboard_name: artifact.leaderboard_name,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Submit failed (${response.status}): ${text}`);
  }

  const result = await response.json() as { rank: number; is_new_top: boolean };
  return result;
}

// ── Name validation helper (used at setup and submission) ──────────────────
// Owned by utils.ts; re-exported here for existing importers.

export { validateLeaderboardName };
