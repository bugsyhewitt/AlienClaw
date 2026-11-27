/**
 * Shared redirect corpus: every vector's recorded TS behaviour (plan gate G5).
 *
 * The corpus (../../vectors/redirect-vectors.json) is shared with the Python
 * package and RECORDS current behaviour per language;
 * vectors/REDIRECT-DIFFERENCES.md lists where the two disagree. A failure
 * here means the TS redirect behaviour changed: if that is intended,
 * re-record (below) and review the diff.
 *
 * Harness (the Python twin, python/tests/test_shared_redirect_vectors.py, is
 * the same; change both together). Run it under staging/tools/offline.sh,
 * which leaves only loopback reachable.
 *
 *   - Each vector's `servers` are REAL listeners on 127.0.0.1 (node:net, or
 *     node:tls with a throwaway openssl certificate), serving the scripted
 *     `routes` and logging every request: method, target, the
 *     harness.tracked_headers it carried, body.
 *   - `{x}`, `{host:x}`, `{port:x}` become server x's origin, host:port and
 *     port; server x is `x.redirect.test` (RFC 6761 `.test`) unless it sets `host`.
 *   - Test-only resolver: the FetchPolicy `resolve` hook answers an IP literal
 *     with itself and every server name with harness.test_only_sentinel, a
 *     PUBLIC address, so the block list is untouched (127.0.0.1 stays refused).
 *     `dns` adds names (`@sentinel` = that address); anything else fails.
 *     node:dns/promises throws, so a real lookup fails loudly.
 *   - Test-only wire: net.Socket#connect is wrapped; the pinned lookup still
 *     decides, and only an answer of exactly the sentinel, for a listener's
 *     port, is handed to the socket as 127.0.0.1. Any other connect (a
 *     literal, another address or port) is refused and logged in
 *     `stray_connects`. The certificate joins this process's default CA list
 *     (tls.setDefaultCACertificates) for the file and is removed afterwards.
 *   - The call: hardenedFetch(url, { timeoutMs, maxBytes: harness.ts_max_bytes,
 *     maxRedirects, resolve }). hardenedFetch has no method, header or body
 *     option, so the vector's request method/headers/body are NOT sent: the TS
 *     side always sends its own GET (a recorded difference, not a harness gap).
 *
 * Re-record: REDIRECT_VECTORS_RECORD=<dir> writes <dir>/<id>.ts.json per
 * vector instead of asserting.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tls from 'node:tls';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => { throw new Error('test: unexpected real DNS lookup'); }),
}));

import { hardenedFetch, isBlockedHost, type ResolvedAddress } from '../src/index.js';

interface Route {
  status?: number;
  headers?: Array<[string, string]>;
  body?: string;
  body_repeat?: number;
  delay_ms?: number;
  drip_ms?: number;
  stall?: boolean;
}
interface ServerSpec { scheme: 'http' | 'https'; host?: string; routes: Record<string, Route>; }
interface Vector {
  id: string;
  category: string;
  servers: Record<string, ServerSpec>;
  dns: Record<string, string[]>;
  request: { url: string; method: string; headers: Record<string, string>; body: string | null };
  policy: { max_redirects: number; timeout_ms: number };
  hops_deterministic?: boolean;
  elapsed_max_ms?: number;
  expected: { python?: unknown; ts?: unknown };
  rationale: string;
}
interface Hop { server: string; method: string; target: string; headers: Record<string, string>; body: string; }
type Observation = Record<string, unknown>;

const corpus = JSON.parse(
  readFileSync(new URL('../../vectors/redirect-vectors.json', import.meta.url), 'utf8'),
) as {
  schema_version: number;
  harness: { hostname_suffix: string; test_only_sentinel: string; tracked_headers: string[]; ts_max_bytes: number };
  vectors: Vector[];
};
const { hostname_suffix: SUFFIX, test_only_sentinel: SENTINEL, tracked_headers: TRACKED } = corpus.harness;
const RECORD_DIR = process.env.REDIRECT_VECTORS_RECORD;
const PLACEHOLDER = /\{(?:(host|port):)?([a-z0-9]+)\}/g;

// ---------------------------------------------------------------------------
// TLS material (throwaway, test-only trust)
// ---------------------------------------------------------------------------

const canMakeCert = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0 &&
  typeof tls.setDefaultCACertificates === 'function';
let certPem = '';
let keyPem = '';
let originalCAs: string[] = [];

beforeAll(() => {
  if (!canMakeCert) return;
  const dir = mkdtempSync(join(tmpdir(), 'redirect-vectors-'));
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '2',
      '-subj', '/CN=redirect.test', '-addext', `subjectAltName=DNS:*${SUFFIX}`,
    ], { stdio: 'ignore' });
    certPem = readFileSync(join(dir, 'cert.pem'), 'utf8');
    keyPem = readFileSync(join(dir, 'key.pem'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  originalCAs = tls.getCACertificates('default');
  tls.setDefaultCACertificates([...originalCAs, certPem]);  // test-only trust anchor
});

afterAll(() => {
  if (canMakeCert) tls.setDefaultCACertificates(originalCAs);
});

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// Scripted listeners
// ---------------------------------------------------------------------------

class Scene {
  readonly hops: Hop[] = [];
  readonly listeners = new Map<string, { spec: ServerSpec; host: string; port: number; server: net.Server }>();
  readonly sockets = new Set<net.Socket>();
  readonly timers = new Set<NodeJS.Timeout>();
  ports = new Map<string, string>();
  closed = false;

  constructor(readonly vector: Vector) {}

  async start(): Promise<void> {
    for (const [name, spec] of Object.entries(this.vector.servers)) {
      const onSocket = (sock: net.Socket): void => this.handle(name, spec, sock);
      const server = spec.scheme === 'https'
        ? tls.createServer({ cert: certPem, key: keyPem }, onSocket)
        : net.createServer(onSocket);
      server.on('connection', (sock: net.Socket) => {
        this.sockets.add(sock);
        sock.on('close', () => this.sockets.delete(sock));
      });
      server.on('tlsClientError', () => { /* a client that gave up mid-handshake */ });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const port = (server.address() as net.AddressInfo).port;
      this.listeners.set(name, { spec, host: spec.host ?? `${name}${SUFFIX}`, port, server });
      this.ports.set(String(port), name);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    for (const s of this.sockets) s.destroy();
    await Promise.all([...this.listeners.values()].map(({ server }) =>
      new Promise<void>((r) => server.close(() => r()))));
  }

  subst(text: string): string {
    return text.replace(PLACEHOLDER, (_m, kind: string | undefined, name: string) => {
      const l = this.listeners.get(name);
      if (!l) throw new Error(`test: unknown server ${name}`);
      if (kind === 'port') return String(l.port);
      if (kind === 'host') return `${l.host}:${l.port}`;
      return `${l.spec.scheme}://${l.host}:${l.port}`;
    });
  }

  norm(text: string): string {
    return text.replace(/(?<!\d)\d{2,5}(?!\d)/g, (m) => {
      const name = this.ports.get(m);
      return name === undefined ? m : `{port:${name}}`;
    });
  }

  private wait(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.closed) { resolve(false); return; }
      const t = setTimeout(() => { this.timers.delete(t); resolve(!this.closed); }, ms);
      this.timers.add(t);
    });
  }

  private handle(name: string, spec: ServerSpec, sock: net.Socket): void {
    this.sockets.add(sock);
    sock.on('close', () => this.sockets.delete(sock));
    sock.on('error', () => { /* the client gave up */ });
    let buf = Buffer.alloc(0);
    let done = false;
    sock.on('data', (chunk: Buffer) => {
      if (done) return;
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const lines = buf.subarray(0, end).toString('latin1').split('\r\n');
      const [method = '', target = ''] = lines[0]!.split(' ');
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const i = line.indexOf(':');
        const key = line.slice(0, i).trim().toLowerCase();
        const value = line.slice(i + 1).trim();
        headers[key] = key in headers ? `${headers[key]}, ${value}` : value;
      }
      const length = Number(headers['content-length'] ?? '0') || 0;
      if (buf.length < end + 4 + length) return;
      done = true;
      const tracked: Record<string, string> = {};
      for (const h of TRACKED) if (h in headers) tracked[h] = this.norm(headers[h]!);
      this.hops.push({
        server: name, method, target: this.norm(target), headers: tracked,
        body: buf.subarray(end + 4, end + 4 + length).toString('latin1'),
      });
      const route = spec.routes[target] ?? spec.routes['*'] ?? { status: 404, body: 'no route' };
      void this.respond(sock, method, route);
    });
  }

  private async respond(sock: net.Socket, method: string, route: Route): Promise<void> {
    if (route.stall) return;  // never answers; close() destroys the socket
    if (route.delay_ms && !(await this.wait(route.delay_ms))) return;
    const status = route.status ?? 200;
    const payload = Buffer.from(this.subst(route.body ?? '').repeat(route.body_repeat ?? 1), 'utf8');
    const lines = [`HTTP/1.1 ${status} X`];
    for (const [k, v] of route.headers ?? []) lines.push(`${k}: ${this.subst(v)}`);
    lines.push(`Content-Length: ${payload.length}`, 'Connection: close');
    if (sock.destroyed) return;
    sock.write(Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8'));
    if (method === 'HEAD' || payload.length === 0) { sock.end(); return; }
    if (!route.drip_ms) { sock.end(payload); return; }
    for (let i = 0; i < payload.length; i++) {
      if (!(await this.wait(route.drip_ms)) || sock.destroyed) return;
      sock.write(payload.subarray(i, i + 1));
    }
    sock.end();
  }
}

