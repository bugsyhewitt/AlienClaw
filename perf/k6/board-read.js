// k6 load test for GET /v1/genomes/top
//
// NEVER run against production (api.alienclaw.net).
// Staging only, off-peak, one IP, hPanel CPU graph open.
// See perf/README.md for the full runbook and stopping rules.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  stages: [
    { duration: '1m', target: 50  },   // ramp up to 50 VUs
    { duration: '3m', target: 200 },   // hold at 200 VUs
    { duration: '1m', target: 0   },   // ramp down
  ],
  thresholds: {
    http_req_duration:    ['p(95)<300'],
    http_req_failed:      ['rate<0.01'],
    // Ensure virtually zero 5xx responses
    'checks{name:no5xx}': ['rate>0.99'],
  },
};

const TYPES = ['compute', 'http_get', 'search_text', 'url_fetch', 'extract_json'];

export default function () {
  const type = TYPES[Math.floor(Math.random() * TYPES.length)];
  const n    = Math.floor(Math.random() * 10) + 1;
  const res  = http.get(`${BASE_URL}/v1/genomes/top?martian_type=${type}&n=${n}`);

  check(res, {
    'status 200 or 304': r => r.status === 200 || r.status === 304,
    'no5xx':             r => r.status < 500,
    'has json body':     r => r.status === 304 || r.json() !== null,
  });

  sleep(Math.random() * 0.5);
}
