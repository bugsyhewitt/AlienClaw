/**
 * Connection pinning (security review SR-04, extraction plan gate G2): the
 * socket connects only to the address set hardenedFetch validated, resolved
 * once per hop, while the Host header, TLS SNI and the certificate check keep
 * the original hostname. Also pins the parts of fetch() behaviour that the
 * node:http transport reproduces.
 *
 * Network-free. DNS comes from a fake `resolve` hook in every test, and
 * node:dns/promises is mocked to throw, so an accidental real lookup fails
 * loudly. Two test-only instruments wrap net.Socket.prototype.connect; neither
 * changes the library's code path or its policy:
 *
 *   socketTargets()  records the target Node itself reports in the socket's
 *                    'lookup' event (the address it is about to dial), then
 *                    destroys the socket before it dials. Nothing leaves the
 *                    host. This is the direct "the test asserts the socket
 *                    target" check of gate G2.
 *   viaLoopback()    records the address list the transport's pinned lookup
 *                    hands to the socket, then dials 127.0.0.1 instead, so a
 *                    local HTTP or TLS listener can answer. socketTargets()
 *                    shows that Node dials exactly what that lookup returns.
 *
 * Both refuse any other connect except to a loopback literal (the listeners
 * here, and the global fetch() used as the reference in the parity tests).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tls from 'node:tls';
import * as zlib from 'node:zlib';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => { throw new Error('test: unexpected real DNS lookup'); }),
}));

import { hardenedFetch, type FetchPolicy, type ResolvedAddress } from '../src/index.js';
import { pinnedLookup } from '../src/pinned-request.js';

const POLICY: FetchPolicy = { timeoutMs: 5_000, maxBytes: 64 * 1024 };
const PUBLIC_A = '203.0.113.10';   // TEST-NET-3: "public" to the guard, never dialled here
const PUBLIC_B = '203.0.113.20';
const LOOPBACK = new Set(['127.0.0.1', '::1']);

const v4 = (address: string): ResolvedAddress => ({ address, family: 4 });

/** A resolver that gives each name its answers in turn, repeating the last one. */
function rebindingResolver(plan: Record<string, ResolvedAddress[][]>) {
  const calls: string[] = [];
  const resolve = vi.fn(async (hostname: string): Promise<ResolvedAddress[]> => {
    calls.push(hostname);
    const answers = plan[hostname];
    if (!answers) throw new Error(`test: no plan for ${hostname}`);
    return answers.length > 1 ? answers.shift()! : answers[0]!;
  });
  return { resolve, calls };
}

// ---------------------------------------------------------------------------
// Instruments
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

type Target = { host: string; address: string; family: number };

/** Records Node's own 'lookup' report (host, address it would dial) and stops before dialling. */
function socketTargets(onConnect?: () => void): { targets: Target[]; connects: () => number } {
  const targets: Target[] = [];
  const spy = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    onConnect?.();
    const opts = connectOptions(args);
    if (!opts || net.isIP(String(opts.host)) !== 0) return refuse(this, 'test: literal connect refused');
    this.once('lookup', (err: Error | null, address: string, family: string | number | null, host: string) => {
      if (!err) targets.push({ host, address, family: Number(family) });
      this.destroy(new Error('test: connect intercepted'));
    });
    return realConnect.apply(this, args);
  } as never);
  return { targets, connects: () => spy.mock.calls.length };
}

type Seen = { host: string; pinned: string[] };

/** Records what the pinned lookup hands the socket, then dials 127.0.0.1 instead. */
function viaLoopback(): Seen[] {
  const seen: Seen[] = [];
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    const opts = connectOptions(args);
    if (!opts) return refuse(this, 'test: unparsed connect refused');
    const host = String(opts.host);
    if (net.isIP(host) !== 0) {
      return LOOPBACK.has(host) ? realConnect.apply(this, args) : refuse(this, 'test: non-loopback connect refused');
    }
    const pinned = opts.lookup;
    if (typeof pinned !== 'function') return refuse(this, 'test: unpinned hostname connect refused');
    const record: Seen = { host, pinned: [] };
    seen.push(record);
    opts.lookup = (hostname, options, callback) => {
      pinned(hostname, options, (err, address, family) => {
        if (err) { callback(err, address, family); return; }
        record.pinned = Array.isArray(address) ? address.map((a) => a.address) : [address];
        // Test-only redirect: the local listener stands in for the pinned address.
        if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
        else callback(null, '127.0.0.1', 4);
      });
    };
    return realConnect.apply(this, args);
  } as never);
  return seen;
}