// ---------------------------------------------------------------------------
// Test-only wire
// ---------------------------------------------------------------------------

const realConnect = net.Socket.prototype.connect as (this: net.Socket, ...args: unknown[]) => net.Socket;

function connectOptions(args: unknown[]): net.TcpNetConnectOpts | undefined {
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  return typeof first === 'object' && first !== null ? (first as net.TcpNetConnectOpts) : undefined;
}

function refuse(socket: net.Socket, why: string): net.Socket {
  process.nextTick(() => socket.destroy(new Error(why)));
  return socket;
}

function installWire(allowedPorts: Set<number>, strays: string[]): void {
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    const opts = connectOptions(args);
    if (!opts) return refuse(this, 'test: unparsed connect refused');
    const host = String(opts.host);
    const port = Number(opts.port);
    const pinned = opts.lookup;
    if (net.isIP(host) !== 0 || typeof pinned !== 'function') {
      strays.push(`${host}:${port}`);
      return refuse(this, 'test: only the vector listeners are reachable');
    }
    opts.lookup = (hostname, options, callback) => {
      pinned(hostname, options, (err, address, family) => {
        if (err) { callback(err, address, family); return; }
        const list = Array.isArray(address) ? address.map((a) => a.address) : [address];
        if (!allowedPorts.has(port) || list.some((a) => a !== SENTINEL)) {
          for (const a of list) strays.push(`${a}:${port}`);
          const refused: NodeJS.ErrnoException = new Error('test: only the vector listeners are reachable');
          refused.code = 'ECONNREFUSED';
          callback(refused, options.all ? [] : '', family);
          return;
        }
        // Test-only redirect: the local listener stands in for the sentinel address.
        if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
        else callback(null, '127.0.0.1', 4);
      });
    };
    return realConnect.apply(this, args);
  } as never);
}

