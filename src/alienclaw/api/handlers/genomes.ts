import type { AuditLog } from '../audit-log.js';
import type { SubmissionStore } from '../storage.js';
import type {
  GenomeEntry, SubmissionRequest, SubmissionResponse, TopGenomesResponse,
} from '../types.js';
import { validateSubmission } from '../validation.js';

export async function handleSubmitGenome(opts: {
  req:             SubmissionRequest;
  apiKeyHash:      string;
  store:           SubmissionStore;
  registeredTypes: Set<string>;
  auditLog?:       AuditLog;
  clientIp?:       string;
}): Promise<[number, SubmissionResponse]> {
  const v = validateSubmission(opts.req, opts.registeredTypes);
  if (!v.valid) {
    opts.auditLog?.record({
      apiKeyHash:    opts.apiKeyHash,
      martianType:   opts.req.martian_type,
      genome:        opts.req.genome,
      fitness:       opts.req.fitness,
      result:        'rejected',
      rejectionCode: v.error?.code,
      clientIp:      opts.clientIp,
    });
    throw Object.assign(new Error('validation'), { apiError: v.error });
  }

  // Duplicate suppression (24-hour window)
  const dup = await opts.store.findDuplicate({
    genome:      opts.req.genome,
    martianType: opts.req.martian_type,
    fitness:     opts.req.fitness,
    apiKeyHash:  opts.apiKeyHash,
  });
  if (dup) {
    const rank = await opts.store.rankForFitness(opts.req.martian_type, opts.req.fitness);
    opts.auditLog?.record({
      apiKeyHash:  opts.apiKeyHash,
      martianType: opts.req.martian_type,
      genome:      opts.req.genome,
      fitness:     opts.req.fitness,
      result:      'accepted',
      clientIp:    opts.clientIp,
    });
    return [200, {
      submission_id: dup.submission_id,
      submitted_at:  dup.submitted_at,
      rank,
      is_new_top:    await opts.store.isNewTop(opts.req.martian_type, opts.req.fitness),
    }];
  }

  const isTop = await opts.store.isNewTop(opts.req.martian_type, opts.req.fitness);
  const [sid, submittedAt] = await opts.store.save({
    genome:          opts.req.genome,
    martianType:     opts.req.martian_type,
    fitness:         opts.req.fitness,
    apiKeyHash:      opts.apiKeyHash,
    runMetadata:     opts.req.run_metadata,
    leaderboardName: opts.req.leaderboard_name,
  });
  const rank = await opts.store.rankForFitness(opts.req.martian_type, opts.req.fitness);

  opts.auditLog?.record({
    apiKeyHash:  opts.apiKeyHash,
    martianType: opts.req.martian_type,
    genome:      opts.req.genome,
    fitness:     opts.req.fitness,
    result:      'accepted',
    clientIp:    opts.clientIp,
  });

  return [201, { submission_id: sid, submitted_at: submittedAt, rank, is_new_top: isTop }];
}

// Default page size when the caller supplies no usable `n`.
const DEFAULT_TOP_N = 10;
// Hard cap on how many top genomes a single request may return. This is the
// single source of truth for the clamp — the HTTP router passes the raw,
// parsed `n` straight through and relies on this function to bound it.
const MAX_TOP_N = 100;

/**
 * Coerce a caller-supplied `n` into a safe integer page size in [1, MAX_TOP_N].
 *
 * This is the single authority for the top-N clamp. It tolerates the messy
 * inputs an HTTP query string can produce (NaN, Infinity, non-integers,
 * negatives, absurdly large values) and always returns an integer in range, so
 * that `storage.topForType` — which inlines the value into a SQL LIMIT — always
 * receives a value its own boundary assertion will accept.
 */
export function clampTopN(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TOP_N;
  const floored = Math.floor(n);
  return Math.max(1, Math.min(MAX_TOP_N, floored));
}

export async function handleTopGenomes(opts: {
  martianType:     string;
  n:               number;
  store:           SubmissionStore;
  registeredTypes: Set<string>;
}): Promise<[number, TopGenomesResponse]> {
  if (!opts.registeredTypes.has(opts.martianType)) {
    throw Object.assign(new Error('UNKNOWN_MARTIAN_TYPE'), { martianType: opts.martianType });
  }
  const n       = clampTopN(opts.n);
  const raw     = await opts.store.topForType(opts.martianType, n);
  const total   = await opts.store.countForType(opts.martianType);
  const entries: GenomeEntry[] = raw.map(e => ({
    genome:           e.genome,
    fitness:          e.fitness,
    submission_id:    e.submission_id,
    submitted_at:     e.submitted_at,
    leaderboard_name: e.leaderboard_name,
    generation:       typeof e.run_metadata?.['generation'] === 'number'
      ? e.run_metadata['generation'] : undefined,
  }));
  return [200, { martian_type: opts.martianType, genomes: entries, total_for_type: total }];
}
