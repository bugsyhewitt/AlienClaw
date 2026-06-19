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

// ── CORS ───────────────────────────────────────────────────────────────────
//
// The API is consumed by browser frontends (the site/ dir and leaderboard.html)
// served from a different origin than api.alienclaw.net. Browsers therefore send
// a CORS preflight (OPTIONS) before any non-simple request — every POST to
// /v1/install and /v1/genomes, because they carry a JSON Content-Type and (for
// genomes) an Authorization header. The preflight must be answered with the
// allowed methods/headers, and the actual responses must echo the allow-origin
// header, or the browser blocks the request even though the server processed it.

const CORS_ALLOW_ORIGIN  = '*';
const CORS_ALLOW_METHODS = 'GET, POST, OPTIONS';
const CORS_ALLOW_HEADERS = 'Content-Type, Authorization';
const CORS_MAX_AGE       = '86400';   // cache preflight for 24h

/** Apply the Access-Control-Allow-Origin header. Used on every CORS-enabled response. */
function setCorsOrigin(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', CORS_ALLOW_ORIGIN);
}

/** Apply the full set of preflight CORS headers (methods, headers, max-age). */
function setCorsPreflight(res: ServerResponse): void {
  setCorsOrigin(res);
  res.setHeader('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  res.setHeader('Access-Control-Max-Age',       CORS_MAX_AGE);
}

/** Answer a CORS preflight request: 204 No Content with the full CORS header set. */
function handleOptions(res: ServerResponse): void {
  setCorsPreflight(res);
  res.writeHead(204, { 'Content-Length': '0' });
  res.end();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: unknown, cors = false): void {
  const json = JSON.stringify(body);
  if (cors) setCorsOrigin(res);
  res.writeHead(status, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function err(res: ServerResponse, status: number, code: string, message: string, details: Record<string, unknown> = {}, cors = false): void {
  send(res, status, apiError(code, message, details), cors);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const length = parseInt(req.headers['content-length'] ?? '0', 10);
  if (length === 0) return {};
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve(null); }
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
    err(res, 401, 'UNAUTHORIZED', 'Missing or invalid Authorization header.', {}, true);
    return null;
  }
  const key = auth.slice(7).trim();
  if (!isValidApiKeyFormat(key)) {
    err(res, 400, 'INVALID_API_KEY_FORMAT', 'API key must be exactly 43 Base62 characters.', {}, true);
    return null;
  }
  const khash = hashApiKey(key);
  if (!(await _INSTALLS.exists(khash))) {
    err(res, 401, 'UNAUTHORIZED', 'API key not registered. Call POST /v1/install first.', {}, true);
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
      // CORS preflight: answer OPTIONS for any route before method dispatch so
      // browser clients can complete the preflight handshake for POST routes.
      if (req.method === 'OPTIONS') {
        return handleOptions(res);
      }

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
          if (!martianType) return err(res, 400, 'MISSING_PARAMETER', 'martian_type query parameter is required.', {}, true);
          const n = Math.max(1, Math.min(100, parseInt(String(qs['n'] ?? '10'), 10) || 10));
          try {
            const [s, b] = await handleTopGenomes({ martianType, n, store: _SUBMISSION, registeredTypes: _REGISTERED });
            return send(res, s, b, true);
          } catch (e: unknown) {
            if (e instanceof Error && 'martianType' in e) {
              return err(res, 400, 'UNKNOWN_MARTIAN_TYPE', `martian_type '${martianType}' is not registered.`,
                { available: [..._REGISTERED].sort() }, true);
            }
            throw e;
          }
        }
        return err(res, 404, 'NOT_FOUND', `No route for ${path}`, {}, true);
      }

      if (req.method === 'POST') {
        // All POST responses (success and error) carry CORS headers so browser
        // clients can read them after the preflight handshake.
        if (path === '/v1/install') {
          const body = await readJson(req);
          if (!body) return err(res, 400, 'MALFORMED_REQUEST', 'Request body must be valid JSON.', {}, true);
          const missing = (['api_key', 'machine_hash'] as const).filter(f => !(f in body));
          if (missing.length) return err(res, 400, 'MISSING_FIELDS', `Missing required fields: ${JSON.stringify(missing)}`, { missing }, true);
          try {
            const [s, b] = await handleInstall(body as unknown as InstallRequest, _INSTALLS);
            return send(res, s, b, true);
          } catch (e: unknown) {
            return send(res, 400, { error: JSON.parse((e as Error).message) }, true);
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
              { limit: 100, window_seconds: 3600, retry_after_seconds: retryAfter }, true);
          }
          const body = await readJson(req);
          if (!body) return err(res, 400, 'MALFORMED_REQUEST', 'Request body must be valid JSON.', {}, true);
          const missing = (['genome', 'martian_type', 'fitness', 'leaderboard_name'] as const).filter(f => !(f in body));
          if (missing.length) return err(res, 400, 'MISSING_FIELDS', `Missing required fields: ${JSON.stringify(missing)}`, { missing }, true);
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
            return send(res, s, b, true);
          } catch (e: unknown) {
            if (e instanceof Error && 'apiError' in e) {
              return send(res, 422, { error: (e as {apiError: unknown}).apiError }, true);
            }
            return err(res, 400, 'MALFORMED_REQUEST', String(e), {}, true);
          }
        }

        return err(res, 404, 'NOT_FOUND', `No route for ${path}`, {}, true);
      }

      // Unsupported method: 405 with CORS + Allow header so browsers see a usable error.
      setCorsPreflight(res);
      res.writeHead(405, { 'Allow': CORS_ALLOW_METHODS }).end();
    } catch (e: unknown) {
      process.stderr.write(`[api] unhandled error: ${e}\n`);
      setCorsOrigin(res);
      res.writeHead(500, { 'Content-Type': 'application/json' })
         .end('{"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}');
    }
  });

  return new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    server.listen(port, host, () => resolve(server));
    server.once('error', reject);
  });
}