// ---------------------------------------------------------------------------
// Running one vector
// ---------------------------------------------------------------------------

function classify(err: unknown): Observation {
  const e = err as Error & { cause?: { message?: string } };
  const msg = String(e?.message ?? err);
  if (msg.startsWith('Fetch timeout')) return { error: 'deadline' };
  if (msg.startsWith('Too many redirects')) return { error: 'hop_cap' };
  if (msg.startsWith('Redirect with no Location header')) return { error: 'no_location' };
  if (msg.startsWith('Invalid redirect Location')) return { error: 'invalid_location' };
  const http = /^HTTP (\d+) from /.exec(msg);
  if (http) return { error: 'http_status', status: Number(http[1]) };
  if (/^SSRF rejected: (a resolved address|DNS returned no addresses|unknown address family)/.test(msg) ||
      msg.startsWith('DNS resolution failed')) return { error: 'blocked' };
  if (/^(SSRF rejected: hostname|Protocol rejected|Port rejected|Invalid URL|Host not in allowlist|Request cannot be constructed from a URL that includes credentials)/.test(msg)) {
    return { error: 'blocked' };
  }
  if (msg === 'fetch failed' && e.cause?.message === 'bad port') return { error: 'blocked' };
  if (msg === 'fetch failed' || msg === 'terminated') return { error: 'network_error' };
  return { error: `crash:${e?.name ?? typeof err}` };
}

