import type { AuditLog } from '../audit-log.js';
import type { SubmissionStore } from '../storage.js';
import type {
  GenomeEntry, SubmissionRequest, SubmissionResponse, TopGenomesResponse,
} from '../types.js';
import { validateSubmission } from '../validation.js';

export function handleSubmitGenome(opts: {
  req:             SubmissionRequest;
  apiKeyHash:      string;
  store:           SubmissionStore;
  registeredTypes: Set<string>;
  auditLog?:       AuditLog;
  clientIp?:       string;
}): [number, SubmissionResponse] {
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
  const dup = opts.store.findDuplicate({
    genome:      opts.req.genome,
    martianType: opts.req.martian_type,
    fitness:     opts.req.fitness,
    apiKeyHash:  opts.apiKeyHash,
  });
  if (dup) {
    const rank = opts.store.rankForFitness(opts.req.martian_type, opts.req.fitness);
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
      is_new_top:    opts.store.isNewTop(opts.req.martian_type, opts.req.fitness),
    }];
  }

  const isTop = opts.store.isNewTop(opts.req.martian_type, opts.req.fitness);
  const [sid, submittedAt] = opts.store.save({
    genome:          opts.req.genome,
    martianType:     opts.req.martian_type,
    fitness:         opts.req.fitness,
    apiKeyHash:      opts.apiKeyHash,
    runMetadata:     opts.req.run_metadata,
    leaderboardName: opts.req.leaderboard_name,
  });
  const rank = opts.store.rankForFitness(opts.req.martian_type, opts.req.fitness);

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

export function handleTopGenomes(opts: {
  martianType:     string;
  n:               number;
  store:           SubmissionStore;
  registeredTypes: Set<string>;
}): [number, TopGenomesResponse] {
  if (!opts.registeredTypes.has(opts.martianType)) {
    throw Object.assign(new Error('UNKNOWN_MARTIAN_TYPE'), { martianType: opts.martianType });
  }
  const n       = Math.max(1, Math.min(100, opts.n));
  const raw     = opts.store.topForType(opts.martianType, n);
  const total   = opts.store.countForType(opts.martianType);
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
