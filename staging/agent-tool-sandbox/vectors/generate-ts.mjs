#!/usr/bin/env node
/**
 * TS half of the vector generator: runs @v3x/hardened-fetch on every vector in
 * ssrf-vectors.json and prints {"node": <version>, "verdicts": {<id>: {verdict, reason}}}
 * as JSON on stdout. It never writes the corpus; generate.py does.
 *
 *   node_modules/.bin/tsx generate-ts.mjs [path/to/ssrf-vectors.json]
 *
 * tsx is needed because the package ships TypeScript source.
 *
 * Network-free, and independent of which HTTP transport the package uses
 * (global fetch/undici before connection pinning, node:http(s) after):
 *   - node:dns/promises.lookup is replaced before the package is imported
 *     (syncBuiltinESMExports pushes the replacement into the ESM namespace
 *     that `import * as dns from 'node:dns/promises'` sees);
 *   - net.Socket.prototype.connect is replaced by a tripwire that records the
 *     attempt and destroys the socket before any packet is sent. Every Node
 *     TCP/TLS client (http, https, tls, undici) dials through it.
 *
 * Harness semantics (same as ts/test/shared-vectors.test.ts and README.md):
 *   level "url": hardenedFetch(input, POLICY). lookup answers an IP literal
 *     with itself (what Node's dns.lookup does), never resolves a bracketed
 *     name (real getaddrinfo cannot), and answers every other name with
 *     resolves_to (ENOTFOUND if absent).
 *     "allow" = the package opened a socket (the request would have left the
 *     host); "block" = hardenedFetch rejected before any connect.
 *   level "ip": validateResolvedAddresses([{ address: input, family: isIP(input) }]).
 */

import { readFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import * as net from 'node:net';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const corpusPath = process.argv[2] ?? fileURLToPath(new URL('./ssrf-vectors.json', import.meta.url));
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));

const POLICY = { timeoutMs: 5_000, maxBytes: 64 * 1024 };

let currentAnswers;  // resolves_to of the vector being run
let connects = [];   // socket connects attempted while running it

function fakeLookupAnswers(hostname, resolvesTo) {
  const family = net.isIP(hostname);
  if (family !== 0) return [{ address: hostname, family }];
  if (hostname.startsWith('[') || resolvesTo === undefined) {
    const err = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
    err.code = 'ENOTFOUND';
    throw err;
  }
  return resolvesTo.map((address) => ({ address, family: net.isIP(address) }));
}

const dnsPromises = require('node:dns/promises');
dnsPromises.lookup = async (hostname) => fakeLookupAnswers(hostname, currentAnswers);
syncBuiltinESMExports();

net.Socket.prototype.connect = function tripwire(...args) {
  // Node's own callers pass one normalized [options, callback] array.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const opts = typeof first === 'object' && first !== null ? first : { port: first, host: args[1] };
  connects.push(`${opts.host ?? opts.path}:${opts.port}`);
  process.nextTick(() => this.destroy(new Error('connect blocked by the vector harness')));
  return this;
};

const { hardenedFetch, validateResolvedAddresses } =
  await import(new URL('../ts/src/index.ts', import.meta.url).href);

async function tsVerdict(vector) {
  if (vector.level === 'ip') {
    try {
      validateResolvedAddresses([{ address: vector.input, family: net.isIP(vector.input) }]);
      return { verdict: 'allow', reason: 'every resolved address passed' };
    } catch (err) {
      return { verdict: 'block', reason: err.message };
    }
  }
  currentAnswers = vector.resolves_to;
  connects = [];
  let outcome;
  try {
    await hardenedFetch(vector.input, POLICY);
    outcome = 'resolved';
  } catch (err) {
    outcome = err.message;
  }
  if (connects.length > 0) return { verdict: 'allow', reason: `connect to ${connects.join(', ')}` };
  if (outcome === 'resolved') return { verdict: 'error', reason: 'resolved without a connect' };
  return { verdict: 'block', reason: outcome };
}

const verdicts = {};
for (const vector of corpus.vectors) {
  verdicts[vector.id] = await tsVerdict(vector);
}
process.stdout.write(`${JSON.stringify({ node: process.version, verdicts })}\n`);