async function observe(vector: Vector, scene: Scene): Promise<{ observed: Observation; elapsedMs: number; detail: string }> {
  const table = new Map<string, string[]>();
  for (const l of scene.listeners.values()) table.set(l.host.toLowerCase(), [SENTINEL]);
  for (const [name, answers] of Object.entries(vector.dns)) {
    table.set(name.toLowerCase().replace(/\.+$/, ''), answers.map((a) => (a === '@sentinel' ? SENTINEL : a)));
  }
  const resolved: string[] = [];
  const resolve = (name: string): ResolvedAddress[] => {
    const family = net.isIP(name);
    if (family !== 0) return [{ address: name, family }];
    const key = name.toLowerCase().replace(/\.+$/, '');
    resolved.push(key);
    const answers = table.get(key);
    if (!answers || answers.length === 0) throw new Error(`getaddrinfo ENOTFOUND ${name}`);
    return answers.map((address) => ({ address, family: net.isIP(address) }));
  };
  const strays: string[] = [];
  installWire(new Set([...scene.listeners.values()].map((l) => l.port)), strays);
  let outcome: Observation;
  let detail = 'ok';
  const started = Date.now();
  try {
    const body = await hardenedFetch(scene.subst(vector.request.url), {
      timeoutMs: vector.policy.timeout_ms,
      maxBytes: corpus.harness.ts_max_bytes,
      maxRedirects: vector.policy.max_redirects,
      resolve,
    });
    outcome = { outcome: 'ok', body };
  } catch (err) {
    outcome = { outcome: 'error', ...classify(err) };
    const e = err as Error & { cause?: { message?: string } };
    detail = `${e?.name}: ${e?.message}${e?.cause?.message ? ` (cause: ${e.cause.message})` : ''}`;
  }
  const elapsedMs = Date.now() - started;
  await new Promise((r) => setTimeout(r, 50));  // let a listener log a hop the client abandoned
  return {
    observed: { ...outcome, hops: [...scene.hops], resolved, stray_connects: strays.map((s) => scene.norm(s)) },
    elapsedMs,
    detail,
  };
}

function comparable(observed: Observation, vector: Vector): Observation {
  if (vector.hops_deterministic !== false) return observed;
  const { hops: _hops, resolved: _resolved, ...rest } = observed;
  return rest;
}

describe('shared redirect corpus (vectors/redirect-vectors.json)', () => {
  it('is loaded', () => {
    expect(corpus.schema_version).toBe(1);
    expect(corpus.vectors.length).toBeGreaterThanOrEqual(60);
    expect(new Set(corpus.vectors.map((v) => v.id)).size).toBe(corpus.vectors.length);
    if (RECORD_DIR === undefined) {
      for (const v of corpus.vectors) expect(Object.keys(v.expected).sort(), v.id).toEqual(['python', 'ts']);
    }
  });

  it('the harness does not weaken the block list', () => {
    expect(isBlockedHost('127.0.0.1')).toBe(true);  // the listeners' real address
    expect(isBlockedHost(SENTINEL)).toBe(false);    // an ordinary public address
  });

  for (const vector of corpus.vectors) {
    const needsTls = Object.values(vector.servers).some((s) => s.scheme === 'https');
    it.skipIf(needsTls && !canMakeCert)(vector.id, { timeout: 20_000 }, async () => {
      const scene = new Scene(vector);
      await scene.start();
      let result: Awaited<ReturnType<typeof observe>>;
      try {
        result = await observe(vector, scene);
      } finally {
        vi.restoreAllMocks();
        await scene.close();
      }
      const { observed, elapsedMs, detail } = result;
      if (RECORD_DIR !== undefined) {
        mkdirSync(RECORD_DIR, { recursive: true });
        writeFileSync(join(RECORD_DIR, `${vector.id}.ts.json`), JSON.stringify(
          { observed: comparable(observed, vector), full: observed, elapsed_ms: elapsedMs, detail }, null, 2));
        return;
      }
      expect(
        comparable(observed, vector),
        `${vector.id}: ${detail}. ${vector.rationale}`,
      ).toEqual(vector.expected.ts);
      if (vector.elapsed_max_ms !== undefined) expect(elapsedMs).toBeLessThanOrEqual(vector.elapsed_max_ms);
    });
  }
});
