// k6 load test for POST /v1/genomes
//
// NEVER run against production (api.alienclaw.net).
// Staging only, off-peak.  See perf/README.md for the full runbook.
//
// Note: real client submissions must be Ed25519-signed (T9).  This script
// submits unsigned payloads to exercise the rate-limit / storage paths.
// Identity signature verification is gated by ALIENCLAW_IDENTITY_REQUIRED
// (default off), so unsigned submissions are accepted on staging when that
// flag is not set.
import http     from 'k6/http';
import { check, sleep } from 'k6';
import { crypto }       from 'k6/experimental/webcrypto';

const BASE_URL   = __ENV.BASE_URL   || 'http://localhost:8080';
const API_KEY    = __ENV.API_KEY    || 'test-api-key-42chars-padded-here12345678901';
const BOARD_NAME = __ENV.BOARD_NAME || 'TESTLOAD';

export const options = {
  stages: [
    { duration: '1m', target: 20 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0  },
  ],
  thresholds: {
    http_req_duration:    ['p(95)<300'],
    http_req_failed:      ['rate<0.01'],
    'checks{name:no5xx}': ['rate>0.99'],
  },
};

const TYPES = ['compute', 'http_get', 'search_text'];
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Return `bytes` random bytes as a lowercase hex string. */
function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a 256-char Base62 genome (matches locked genome spec). */
function randomGenome() {
  const buf = new Uint8Array(256);
  crypto.getRandomValues(buf);
  let g = '';
  for (let i = 0; i < 256; i++) {
    g += BASE62[buf[i] % 62];
  }
  return g;
}

export default function () {
  const type    = TYPES[Math.floor(Math.random() * TYPES.length)];
  const fitness = Math.random();
  const genome  = randomGenome();
  const nonce   = randomHex(16);        // 32 hex chars
  const ts      = new Date().toISOString();

  const payload = JSON.stringify({
    genome,
    martian_type:     type,
    fitness,
    leaderboard_name: BOARD_NAME,
    run_metadata:     { load_test: true },
    nonce,
    timestamp:        ts,
  });

  const res = http.post(`${BASE_URL}/v1/genomes`, payload, {
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
  });

  check(res, {
    'created or dup': r => r.status === 201 || r.status === 200 || r.status === 429,
    'no5xx':          r => r.status < 500,
  });

  // 5 % of iterations also fire a deliberately invalid request to exercise
  // the 415 rejection path.
  if (Math.random() < 0.05) {
    const bad = http.post(`${BASE_URL}/v1/genomes`, 'plain text body', {
      headers: {
        'Content-Type':  'text/plain',
        'Authorization': `Bearer ${API_KEY}`,
      },
    });
    check(bad, {
      'invalid content-type gets 415': r => r.status === 415,
    });
  }

  sleep(Math.random() * 1.0);
}
