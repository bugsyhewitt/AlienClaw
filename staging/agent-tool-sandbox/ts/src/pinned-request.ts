/**
 * pinned-request.ts
 * The transport behind hardenedFetch: one HTTP/1.1 GET over node:http or
 * node:https whose socket can connect only to addresses that hardenedFetch
 * has already validated (connection pinning, the DNS-rebinding fix).
 *
 * How the pin works. The request is made to the original hostname, so the
 * Host header, the TLS SNI (servername) and the certificate check all use the
 * name. The `lookup` option is replaced by pinnedLookup(), which answers from
 * the validated address list instead of asking DNS again. Node calls `lookup`
 * for every hostname connect, including the `all: true` form that
 * autoSelectFamily (happy eyeballs) uses, so nothing re-resolves the name
 * between validation and connect. An IP-literal host skips `lookup` in Node
 * and connects to the literal itself, which validateUrl() has already checked.
 *
 * It reproduces what callers of the earlier fetch()-based version could
 * observe (README "Pinning: differences from fetch()"): fetch's request
 * headers, content decoding (gzip, deflate, br, zstd), the Fetch-standard
 * bad-port list, the credentials-in-URL TypeError (its URL redacted),
 * `TypeError('fetch failed',
 * { cause })` for network errors, `TypeError('terminated', { cause })` for a
 * body that breaks mid-read, and a null body for 101/204/205/304.
 *
 * Internal module: the package entry points do not export it. `transport` is
 * the seam the tests stub, in place of the global fetch they stubbed before.
 */

import type { LookupAddress, LookupOptions } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { pipeline, Transform, type Readable, type TransformCallback } from 'node:stream';
import * as zlib from 'node:zlib';
import { redactUrl } from './redact-url.js';

/** A validated address the socket may connect to. */
export interface PinnedAddress {
  readonly address: string;
  readonly family: number;
}

/** The part of a WHATWG Response that hardenedFetch reads. A real Response fits it. */
export interface TransportResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

export interface TransportInit {
  /** Aborting it destroys the request, its socket and the response body. */
  readonly signal: AbortSignal;
  /** The validated answer for the URL's hostname: the only addresses the socket may use. */
  readonly addresses: readonly PinnedAddress[];
}

export type Transport = (url: string, init: TransportInit) => Promise<TransportResponse>;

/** Ports the Fetch standard blocks for http(s). fetch() refused them, so this does too. */
const BAD_PORTS = new Set([
  '1', '7', '9', '11', '13', '15', '17', '19', '20', '21', '22', '23', '25', '37', '42', '43', '53',
  '69', '77', '79', '87', '95', '101', '102', '103', '104', '109', '110', '111', '113', '115', '117',
  '119', '123', '135', '137', '139', '143', '161', '179', '389', '427', '465', '512', '513', '514',
  '515', '526', '530', '531', '532', '540', '548', '554', '556', '563', '587', '601', '636', '989',
  '990', '993', '995', '1719', '1720', '1723', '2049', '3659', '4045', '4190', '5060', '5061',
  '6000', '6566', '6665', '6666', '6667', '6668', '6669', '6679', '6697', '10080',
]);

/** Statuses whose fetch() Response has a null body. */
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/** fetch() refuses a response with more stacked content-codings than this. */
const MAX_CONTENT_ENCODINGS = 5;

function fetchFailed(cause: unknown): TypeError {
  return new TypeError('fetch failed', { cause });
}

// ---------------------------------------------------------------------------
// The pin
// ---------------------------------------------------------------------------

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A `lookup` for net/tls that never touches DNS: it answers `host` from the
 * validated list (filtered by the requested family) and refuses any other name.
 */
export function pinnedLookup(host: string, addresses: readonly PinnedAddress[]) {
  const pinned = addresses.map(({ address, family }) => ({ address, family }));
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    const want = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : (options.family ?? 0);
    const matches = hostname === host ? pinned.filter((a) => want === 0 || a.family === want) : [];
    process.nextTick(() => {
      if (matches.length === 0) {
        const err: NodeJS.ErrnoException = new Error(
          `pinned lookup: no validated ${want === 0 ? '' : `IPv${want} `}address for "${hostname}"`,
        );
        err.code = 'ENOTFOUND';
        callback(err, options.all === true ? [] : '');
      } else if (options.all === true) {
        callback(null, matches.map((a) => ({ address: a.address, family: a.family })));
      } else {
        callback(null, matches[0]!.address, matches[0]!.family);
      }
    });
  };
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/** The request headers Node's fetch() sends for a plain GET (Connection aside, see README). */
function requestHeaders(url: URL, isHttps: boolean): http.OutgoingHttpHeaders {
  return {
    host: url.host,
    accept: '*/*',
    'accept-language': '*',
    'sec-fetch-mode': 'cors',
    'user-agent': 'node',
    'accept-encoding': isHttps ? 'br, gzip, deflate' : 'gzip, deflate',
  };
}

