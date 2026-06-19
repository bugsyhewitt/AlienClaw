/**
 * HTTP server for api.alienclaw.net/v1/.
 * Uses node:http directly — no framework dependency.
 * Storage is MySQL-backed (mysql2/promise). Wired via initPool().
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse } from 'node:url';
import { hashApiKey } from './auth.js';
import { isValidApiKeyFormat } from './validation.js';
import { RateLimiter } from './rate-limit.js';
import { AuditLog } from './audit-log.js';
import { SubmissionStore, InstallStore, GlobalStats, initPool } from './storage.js';
import { handleHealth }       from './handlers/health.js';
import { handleStats }        from './handlers/stats.js';
import { handleMartianTypes } from './handlers/martian-types.js';
import { handleInstall }      from './handlers/install.js';
import { handleSubmitGenome, handleTopGenomes } from './handlers/genomes.js';
import type { SubmissionRequest, InstallRequest } from './types.js';
import { apiError } from './types.js';

// ── Global server state ────────────────────────────────────────────────────

let _RATE_LIMITER = new RateLimiter();
let _AUDIT_LOG    = new AuditLog();
let _SUBMISSION   = new SubmissionStore();
let _INSTALLS     = new InstallStore();
let _STATS        = new GlobalStats();
let _REGISTERED: Set<string> = new Set(['compute', 'http_get', 'search_text',
  'url_fetch', 'web_search', 'file_read', 'file_write', 'extract_json',
  'compute_alone', 'http_get_alone', 'search_text_alone', 'url_fetch_alone',
  'web_search_alone', 'file_read_alone', 'file_write_alone', 'extract_json_alone']);

export function configure(opts: { dbUrl?: string; dataRoot?: string } = {}): void {
  const dbUrl = opts.dbUrl ?? process.env['ALIENCLAW_DB_URL'];
  const p     = initPool(dbUrl);   // throws immediately if dbUrl is missing
  const root  = opts.dataRoot;
  _RATE_LIMITER = new RateLimiter({ dataRoot: root });
  _AUDIT_LOG    = new AuditLog({ dataRoot: root });
  _SUBMISSION   = new SubmissionStore(p);
  _INSTALLS     = new InstallStore(p);
  _STATS        = new GlobalStats(p);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: unknown, cors = false): void {
  const json = JSON.stringify(body);
  if (cors) res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(status, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function err(res: ServerResponse, status: number, code: string, message: string, details: Record<string, unknown> = {}): void {
  send(res, status, apiError(code, message, details));
}

/**
 * Read and JSON-parse a request body.
 *
 * The body's presence is decided by the bytes that *actually arrive*, never by
 * the client-supplied `Content-Length` header. A `Transfer-Encoding: chunked`
 * (or otherwise length-less) request carries no Content-Length, so trusting the
 * header would treat a perfectly valid chunked submission as an empty `{}`,
 * which then fails downstream as MISSING_FIELDS. We always consume the stream
 * and only report `{}` for a genuinely-empty payload (zero bytes received).
 *
 * Returns:
 *  - `{}` for an empty body (no bytes) — callers see "no fields", not malformed.
 *  - the parsed object for a JSON object body.
 *  - `null` for malformed input: invalid JSON, a non-object top-level value
 *    (array/primitive/`null`), or a stream error. Callers map `null` to 400.
 *
 * Note (scope): this is the *floor* — it guarantees a present body is never
 * dropped. The complementary *ceiling* (an upper bound on body size for DoS
 * hardening) is intentionally not handled here.
 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', c => { received += c.length; chunks.push(c); });
    req.on('end', () => {
      if (received === 0) { resolve({}); return; }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          resolve(null);
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

async function authBearer(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<string | null> {
  const auth = req.headers['authorization'] ?? '';
  if (!auth.startsWith('Bearer ')) {
    err(res, 401, 'UNAUTHORIZED', 'Missing or invalid Authorization header.');
    return null;
  }
  const key = auth.slice(7).trim();
  if (!isValidApiKeyFormat(key)) {
    err(res, 400, 'INVALID_API_KEY_FORMAT', 'API key must be exactly 43 Base62 characters.');
    return null;
  }
  const khash = hashApiKey(key);
  if (!(await _INSTALLS.exists(khash))) {
    err(res, 401, 'UNAUTHORIZED', 'API key not registered. Call POST /v1/install first.');
    return null;
  }
  return khash;
}

// ── Router ─────────────────────────────────────────────────────────────────

export function createApiServer(port = 8080, host = '0.0.0.0'): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (req, res) => {
    const parsed = parse(req.url ?? '/', true);
    const path   = (parsed.pathname ?? '/').replace(/\/+$/, '');
    const qs     = parsed.query;

    try {
      if (req.method === 'GET') {
        if (path === '/v1/health') {
          const [s, b] = handleHealth();
          return send(res, s, b, true);
        }
        if (path === '/v1/stats') {
          const [s, b] = await handleStats(_STATS);
          return send(res, s, b, true);
        }
        if (path === '/v1/martian-types') {
          const [s, b] = await handleMartianTypes(_REGISTERED, _SUBMISSION);
          return send(res, s, b, true);
        }
        if (path.startsWith('/v1/genomes/top') || path === '/v1/genomes/top') {
          const martianType = String(qs['martian_type'] ?? '');
          if (!martianType) return err(res, 400, 'MISSING_PARAMETER', 'martian_type query parameter is required.');
          const n = Math.max(1, Math.min(100, parseInt(String(qs['n'] ?? '10'), 10) || 10));
          try {
            const [s, b] = await handleTopGenomes({ martianType, n, store: _SUBMISSION, registeredTypes: _REGISTERED });
            return send(res, s, b, true);
          } catch (e: unknown) {
            if (e instanceof Error && 'martianType' in e) {
              return err(res, 400, 'UNKNOWN_MARTIAN_TYPE', `martian_type '${martianType}' is not registered.`,
                { available: [..._REGISTERED].sort() });
            }
            throw e;
          }
        }
        return err(res, 404, 'NOT_FOUND', `No route for ${path}`);
      }

      if (req.method === 'POST') {
        if (path === '/v1/install') {
          const body = await readJson(req);
          if (!body) return err(res, 400, 'MALFORMED_REQUEST', 'Request body must be valid JSON.');
          const missing = (['api_key', 'machine_hash'] as const).filter(f => !(f in body));
          if (missing.length) return err(res, 400, 'MISSING_FIELDS', `Missing required fields: ${JSON.stringify(missing)}`, { missing });
          try {
            const [s, b] = await handleInstall(body as unknown as InstallRequest, _INSTALLS);
            return send(res, s, b);
          } catch (e: unknown) {
            return send(res, 400, { error: JSON.parse((e as Error).message) });
          }
        }

        if (path === '/v1/genomes') {
          const khash = await authBearer(req, res);
          if (!khash) return;
          const [allowed, retryAfter] = _RATE_LIMITER.check(khash);
          if (!allowed) {
            res.setHeader('Retry-After', String(retryAfter));
            return err(res, 429, 'RATE_LIMIT_EXCEEDED',
              'Submission rate limit reached. Retry after the window resets.',
              { limit: 100, window_seconds: 3600, retry_after_seconds: retryAfter });
          }
          const body = await readJson(req);
          if (!body) return err(res, 400, 'MALFORMED_REQUEST', 'Request body must be valid JSON.');
          const missing = (['genome', 'martian_type', 'fitness', 'leaderboard_name'] as const).filter(f => !(f in body));
          if (missing.length) return err(res, 400, 'MISSING_FIELDS', `Missing required fields: ${JSON.stringify(missing)}`, { missing });
          try {
            const req2: SubmissionRequest = {
              genome:           String(body['genome'] ?? ''),
              martian_type:     String(body['martian_type'] ?? ''),
              fitness:          Number(body['fitness']),
              leaderboard_name: String(body['leaderboard_name'] ?? ''),
              run_metadata:     (body['run_metadata'] as Record<string, unknown>) ?? {},
            };
            const clientIp = req.socket.remoteAddress ?? 'unknown';
            const [s, b] = await handleSubmitGenome({
              req: req2, apiKeyHash: khash, store: _SUBMISSION,
              registeredTypes: _REGISTERED, auditLog: _AUDIT_LOG, clientIp,
            });
            return send(res, s, b);
          } catch (e: unknown) {
            if (e instanceof Error && 'apiError' in e) {
              return send(res, 422, { error: (e as {apiError: unknown}).apiError });
            }
            return err(res, 400, 'MALFORMED_REQUEST', String(e));
          }
        }

        return err(res, 404, 'NOT_FOUND', `No route for ${path}`);
      }

      res.writeHead(405).end();
    } catch (e: unknown) {
      process.stderr.write(`[api] unhandled error: ${e}\n`);
      res.writeHead(500).end('{"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}');
    }
  });

  return new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    server.listen(port, host, () => resolve(server));
    server.once('error', reject);
  });
}
