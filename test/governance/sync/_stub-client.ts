/**
 * Shared test doubles for the network-sync suites.
 *
 * No real network is used anywhere in these tests. Two strategies are provided:
 *
 *   1. StubClient — a hand-rolled object that satisfies the subset of the
 *      NetworkAPIClient surface that push/pull/scheduler actually call
 *      (submitGenome, topGenomes, install). Each method is script-driven via a
 *      queue of canned responses, so a single test can assert the exact
 *      sequence of calls and the order they were made in.
 *
 *   2. makeFetchResponse — a minimal Response-like object for exercising the
 *      *real* NetworkAPIClient against a stubbed global `fetch`, used by the
 *      client._parse tests where we want the genuine parsing code path.
 */

import type {
  NetworkAPIClient,
  APIResult,
  SubmitResponse,
  TopGenomesResponse,
  InstallResponse,
  GenomeEntry,
} from '../../../src/alienclaw/governance/common/sync/client.js';

// ── Result builders ──────────────────────────────────────────────────────────

export function ok<T>(status: number, data: T): APIResult<T> {
  return { ok: true, status, data };
}

export function err<T>(
  status: number,
  code: string,
  message = code,
): APIResult<T> {
  return { ok: false, status, error: { code, message } };
}

/** A 201 "new submission accepted" result. */
export function submitNew(submissionId = 'sub_new'): APIResult<SubmitResponse> {
  return ok(201, { submission_id: submissionId, rank: 1, is_new_top: true });
}

/** A 200 "duplicate, already have it" result. */
export function submitDuplicate(
  submissionId = 'sub_dup',
): APIResult<SubmitResponse> {
  return ok(200, { submission_id: submissionId, rank: 42, is_new_top: false });
}

export function rateLimited(): APIResult<SubmitResponse> {
  return err(429, 'RATE_LIMIT_EXCEEDED', 'Too many submissions');
}

export function validationError(
  code = 'VALIDATION_FAILED',
): APIResult<SubmitResponse> {
  return err(422, code, 'Genome failed validation');
}

export function makeGenomeEntry(over: Partial<GenomeEntry> = {}): GenomeEntry {
  return {
    genome: 'G'.repeat(16),
    fitness: 0.9,
    rank: 1,
    submission_id: 'sub_remote',
    martian_type: 'compute',
    ...over,
  };
}

export function topGenomes(
  martianType: string,
  entries: GenomeEntry[],
): APIResult<TopGenomesResponse> {
  return ok(200, {
    martian_type: martianType,
    genomes: entries,
    total_for_type: entries.length,
  });
}

export function installed(
  status: InstallResponse['status'] = 'registered',
): APIResult<InstallResponse> {
  return ok(200, {
    status,
    install_id: 'inst_1',
    rate_limit: { submissions_per_hour: 100 },
  });
}

// ── StubClient ───────────────────────────────────────────────────────────────

export interface SubmitCall {
  genome: string;
  martianType: string;
  fitness: number;
  leaderboardName: string;
  runMetadata: Record<string, unknown>;
}

export interface TopGenomesCall {
  martianType: string;
  n: number;
}

export interface StubClientOptions {
  /** Queue of responses returned, in order, from submitGenome(). */
  submit?: Array<APIResult<SubmitResponse>>;
  /** Default submit response once the queue is exhausted. Defaults to a 201. */
  submitDefault?: APIResult<SubmitResponse>;
  /** Map of martian_type -> topGenomes() response. */
  top?: Record<string, APIResult<TopGenomesResponse>>;
  /** Response from install(). Defaults to a registered 200. */
  install?: APIResult<InstallResponse>;
}

/**
 * A scripted, fully in-memory stand-in for NetworkAPIClient.
 *
 * Records every call it receives so tests can assert call counts, ordering,
 * and the arguments forwarded by push/pull/scheduler. It implements only the
 * methods those modules invoke; it is cast to NetworkAPIClient at the call
 * sites (the production code depends only on that narrow surface).
 */
export class StubClient {
  readonly submitCalls: SubmitCall[] = [];
  readonly topGenomesCalls: TopGenomesCall[] = [];
  readonly installCalls: string[] = [];

  private readonly submitQueue: Array<APIResult<SubmitResponse>>;
  private readonly submitDefault: APIResult<SubmitResponse>;
  private readonly topMap: Record<string, APIResult<TopGenomesResponse>>;
  private readonly installResult: APIResult<InstallResponse>;

  constructor(opts: StubClientOptions = {}) {
    this.submitQueue = [...(opts.submit ?? [])];
    this.submitDefault = opts.submitDefault ?? submitNew();
    this.topMap = opts.top ?? {};
    this.installResult = opts.install ?? installed();
  }

  async submitGenome(
    genome: string,
    martianType: string,
    fitness: number,
    leaderboardName: string,
    runMetadata: Record<string, unknown> = {},
  ): Promise<APIResult<SubmitResponse>> {
    this.submitCalls.push({ genome, martianType, fitness, leaderboardName, runMetadata });
    const next = this.submitQueue.shift();
    return next ?? this.submitDefault;
  }

  async topGenomes(
    martianType: string,
    n = 10,
  ): Promise<APIResult<TopGenomesResponse>> {
    this.topGenomesCalls.push({ martianType, n });
    return (
      this.topMap[martianType] ?? topGenomes(martianType, [])
    );
  }

  async install(machineHash: string): Promise<APIResult<InstallResponse>> {
    this.installCalls.push(machineHash);
    return this.installResult;
  }

  /** Cast helper — production code only needs this narrow surface. */
  asClient(): NetworkAPIClient {
    return this as unknown as NetworkAPIClient;
  }
}

// ── Fetch Response double (for real-client _parse tests) ─────────────────────

export interface FakeResponseInit {
  status?: number;
  ok?: boolean;
  /** Pre-parsed JSON value resolved by .json(). */
  json?: unknown;
  /** When true, .json() rejects to simulate a non-JSON body. */
  throwOnJson?: boolean;
  /** Error thrown by .json() when throwOnJson is set. */
  jsonError?: unknown;
}

/**
 * Build a minimal object that looks like a `fetch` Response to the bits of
 * NetworkAPIClient._parse that touch it: `.status`, `.ok`, and `.json()`.
 */
export function makeFetchResponse(init: FakeResponseInit): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    status,
    ok,
    async json() {
      if (init.throwOnJson) {
        throw init.jsonError ?? new SyntaxError('Unexpected token < in JSON');
      }
      return init.json;
    },
  } as unknown as Response;
}
