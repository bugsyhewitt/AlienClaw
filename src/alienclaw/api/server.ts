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

// ── Limits ──────────────────────────────────────────────────────────────────

/**
 * Hard cap on the accepted request-body size, in bytes.
 *
 * DoS hardening: `readJson` buffers the body in memory, so an unbounded body
 * (large or chunked, with or without a truthful Content-Length) can exhaust
 * server memory. We enforce this cap against the bytes *actually received*,
 * not the client-supplied Content-Length header.
 *
 * 64 KiB sits well above any valid request: the largest body is a genome
 * submission, and validation.ts already bounds a genome to 256 chars and
 * run_metadata to 4096 bytes — a few KiB total. The Python bridge enforces a
 * larger 1 MiB cap (bridge/server.py) because it carries a richer envelope;
 * the public API never needs that much, so the tighter cap is intentional.
 */
export const MAX_BODY_BYTES = 64 * 1024; // 65536

/** Outcome of reading and parsing a request body. */
type BodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: 'too_large' | 'malformed'; receivedBytes?: number };

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
 * Read and JSON-parse a request body, enforcing {@link MAX_BODY_BYTES}.
 *
 * The cap is enforced two ways, since neither alone is sufficient:
 *  1. A truthful, oversized Content-Length is rejected up front — we never
 *     start buffering a body the client already admits is too big.
 *  2. Bytes actually received are accumulated and checked per chunk, so a
 *     lying Content-Length or a chunked (length-less) transfer is still
 *     bounded. On overflow we stop buffering, drain the socket without
 *     retaining it (`req.resume()`), and resolve immediately — the caller
 *     then writes a clean 413 instead of the connection being reset.
 *
 * Returns a discriminated result so callers can distinguish an oversized body
 * (-> 413 PAYLOAD_TOO_LARGE) from malformed/aborted input (-> 400).
 */
async function readJson(req: IncomingMessage): Promise<BodyResult> {
  const length = parseInt(req.headers['content-length'] ?? '0', 10);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    req.resume(); // discard the announced body without buffering it
    return { ok: false, reason: 'too_large', receivedBytes: length };
  }
  if (length === 0 && req.headers['transfer-encoding'] === undefined) {
    return { ok: true, value: {} };
  }
  return new Promise<BodyResult>(resolve => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled  = false;

    const finish = (result: BodyResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (c: Buffer) => {
      if (settled) return;
      received += c.length;
      if (received > MAX_BODY_BYTES) {
        chunks.length = 0; // release buffered bytes for GC
        req.resume();      // drain the rest without retaining it
        finish({ ok: false, reason: 'too_large', receivedBytes: received });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (settled) return;
      if (received === 0) { finish({ ok: true, value: {} }); return; }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          finish({ ok: false, reason: 'malformed' });
          return;
        }
        finish({ ok: true, value: parsed as Record<string, unknown> });
      } catch {
        finish({ ok: false, reason: 'malformed' });
      }
    });
    req.on('error', () => finish({ ok: false, reason: 'malformed' }));
  });
}

/**
 * Write a 413 PAYLOAD_TOO_LARGE response and signal the client to close the
 * connection — the request body was (or would be) over {@link MAX_BODY_BYTES}.
 */
function tooLarge(res: ServerResponse, receivedBytes?: number): void {
  res.setHeader('Connection', 'close');
  err(res, 413, 'PAYLOAD_TOO_LARGE',
    `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`,
    { limit_bytes: MAX_BODY_BYTES, ...(receivedBytes !== undefined ? { received_bytes: receivedBytes } : {}) });
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
          const parsed = await readJson(req);
          if (!parsed.ok) {
            if (parsed.reason === 'too_large') return tooLarge(res, parsed.receivedBytes);
            return err(res, 400, 'MALFORMED_REQUEST', 'Request body must be valid JSON.');
          }
          const body = parsed.value;
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
          const parsed = await readJson(req);
          if (!parsed.ok) {
            if (parsed.reason === 'too_large') return tooLarge(res, parsed.receivedBytes);
            return err(res, 400, 'MALFORMED_REQUEST', 'Request body must be valid JSON.');
          }
          const body = parsed.value;
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
