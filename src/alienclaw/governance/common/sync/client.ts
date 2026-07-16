/**
 * AlienClaw Network API client — typed HTTP wrapper for api.alienclaw.net.
 *
 * All methods return typed response objects. Callers handle errors; this
 * client only throws on network failure or non-JSON responses.
 */

export interface InstallResponse {
  status: 'registered' | 'known';
  install_id: string;
  rate_limit: { submissions_per_hour: number };
}

export interface SubmitResponse {
  submission_id: string;
  rank: number;
  is_new_top: boolean;
}

export interface GenomeEntry {
  genome: string;
  fitness: number;
  submission_id: string;
  submitted_at: string;
  leaderboard_name: string;
  generation?: number;
  /** Not sent by the deployed server (response is scoped by top-level type). */
  martian_type?: string;
  /** Not sent by the deployed server; kept for older payloads. */
  rank?: number;
}

export interface TopGenomesResponse {
  martian_type: string;
  genomes: GenomeEntry[];
  total_for_type: number;
}

export interface MartianTypeInfo {
  name: string;
}

export interface MartianTypesResponse {
  martian_types: MartianTypeInfo[];
  total: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  uptime_seconds: number;
}

export interface APIError {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export type APIResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: APIError['error'] };


export class NetworkAPIClient {
  private readonly base: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    // Strip trailing slash for clean URL construction
    this.base = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async health(): Promise<APIResult<HealthResponse>> {
    return this._get<HealthResponse>('/v1/health');
  }

  async install(machineHash: string): Promise<APIResult<InstallResponse>> {
    return this._post<InstallResponse>('/v1/install', {
      api_key: this.apiKey,
      machine_hash: machineHash,
    });
  }

  /**
   * Submit a genome to the community leaderboard (POST /v1/genomes).
   *
   * The deployed server hard-requires `leaderboard_name` — a public
   * 8-uppercase-letter operator handle (^[A-Z]{8}$). Omitting it returns
   * 400 MISSING_FIELDS and the submission is dropped, so callers MUST supply
   * a board name. Name validity is enforced server-side; this client only
   * forwards the value it is given.
   *
   * @param genome           256-char Base62 genome string.
   * @param martianType      Registered martian type (e.g. 'compute').
   * @param fitness          Fitness in [0, 1].
   * @param leaderboardName  Public board handle, ^[A-Z]{8}$ (e.g. 'ALIENBOT').
   * @param runMetadata      Optional opaque metadata (<= 4096 bytes serialized).
   */
  async submitGenome(
    genome: string,
    martianType: string,
    fitness: number,
    leaderboardName: string,
    runMetadata: Record<string, unknown> = {},
  ): Promise<APIResult<SubmitResponse>> {
    return this._post<SubmitResponse>(
      '/v1/genomes',
      {
        genome,
        martian_type:     martianType,
        fitness,
        leaderboard_name: leaderboardName,
        run_metadata:     runMetadata,
      },
      { Authorization: `Bearer ${this.apiKey}` },
    );
  }

  async topGenomes(martianType: string, n = 10): Promise<APIResult<TopGenomesResponse>> {
    return this._get<TopGenomesResponse>(
      `/v1/genomes/top?martian_type=${encodeURIComponent(martianType)}&n=${n}`,
    );
  }

  async martianTypes(): Promise<APIResult<MartianTypesResponse>> {
    return this._get<MartianTypesResponse>('/v1/martian-types');
  }

  private async _get<T>(path: string): Promise<APIResult<T>> {
    const res = await fetch(this.base + path);
    return this._parse<T>(res);
  }

  private async _post<T>(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<APIResult<T>> {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
    return this._parse<T>(res);
  }

  private async _parse<T>(res: Response): Promise<APIResult<T>> {
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return {
        ok: false,
        status: res.status,
        error: { code: 'PARSE_ERROR', message: 'Response was not valid JSON' },
      };
    }
    if (res.ok) {
      return { ok: true, status: res.status, data: json as T };
    }
    const errBody = json as APIError;
    return {
      ok: false,
      status: res.status,
      error: errBody.error ?? { code: 'UNKNOWN_ERROR', message: String(json) },
    };
  }
}