/** One GET to `url` whose socket can reach only `init.addresses`. Never follows redirects. */
export function pinnedRequest(url: string, init: TransportInit): Promise<TransportResponse> {
  return new Promise<TransportResponse>((resolve, reject) => {
    // fetch()'s messages, except that the URL is redacted (gate G7, staged only):
    // fetch() repeats it whole, credentials included. Node's parse error is not
    // kept as the cause either, since its enumerable `input` is the raw URL.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new TypeError(`Failed to parse URL from ${redactUrl(url)}`));
      return;
    }
    if (parsed.username !== '' || parsed.password !== '') {
      reject(new TypeError(`Request cannot be constructed from a URL that includes credentials: ${redactUrl(url)}`));
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    if (!isHttps && parsed.protocol !== 'http:') {
      reject(fetchFailed(new Error('unknown scheme')));
      return;
    }
    if (BAD_PORTS.has(parsed.port)) {
      reject(fetchFailed(new Error('bad port')));
      return;
    }
    if (init.signal.aborted) {
      reject(init.signal.reason);
      return;
    }

    const host = parsed.hostname.startsWith('[') ? parsed.hostname.slice(1, -1) : parsed.hostname;
    const mod = isHttps ? https : http;
    // A fresh agent per request, never the global one: no pooled socket from
    // another hop or call can carry this request, and no proxy is used, since
    // an Agent proxies only when given proxyEnv (HTTP_PROXY, HTTPS_PROXY and
    // NODE_USE_ENV_PROXY are never read). A proxy would resolve the name itself.
    // rejectUnauthorized is explicit (pinning review PR-04, 2026-11-26): left
    // unset, Node takes it from NODE_TLS_REJECT_UNAUTHORIZED, and '0' there
    // turned certificate verification off for every request. It is set on the
    // agent too, because an agent's own options win over the request's.
    const agent = isHttps
      ? new https.Agent({ keepAlive: false, rejectUnauthorized: true })
      : new http.Agent({ keepAlive: false });
    const options: https.RequestOptions = {
      method: 'GET',
      host,
      port: parsed.port === '' ? undefined : Number(parsed.port),
      path: `${parsed.pathname}${parsed.search}`,
      headers: requestHeaders(parsed, isHttps),
      agent,
      lookup: pinnedLookup(host, init.addresses),
      signal: init.signal,
    };
    // SNI carries the name (never an IP literal, RFC 6066); certificate
    // verification is always on and checks the same name.
    if (isHttps) {
      options.rejectUnauthorized = true;
      if (net.isIP(host) === 0) options.servername = host;
    }

    let req: http.ClientRequest;
    try {
      req = mod.request(options);
    } catch (err) {
      agent.destroy();
      reject(fetchFailed(err));
      return;
    }
    let settled = false;
    req.on('error', (err) => {
      agent.destroy();
      if (settled) return;
      settled = true;
      reject(init.signal.aborted ? init.signal.reason : fetchFailed(err));
    });
    req.on('response', (res) => {
      if (settled) {
        res.destroy();
        return;
      }
      settled = true;
      try {
        resolve(toTransportResponse(res, () => { req.destroy(); agent.destroy(); }));
      } catch (err) {
        req.destroy();
        agent.destroy();
        reject(err);
      }
    });
    req.end();
  });
}

function toTransportResponse(res: http.IncomingMessage, release: () => void): TransportResponse {
  const status = res.statusCode ?? 0;
  const distinct = res.headersDistinct;
  const headers = {
    get: (name: string): string | null => distinct[name.toLowerCase()]?.join(', ') ?? null,
  };
  res.on('error', () => { /* surfaced through the body stream */ });
  if (NULL_BODY_STATUS.has(status)) {
    release();
    return { status, headers, body: null };
  }
  const decoders = contentDecoders(headers.get('content-encoding'));
  const source: Readable = decoders.length === 0
    ? res
    : (pipeline([res, ...decoders], () => { /* errors reach the last stream */ }) as Transform);
  return { status, headers, body: webBody(source, release) };
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/**
 * A pull-based web stream over a Node stream. A source that fails, or closes
 * before it ends, errors the stream with TypeError('terminated'), as undici
 * does. Cancelling destroys the source and the request.
 */
function webBody(source: Readable, release: () => void): ReadableStream<Uint8Array> {
  let done = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = (err?: unknown): void => {
        if (done) return;
        done = true;
        if (err === undefined) controller.close();
        else controller.error(new TypeError('terminated', { cause: err }));
        release();
      };
      source.on('data', (chunk: Buffer) => {
        if (done) return;
        controller.enqueue(chunk);
        if ((controller.desiredSize ?? 0) <= 0) source.pause();
      });
      source.on('end', () => finish());
      source.on('error', (err) => finish(err));
      source.on('close', () => finish(new Error('the response closed before the body ended')));
    },
    pull() {
      source.resume();
    },
    cancel() {
      done = true;
      source.destroy();
      release();
    },
  });
}