// ---------------------------------------------------------------------------
// Local listeners
// ---------------------------------------------------------------------------

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
const servers: net.Server[] = [];

async function listen<S extends net.Server>(server: S): Promise<number> {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return (server.address() as net.AddressInfo).port;
}

async function httpServer(handler: Handler): Promise<{ port: number; requests: http.IncomingMessage[] }> {
  const requests: http.IncomingMessage[] = [];
  const server = http.createServer((req, res) => { requests.push(req); handler(req, res); });
  return { port: await listen(server), requests };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) {
    if ('closeAllConnections' in s) (s as http.Server).closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

async function rejection(p: Promise<unknown>): Promise<Error & { cause?: Error & { code?: string } }> {
  try {
    await p;
  } catch (err) {
    return err as Error & { cause?: Error & { code?: string } };
  }
  throw new Error('test: expected a rejection');
}

// ---------------------------------------------------------------------------
// Rebinding: the socket target is the first, validated answer
// ---------------------------------------------------------------------------

describe('pinning: the socket dials the validated answer, resolved once', () => {
  for (const scheme of ['http', 'https']) {
    it(`${scheme}: public first / 127.0.0.1 second resolver -> socket target is the first answer`, async () => {
      const { resolve, calls } = rebindingResolver({ 'rebind.example': [[v4(PUBLIC_A)], [v4('127.0.0.1')]] });
      const { targets } = socketTargets();
      const err = await rejection(hardenedFetch(`${scheme}://rebind.example/`, { ...POLICY, resolve }));
      // The socket was stopped at its 'lookup' event, before dialling.
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toBe('fetch failed');
      expect(err.cause?.message).toBe('test: connect intercepted');
      expect(targets).toEqual([{ host: 'rebind.example', address: PUBLIC_A, family: 4 }]);
      expect(calls).toEqual(['rebind.example']);  // one resolution per hop: no second answer was asked for
    });
  }

  it('a multi-address answer: the socket dials from that set only (first answer first)', async () => {
    const answer = [v4(PUBLIC_A), { address: '2001:db8::10', family: 6 }];
    const { resolve } = rebindingResolver({ 'multi.example': [answer, [v4('10.0.0.1')]] });
    const { targets } = socketTargets();
    await rejection(hardenedFetch('http://multi.example/', { ...POLICY, resolve }));
    expect(targets).toEqual([{ host: 'multi.example', address: PUBLIC_A, family: 4 }]);
  });

  it('the pin is a copy: a resolver that rewrites its answer array after validation changes nothing', async () => {
    const answer = [v4(PUBLIC_A)];
    const resolve = vi.fn(async () => answer);
    // The test-only hook runs at connect time, after validation, and rebinds the array in place.
    const { targets } = socketTargets(() => { answer[0] = v4('127.0.0.1'); });
    await rejection(hardenedFetch('http://mutate.example/', { ...POLICY, resolve }));
    expect(answer[0]!.address).toBe('127.0.0.1');
    expect(targets.map((t) => t.address)).toEqual([PUBLIC_A]);
  });
});

// ---------------------------------------------------------------------------
// Refused before connecting
// ---------------------------------------------------------------------------

describe('pinning: a bad answer is refused before any socket exists', () => {
  const POISONED: Array<[string, ResolvedAddress[], RegExp]> = [
    ['one private address among public ones', [v4(PUBLIC_A), v4('10.0.0.1')], /blocked range/],
    ['loopback last', [v4(PUBLIC_A), v4(PUBLIC_B), v4('127.0.0.1')], /blocked range/],
    ['cloud metadata', [v4('169.254.169.254')], /blocked range/],
    ['IPv6 loopback next to a public IPv4', [v4(PUBLIC_A), { address: '::1', family: 6 }], /blocked range/],
    ['NAT64 metadata', [{ address: '64:ff9b::a9fe:a9fe', family: 6 }], /blocked range/],
    ['IPv4-mapped private', [{ address: '::ffff:10.0.0.1', family: 6 }], /blocked range/],
    ['012.0.0.1 (the classifier reads 12.0.0.1, inet_aton reads octal 10.0.0.1)', [v4('012.0.0.1')], /not a canonical IPv4 address/],
    ['0177.0.0.1 (four-digit octet: the classifier already fails closed)', [v4('0177.0.0.1')], /blocked range/],
    ['an IPv4 string labelled family 6', [{ address: '1.2.3.4', family: 6 }], /blocked range/],
    ['an unknown family', [{ address: PUBLIC_A, family: 0 }], /unknown address family/],
    ['an empty answer', [], /DNS returned no addresses/],
  ];
  for (const [label, answer, why] of POISONED) {
    it(`${label}: rejected, no connect attempted`, async () => {
      const { targets, connects } = socketTargets();
      await expect(hardenedFetch('http://poison.example/', { ...POLICY, resolve: async () => answer })).rejects.toThrow(why);
      expect(connects()).toBe(0);
      expect(targets).toEqual([]);
    });
  }

  it('a throwing or malformed resolve hook fails the call (DNS failure), no connect', async () => {
    const { connects } = socketTargets();
    await expect(hardenedFetch('http://x.example/', { ...POLICY, resolve: async () => { throw new Error('boom'); } }))
      .rejects.toThrow('DNS resolution failed for "x.example": boom');
    await expect(hardenedFetch('http://x.example/', { ...POLICY, resolve: (() => '1.2.3.4') as never }))
      .rejects.toThrow('DNS resolution failed for "x.example": resolve hook returned "1.2.3.4", not an array of addresses');
    await expect(hardenedFetch('http://x.example/', { ...POLICY, resolve: (() => [{ address: 1, family: 4 }]) as never }))
      .rejects.toThrow(/resolve hook returned an entry without a string address and a numeric family/);
    await expect(hardenedFetch('http://x.example/', { ...POLICY, resolve: (() => [null]) as never }))
      .rejects.toThrow(/resolve hook returned an entry without/);
    expect(connects()).toBe(0);
  });

  it('a synchronous resolve hook is accepted', async () => {
    const { targets } = socketTargets();
    await rejection(hardenedFetch('http://sync.example/', { ...POLICY, resolve: () => [v4(PUBLIC_B)] }));
    expect(targets.map((t) => t.address)).toEqual([PUBLIC_B]);
  });

  it('resolve must be a function: TypeError before any I/O', async () => {
    const resolveSpy = vi.fn();
    const { connects } = socketTargets();
    for (const bad of ['dns.example', null, 42, { resolve: resolveSpy }]) {
      await expect(hardenedFetch('http://x.example/', { ...POLICY, resolve: bad as never }))
        .rejects.toThrow(/^Invalid FetchPolicy: resolve must be a function \(got /);
    }
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(connects()).toBe(0);
  });

  it('the resolve hook runs under the call deadline', async () => {
    const started = Date.now();
    await expect(hardenedFetch('http://slow.example/', { ...POLICY, timeoutMs: 100, resolve: () => new Promise(() => {}) }))
      .rejects.toThrow('Fetch timeout: exceeded 100ms budget');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('an IPv6-literal URL reaches the resolver without brackets', async () => {
    const resolve = vi.fn(async () => [{ address: '::1', family: 6 }]);
    await expect(hardenedFetch('http://[2001:db8::1]/', { ...POLICY, resolve })).rejects.toThrow(/blocked range/);
    expect(resolve).toHaveBeenCalledWith('2001:db8::1');
  });
});

// ---------------------------------------------------------------------------
// Host header, SNI and certificate keep the hostname
// ---------------------------------------------------------------------------

describe('pinning: Host, SNI and the certificate check use the original hostname', () => {
  it('HTTP: the request carries Host: <name>:<port> and the original path; body returned', async () => {
    const { port, requests } = await httpServer((_req, res) => res.end('pinned-ok'));
    const seen = viaLoopback();
    const { resolve } = rebindingResolver({ 'rebind.example': [[v4(PUBLIC_A)], [v4('127.0.0.1')]] });
    await expect(hardenedFetch(`http://rebind.example:${port}/p?q=1#frag`, { ...POLICY, resolve })).resolves.toBe('pinned-ok');
    expect(seen).toEqual([{ host: 'rebind.example', pinned: [PUBLIC_A] }]);
    expect(requests.map((r) => [r.headers.host, r.url])).toEqual([[`rebind.example:${port}`, '/p?q=1']]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('TLS: the ClientHello SNI is the hostname, not the pinned IP', async () => {
    const sni: string[] = [];
    const server = tls.createServer({
      SNICallback: (name, cb) => { sni.push(name); cb(new Error('test: handshake stopped after SNI')); },
    });
    server.on('tlsClientError', () => { /* expected */ });
    const port = await listen(server);
    const seen = viaLoopback();
    const err = await rejection(hardenedFetch(`https://rebind.example:${port}/`, { ...POLICY, resolve: async () => [v4(PUBLIC_A)] }));
    expect(err.message).toBe('fetch failed');
    expect(sni).toEqual(['rebind.example']);
    expect(seen).toEqual([{ host: 'rebind.example', pinned: [PUBLIC_A] }]);
  });

  const canMakeCert = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0 &&
    typeof tls.setDefaultCACertificates === 'function';

  it.skipIf(!canMakeCert)('TLS: the certificate is verified against the hostname (match passes, mismatch fails)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pinning-cert-'));
    const original = tls.getCACertificates('default');
    try {
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '2',
        '-subj', '/CN=rebind.example', '-addext', 'subjectAltName=DNS:rebind.example',
      ], { stdio: 'ignore' });
      const cert = readFileSync(join(dir, 'cert.pem'), 'utf8');
      const key = readFileSync(join(dir, 'key.pem'), 'utf8');
      // Test-only trust: the throwaway self-signed cert joins this process's default CA list.
      tls.setDefaultCACertificates([...original, cert]);
      const hosts: Array<string | undefined> = [];
      const server = https.createServer({ cert, key }, (req, res) => { hosts.push(req.headers.host); res.end('tls-ok'); });
      server.on('tlsClientError', () => { /* the mismatch case */ });
      const port = await listen(server);
      const seen = viaLoopback();
      const resolve = async (): Promise<ResolvedAddress[]> => [v4(PUBLIC_A)];

      await expect(hardenedFetch(`https://rebind.example:${port}/`, { ...POLICY, resolve })).resolves.toBe('tls-ok');
      expect(hosts).toEqual([`rebind.example:${port}`]);

      const err = await rejection(hardenedFetch(`https://other.example:${port}/`, { ...POLICY, resolve }));
      expect(err.message).toBe('fetch failed');
      expect(err.cause?.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
      expect(seen.map((s) => s.host)).toEqual(['rebind.example', 'other.example']);
    } finally {
      tls.setDefaultCACertificates(original);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Pinning review PR-04 (2026-11-26): the transport passes rejectUnauthorized: true,
  // so the process-wide NODE_TLS_REJECT_UNAUTHORIZED=0 opt-out cannot turn it off.
  const hasOpenssl = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;

  it.skipIf(!hasOpenssl)('TLS: NODE_TLS_REJECT_UNAUTHORIZED=0 does not turn certificate verification off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pinning-cert-'));
    const saved = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    try {
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '2',
        '-subj', '/CN=rebind.example', '-addext', 'subjectAltName=DNS:rebind.example',
      ], { stdio: 'ignore' });
      // Self-signed and NOT trusted: only a disabled verification would accept it.
      const cert = readFileSync(join(dir, 'cert.pem'), 'utf8');
      const key = readFileSync(join(dir, 'key.pem'), 'utf8');
      let served = 0;
      const server = https.createServer({ cert, key }, (_req, res) => { served++; res.end('unverified'); });
      server.on('tlsClientError', () => { /* the refused handshake */ });
      const port = await listen(server);
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      vi.spyOn(process, 'emitWarning').mockImplementation(() => { /* Node's opt-out warning */ });

      // Control: in this process the opt-out really is in force for a client that leaves the default.
      const control = await new Promise<string>((resolveBody, reject) => {
        https.get({ host: '127.0.0.1', port, servername: 'rebind.example', agent: new https.Agent() }, (res) => {
          let body = '';
          res.on('data', (c: Buffer) => { body += c.toString(); });
          res.on('end', () => resolveBody(body));
        }).on('error', reject);
      });
      expect(control).toBe('unverified');
      expect(served).toBe(1);

      viaLoopback();
      const err = await rejection(hardenedFetch(`https://rebind.example:${port}/`, {
        ...POLICY, resolve: async () => [v4(PUBLIC_A)],
      }));
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toBe('fetch failed');
      expect(err.cause?.code).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
      expect(served).toBe(1);  // the pinned request never got past the handshake
    } finally {
      if (saved === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Redirect hops are pinned too
// ---------------------------------------------------------------------------

describe('pinning: every redirect hop re-resolves once and is pinned', () => {
  it('a redirect to a rebinding hostname: that hop dials its first answer', async () => {
    let port = 0;
    const { requests } = await httpServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: `http://b.example:${port}/final` });
        res.end();
      } else {
        res.end('final');
      }
    }).then((s) => { port = s.port; return s; });
    const seen = viaLoopback();
    const { resolve, calls } = rebindingResolver({
      'a.example': [[v4(PUBLIC_A)], [v4('127.0.0.1')]],
      'b.example': [[v4(PUBLIC_B)], [v4('127.0.0.1')]],
    });
    await expect(hardenedFetch(`http://a.example:${port}/start`, { ...POLICY, resolve })).resolves.toBe('final');
    expect(seen).toEqual([{ host: 'a.example', pinned: [PUBLIC_A] }, { host: 'b.example', pinned: [PUBLIC_B] }]);
    expect(calls).toEqual(['a.example', 'b.example']);
    expect(requests.map((r) => r.headers.host)).toEqual([`a.example:${port}`, `b.example:${port}`]);
  });

  it('a redirect to a hostname that resolves private: refused, no second connection', async () => {
    let port = 0;
    await httpServer((_req, res) => {
      res.writeHead(302, { location: `http://internal.example:${port}/` });
      res.end();
    }).then((s) => { port = s.port; });
    const seen = viaLoopback();
    const { resolve } = rebindingResolver({ 'a.example': [[v4(PUBLIC_A)]], 'internal.example': [[v4('10.0.0.5')]] });
    await expect(hardenedFetch(`http://a.example:${port}/`, { ...POLICY, resolve })).rejects.toThrow(/blocked range/);
    expect(seen.map((s) => s.host)).toEqual(['a.example']);
  });

  it('two Location headers on the wire: refused, no second connection (they used to be comma-joined)', async () => {
    let port = 0;
    await httpServer((_req, res) => {
      res.writeHead(302, ['Location', `http://a.example:${port}/one`, 'Location', `http://b.example:${port}/two`]);
      res.end();
    }).then((s) => { port = s.port; });
    const seen = viaLoopback();
    const resolve = async (): Promise<ResolvedAddress[]> => [v4(PUBLIC_A)];
    await expect(hardenedFetch(`http://a.example:${port}/`, { ...POLICY, resolve }))
      .rejects.toThrow('Redirect with 2 Location headers (status 302)');
    expect(seen.map((s) => s.host)).toEqual(['a.example']);
  });

  it('a UTF-8 Location on the wire is read as UTF-8 and percent-encoded, as fetch() does', async () => {
    let port = 0;
    const { requests } = await httpServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: Buffer.from('/café?q=ü', 'utf8').toString('latin1') });
        res.end();
      } else {
        res.end('utf8');
      }
    }).then((s) => { port = s.port; return s; });
    viaLoopback();
    const resolve = async (): Promise<ResolvedAddress[]> => [v4(PUBLIC_A)];
    await expect(hardenedFetch(`http://a.example:${port}/start`, { ...POLICY, resolve })).resolves.toBe('utf8');
    expect(requests.map((r) => r.url)).toEqual(['/start', '/caf%C3%A9?q=%C3%BC']);
  });

  it('the unread redirect body is released before the next hop', async () => {
    let port = 0;
    let firstClosed = false;
    await httpServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: `http://a.example:${port}/next` });
        res.write('x'.repeat(1024));  // a body that never ends
        res.on('close', () => { firstClosed = true; });
      } else {
        res.end('next');
      }
    }).then((s) => { port = s.port; });
    viaLoopback();
    const resolve = async (): Promise<ResolvedAddress[]> => [v4(PUBLIC_A)];
    await expect(hardenedFetch(`http://a.example:${port}/start`, { ...POLICY, resolve })).resolves.toBe('next');
    for (let i = 0; i < 50 && !firstClosed; i++) await new Promise((r) => setTimeout(r, 10));
    expect(firstClosed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The transport matches what fetch() did
// ---------------------------------------------------------------------------

describe('transport parity with fetch(): headers, decoding, errors', () => {
  const resolve = async (): Promise<ResolvedAddress[]> => [v4(PUBLIC_A)];

  it("sends fetch()'s request headers (Connection: close instead of keep-alive)", async () => {
    const { port, requests } = await httpServer((_req, res) => res.end('ok'));
    viaLoopback();
    await hardenedFetch(`http://h.example:${port}/`, { ...POLICY, resolve });
    await (await fetch(`http://127.0.0.1:${port}/`)).text();  // reference: the real global fetch
    const [ours, theirs] = requests.map((r) => {
      const pairs: Record<string, string> = {};
      for (let i = 0; i < r.rawHeaders.length; i += 2) pairs[r.rawHeaders[i]!.toLowerCase()] = r.rawHeaders[i + 1]!;
      return pairs;
    });
    expect(ours).toEqual({
      host: `h.example:${port}`, accept: '*/*', 'accept-language': '*', 'sec-fetch-mode': 'cors',
      'user-agent': 'node', 'accept-encoding': 'gzip, deflate', connection: 'close',
    });
    const { host: _h1, connection: _c1, ...oursRest } = ours!;
    const { host: _h2, connection: _c2, ...theirsRest } = theirs!;
    expect(oursRest).toEqual(theirsRest);
    expect(theirs!.connection).toBe('keep-alive');
  });

  const TEXT = 'pinned and decoded '.repeat(50);
  const raw = Buffer.from(TEXT);
  const ENCODINGS: Array<[string, string, Buffer]> = [
    ['gzip', 'gzip', zlib.gzipSync(raw)],
    ['x-gzip', 'x-gzip', zlib.gzipSync(raw)],
    ['deflate (zlib-wrapped)', 'deflate', zlib.deflateSync(raw)],
    ['deflate (raw)', 'deflate', zlib.deflateRawSync(raw)],
    ['br', 'br', zlib.brotliCompressSync(raw)],
    ['stacked "gzip, br" (gzip applied first)', 'gzip, br', zlib.brotliCompressSync(zlib.gzipSync(raw))],
    ['identity', 'identity', raw],
    ['an unknown coding (passed through undecoded)', 'compress', zlib.gzipSync(raw)],
    ['a mixed list with an unknown coding (passed through)', 'gzip, compress', zlib.gzipSync(raw)],
  ];
  if (typeof zlib.zstdCompressSync === 'function') ENCODINGS.push(['zstd', 'zstd', zlib.zstdCompressSync(raw)]);

  for (const [label, encoding, body] of ENCODINGS) {
    it(`Content-Encoding ${label}: same text as fetch()`, async () => {
      const { port } = await httpServer((_req, res) => {
        res.writeHead(200, { 'content-encoding': encoding, 'content-length': body.length });
        res.end(body);
      });
      viaLoopback();
      const ours = await hardenedFetch(`http://enc.example:${port}/`, { ...POLICY, resolve });
      const theirs = await (await fetch(`http://127.0.0.1:${port}/`)).text();
      // Node 22's fetch() leaves zstd undecoded even where its zlib can decode it; the
      // transport decodes whenever zlib can, so parity with fetch() holds only if fetch decodes.
      if (encoding !== 'zstd' || theirs === TEXT) expect(ours).toBe(theirs);
      if (!label.includes('passed through')) expect(ours).toBe(TEXT);
    });
  }

  it('more than five stacked content-codings: TypeError fetch failed, like fetch()', async () => {
    const { port } = await httpServer((_req, res) => {
      res.writeHead(200, { 'content-encoding': 'gzip, gzip, gzip, gzip, gzip, gzip' });
      res.end('x');
    });
    viaLoopback();
    const err = await rejection(hardenedFetch(`http://enc.example:${port}/`, { ...POLICY, resolve }));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe('fetch failed');
    expect(err.cause?.message).toBe('too many content-encodings in response: 6, maximum allowed is 5');
  });

  const zeros = Buffer.alloc(8 * 1024 * 1024);
  const BOMBS: Array<[string, Buffer]> = [
    ['gzip', zlib.gzipSync(zeros)],
    ['deflate', zlib.deflateSync(zeros)],
    ['deflate', zlib.deflateRawSync(zeros)],
    ['br', zlib.brotliCompressSync(zeros)],
  ];
  for (const [encoding, bomb] of BOMBS) {
    it(`maxBytes counts decoded bytes: an 8 MiB ${encoding} bomb (${bomb.length} bytes on the wire) stops at the cap`, async () => {
      const { port } = await httpServer((_req, res) => {
        res.writeHead(200, { 'content-encoding': encoding });
        res.end(bomb);
      });
      viaLoopback();
      expect(bomb.length).toBeLessThan(POLICY.maxBytes);
      await expect(hardenedFetch(`http://bomb.example:${port}/`, { ...POLICY, resolve }))
        .rejects.toThrow(`Response exceeds ${POLICY.maxBytes} bytes`);
    });
  }

  it('204 has a null body, as with fetch(): "No response body"', async () => {
    const { port } = await httpServer((_req, res) => { res.writeHead(204); res.end(); });
    viaLoopback();
    await expect(hardenedFetch(`http://nb.example:${port}/`, { ...POLICY, resolve })).rejects.toThrow('No response body');
    expect((await fetch(`http://127.0.0.1:${port}/`)).body).toBeNull();
  });

  it('a body cut off mid-read rejects with TypeError terminated, like fetch()', async () => {
    const { port } = await httpServer((_req, res) => {
      res.writeHead(200, { 'content-length': '100' });
      res.write('partial');
      setTimeout(() => res.socket?.destroy(), 20);
    });
    viaLoopback();
    const err = await rejection(hardenedFetch(`http://cut.example:${port}/`, { ...POLICY, resolve }));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe('terminated');
    const ref = await rejection((await fetch(`http://127.0.0.1:${port}/`)).text());
    expect(ref.message).toBe('terminated');
  });

  it('a Fetch-standard bad port is refused like fetch() (TypeError fetch failed, cause "bad port"), no connect', async () => {
    const { connects } = socketTargets();
    const err = await rejection(hardenedFetch('http://smtp.example:25/', { ...POLICY, resolve }));
    expect(err).toBeInstanceOf(TypeError);
    expect([err.message, err.cause?.message]).toEqual(['fetch failed', 'bad port']);
    const ref = await rejection(fetch('http://127.0.0.1:25/'));
    expect([ref.message, (ref.cause as Error).message]).toEqual(['fetch failed', 'bad port']);
    expect(connects()).toBe(0);
  });

  it('a URL with credentials is refused with fetch()\'s TypeError, no connect; the URL is redacted', async () => {
    const { connects } = socketTargets();
    const url = 'http://user:pass@creds.example/';
    const prefix = 'Request cannot be constructed from a URL that includes credentials: ';
    const err = await rejection(hardenedFetch(url, { ...POLICY, resolve }));
    expect(err).toBeInstanceOf(TypeError);
    // fetch() repeats the URL whole; the transport redacts its userinfo (gate G7, 2026-11-26).
    expect(err.message).toBe(`${prefix}http://<redacted>@creds.example/`);
    const ref = await rejection(fetch(url));
    expect(ref).toBeInstanceOf(TypeError);
    expect(ref.message).toBe(`${prefix}${url}`);
    expect(connects()).toBe(0);
  });

  it.skipIf(typeof http.setGlobalProxyFromEnv !== 'function')(
    'a global env proxy is ignored: the request goes direct (fetch() would have used the proxy)',
    async () => {
      // A "proxy" that counts connections and refuses every request (undici tunnels with CONNECT).
      let proxyConnections = 0;
      const proxyPort = await listen(net.createServer((socket) => {
        proxyConnections++;
        socket.once('data', () => socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
      }));
      const target = await httpServer((_req, res) => res.end('direct'));
      const restore = http.setGlobalProxyFromEnv({
        HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
        HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
      });
      try {
        viaLoopback();
        await expect(hardenedFetch(`http://direct.example:${target.port}/`, { ...POLICY, resolve })).resolves.toBe('direct');
        expect(proxyConnections).toBe(0);
        // Reference: the global fetch now goes to the proxy (which refuses it).
        await rejection(fetch(`http://127.0.0.1:${target.port}/`, { signal: AbortSignal.timeout(2_000) }));
        expect(proxyConnections).toBeGreaterThan(0);
      } finally {
        restore();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// pinnedLookup unit behaviour
// ---------------------------------------------------------------------------

describe('pinnedLookup', () => {
  const ADDRS = [v4(PUBLIC_A), { address: '2001:db8::10', family: 6 }, v4(PUBLIC_B)];
  type Result = { err: NodeJS.ErrnoException | null; address: unknown; family?: number };
  const call = (host: string, options: Parameters<ReturnType<typeof pinnedLookup>>[1], list = ADDRS) =>
    new Promise<Result>((resolve) => {
      let sync = true;
      pinnedLookup('pin.example', list)(host, options, (err, address, family) => {
        expect(sync).toBe(false);  // asynchronous, like dns.lookup
        resolve({ err, address, family });
      });
      sync = false;
    });

  it('all: true (the autoSelectFamily form) returns every validated address, in order', async () => {
    expect((await call('pin.example', { all: true })).address).toEqual(ADDRS);
  });

  it('single form returns the first address of the requested family', async () => {
    expect(await call('pin.example', {})).toMatchObject({ err: null, address: PUBLIC_A, family: 4 });
    expect(await call('pin.example', { family: 6 })).toMatchObject({ err: null, address: '2001:db8::10', family: 6 });
    expect(await call('pin.example', { family: 'IPv6' })).toMatchObject({ address: '2001:db8::10' });
    expect((await call('pin.example', { family: 4, all: true })).address).toEqual([v4(PUBLIC_A), v4(PUBLIC_B)]);
  });

  it('refuses a family with no validated address, and any other hostname (ENOTFOUND)', async () => {
    const noV6 = await call('pin.example', { family: 6 }, [v4(PUBLIC_A)]);
    expect(noV6.err?.code).toBe('ENOTFOUND');
    const other = await call('other.example', { all: true });
    expect(other.err?.code).toBe('ENOTFOUND');
    expect(other.err?.message).toContain('"other.example"');
  });
});
