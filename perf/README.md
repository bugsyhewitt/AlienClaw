# P2 Load-Test Runbook

These k6 scripts exercise the AlienClaw community API at ramp-to-200 VU load.

## NEVER run against production

Running these scripts against the live `api.alienclaw.net` is a **Bugsy decision only**.
The reason: Hostinger Business has an unpublished CPU fair-use quota; breaching it
causes 503s for real users and may trigger account review. Support declines to state
the limit.

## Prerequisites

- [k6](https://k6.io/docs/getting-started/installation/) installed
- A **staging** MySQL slot (separate from `u881291242_leaderboard`)
- A valid API key registered on the staging instance
- hPanel open with CPU, RAM, and I/O graphs visible before you start

## Run against staging

```bash
# Board reads (anonymous, no API key needed)
BASE_URL=https://staging.alienclaw.net k6 run perf/k6/board-read.js

# Genome submissions (requires a registered API key)
BASE_URL=https://staging.alienclaw.net \
  API_KEY=<43-char-base62> \
  BOARD_NAME=LOADTEST \
  k6 run perf/k6/submit.js
```

## Stopping rule

Stop immediately if **any** of the following occur:

- hPanel CPU graph shows sustained >80% for more than 60 seconds
- k6 error rate climbs above 2%
- Any 503 responses appear in k6 output

Hostinger's CPU quota is unpublished. A sustained CPU spike during a test
indicates you are approaching the fair-use boundary. Stop and wait 10 minutes
before retrying at a lower VU count.

## After running

Record the following and update this README with results:

| Field            | Value |
|------------------|-------|
| Date             |       |
| Staging slot     |       |
| Peak VU count    |       |
| p95 latency (ms) |       |
| Error rate       |       |
| CPU high-water   |       |

## For P3

P3 should run these scripts on the Hostinger staging slot to:

1. Measure actual XFF hop count — compare `/__diag/whoami` output to
   determine the correct value for `ALIENCLAW_XFF_HOPS` (default 1).
2. Confirm restart behaviour via `/__diag/crash` (requires `ALIENCLAW_DIAG_TOKEN` set).
3. Establish p95 baseline before launch and record it in this README.

## Environment variables

| Variable                        | Default                    | Used by    |
|---------------------------------|----------------------------|------------|
| `BASE_URL`                      | `http://localhost:8080`    | both       |
| `API_KEY`                       | `test-api-key-42chars-...` | submit.js  |
| `BOARD_NAME`                    | `TESTLOAD`                 | submit.js  |
| `ALIENCLAW_XFF_HOPS`            | `1`                        | API server |
| `ALIENCLAW_BOARD_CACHE_TTL_MS`  | `10000`                    | API server |
| `ALIENCLAW_IDENTITY_REQUIRED`   | (unset = off)              | API server |
| `ALIENCLAW_RUN_MIGRATIONS`      | (unset = off)              | API server |