/**
 * Decoders for a Content-Encoding value, applied last-coding-first, the way
 * Node's fetch() decodes: gzip / x-gzip, deflate (zlib-wrapped or raw), br,
 * and zstd where zlib has it. An unknown coding leaves the body undecoded.
 * Streams are lenient about a truncated end (Z_SYNC_FLUSH), as fetch() is.
 * maxBytes in hardenedFetch counts the decoded bytes.
 */
function contentDecoders(contentEncoding: string | null): Transform[] {
  const codings = contentEncoding === null ? [] : contentEncoding.toLowerCase().split(',').map((c) => c.trim());
  if (codings.length > MAX_CONTENT_ENCODINGS) {
    throw fetchFailed(new Error(
      `too many content-encodings in response: ${codings.length}, maximum allowed is ${MAX_CONTENT_ENCODINGS}`,
    ));
  }
  const hasZstd = typeof zlib.createZstdDecompress === 'function';
  const known = (c: string): boolean => ['gzip', 'x-gzip', 'deflate', 'br'].includes(c) || (c === 'zstd' && hasZstd);
  if (!codings.every(known)) return [];
  const sync = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };
  return codings.reverse().map((coding): Transform => {
    switch (coding) {
      case 'gzip':
      case 'x-gzip':
        return zlib.createGunzip(sync);
      case 'deflate':
        return new DeflateDecoder(sync);
      case 'br':
        return zlib.createBrotliDecompress({
          flush: zlib.constants.BROTLI_OPERATION_FLUSH,
          finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
        });
      default:
        return zlib.createZstdDecompress({
          flush: zlib.constants.ZSTD_e_continue,
          finishFlush: zlib.constants.ZSTD_e_end,
        });
    }
  });
}

/**
 * `Content-Encoding: deflate` means zlib-wrapped data (RFC 9110), but some
 * servers send raw deflate. Choose from the first two bytes: a valid RFC 1950
 * header (CM = 8 and the FCHECK multiple of 31) means zlib, anything else raw.
 */
class DeflateDecoder extends Transform {
  readonly #options: zlib.ZlibOptions;
  #inner: zlib.Inflate | zlib.InflateRaw | undefined;
  #head: Buffer = Buffer.alloc(0);

  constructor(options: zlib.ZlibOptions) {
    super();
    this.#options = options;
  }

  #start(head: Buffer): zlib.Inflate | zlib.InflateRaw {
    const zlibHeader = head.length >= 2 && (head[0]! & 0x0f) === 8 && ((head[0]! << 8) | head[1]!) % 31 === 0;
    const inner = zlibHeader ? zlib.createInflate(this.#options) : zlib.createInflateRaw(this.#options);
    // Backpressure: a full outer buffer pauses the inflater, which then stops
    // inflating (zlib checks its own buffer), so a deflate bomb is not
    // expanded ahead of the reader. _read() resumes it.
    inner.on('data', (chunk: Buffer) => { if (!this.push(chunk)) inner.pause(); });
    inner.on('error', (err) => this.destroy(err));
    this.#inner = inner;
    return inner;
  }

  override _read(size: number): void {
    this.#inner?.resume();
    super._read(size);
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.#inner !== undefined) {
      this.#inner.write(chunk, () => callback());
      return;
    }
    const head = Buffer.concat([this.#head, chunk]);
    if (head.length < 2) {
      this.#head = head;
      callback();
      return;
    }
    this.#head = Buffer.alloc(0);
    this.#start(head).write(head, () => callback());
  }

  override _flush(callback: TransformCallback): void {
    let inner = this.#inner;
    if (inner === undefined) {
      if (this.#head.length === 0) {
        callback();
        return;
      }
      inner = this.#start(this.#head);  // a one-byte body
      inner.write(this.#head);
    }
    inner.once('end', () => callback());
    inner.end();
  }

  override _destroy(err: Error | null, callback: (error?: Error | null) => void): void {
    this.#inner?.destroy();
    callback(err);
  }
}

/** The seam hardenedFetch calls. Tests replace `request`; it is not part of the package API. */
export const transport: { request: Transport } = { request: pinnedRequest };
