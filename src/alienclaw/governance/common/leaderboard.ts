/**
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

// ── Constants ──────────────────────────────────────────────────────────────

const LEADERBOARD_NAME_RE = /^[A-Z]{8}$/;
const MAX_RESPONSE_BYTES = 256 * 1024;   // 256 KB — reject oversized responses
const FETCH_TIMEOUT_MS   = 10_000;       // 10 s

// ── Types ─────────────────────────────────────────────────────────────────

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
  genome_hash:      string;
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
}

interface LeaderboardResponse {
  martian_type: string;
  genomes:      LeaderboardEntry[];
  total_for_type: number;
}

// ── URL pinning (transport-side trust defense) ─────────────────────────────

export const ALLOWED_LEADERBOARD_HOSTS = new Set(['api.alienclaw.net']);

export function assertPinnedUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw new TypeError(`refusing malformed URL: ${(e as Error).message}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`refusing non-https: ${url}`);
  }
  if (!ALLOWED_LEADERBOARD_HOSTS.has(parsed.hostname)) {
    throw new Error(`refusing off-allowlist host: ${parsed.hostname}`);
  }
}

// ── Hardened fetch ─────────────────────────────────────────────────────────

export async function hardenedFetch(
  url: string,
  opts: { timeoutMs?: number; maxResponseBytes?: number } = {}
): Promise<string> {
  assertPinnedUrl(url);
  const timeoutMs       = opts.timeoutMs       ?? FETCH_TIMEOUT_MS;
  const maxResponseBytes = opts.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
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
    return new TextDecoder().decode(
      chunks.reduce((acc, c) => {
        const merged = new Uint8Array(acc.length + c.length);
        merged.set(acc);
        merged.set(c, acc.length);
        return merged;
      }, new Uint8Array(0))
    );
  } finally {
    clearTimeout(timer);
  }
}

// ── Strict response validation ─────────────────────────────────────────────

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
  const allowedTopLevel = new Set(['martian_type', 'genomes', 'total_for_type']);
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

  const allowedEntryFields = new Set([
    'leaderboard_name', 'fitness', 'martian_type', 'submission_id', 'submitted_at',
    'genome', 'generation',
  ]);
  const entries: LeaderboardEntry[] = obj.genomes.map((entry: unknown, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`genomes[${i}] is not an object`);
    }
    const e = entry as Record<string, unknown>;
    for (const key of Object.keys(e)) {
      if (!allowedEntryFields.has(key)) {
        throw new Error(`Unexpected field in genome entry [${i}]: ${JSON.stringify(key)}`);
      }
    }
    if (typeof e.leaderboard_name !== 'string') {
      throw new Error(`genomes[${i}].leaderboard_name must be a string`);
    }
    // Defense in depth: re-validate name constraint even though server enforces it
    if (!LEADERBOARD_NAME_RE.test(e.leaderboard_name)) {
      throw new Error(`genomes[${i}].leaderboard_name violates ^[A-Z]{8}$: ${e.leaderboard_name}`);
    }
    if (typeof e.fitness !== 'number' || e.fitness < 0 || e.fitness > 1) {
      throw new Error(`genomes[${i}].fitness must be a number in [0,1]`);
    }
    if (typeof e.martian_type !== 'string') {
      throw new Error(`genomes[${i}].martian_type must be a string`);
    }
    if (typeof e.submission_id !== 'string') {
      throw new Error(`genomes[${i}].submission_id must be a string`);
    }
    if (typeof e.submitted_at !== 'string') {
      throw new Error(`genomes[${i}].submitted_at must be a string`);
    }
    return {
      leaderboard_name: e.leaderboard_name,
      fitness:          e.fitness,
      martian_type:     e.martian_type,
      submission_id:    e.submission_id,
      submitted_at:     e.submitted_at,
    };
  });

  return { martian_type: obj.martian_type, genomes: entries, total_for_type: obj.total_for_type };
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

  // 3. COMPARE — pure data comparison
  const topFitness = board.genomes.length > 0 ? board.genomes[0].fitness : 0;
  if (operatorBest.fitness <= topFitness) {
    return;  // Operator does not hold top result — nothing to do
  }

  // 4. WRITE-FILE — the only output; file-mediated submission
  const artifact: SubmissionArtifact = {
    leaderboard_name: config.leaderboardName,
    genome_hash:      operatorBest.genomeHash,
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
  assertPinnedUrl(submitUrl);
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

  const response = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      genome:           artifact.genome_hash,
      martian_type:     artifact.martian_type,
      fitness:          artifact.fitness,
      leaderboard_name: artifact.leaderboard_name,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'error',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Submit failed (${response.status}): ${text}`);
  }

  const result = await response.json() as { rank: number; is_new_top: boolean };
  return result;
}

// ── Name validation helper (used at setup and submission) ──────────────────

export function validateLeaderboardName(name: string): boolean {
  return LEADERBOARD_NAME_RE.test(name);
}
