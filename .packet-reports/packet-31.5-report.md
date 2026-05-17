# Packet 31.5 — Port Leaderboard API to TypeScript — Report

**Date:** 2026-05-17
**Starting commit:** 88b62cdf
**Type:** Port + cleanup + deployment prep

---

## What this packet did

Ported the AlienClaw community API from Python to TypeScript for deployment
on Hostinger's Node.js slot. Python API removed. Codebase is now TS-only
for the API server.

---

## Commits

| Commit | Description |
|--------|-------------|
| 0e1b85a3 | leaderboard: port Python API to TypeScript, add start script |
| e1f3de9a | ci: remove Python API tests, update CI |

CI: GREEN on e1f3de9a (all jobs pass).

---

## Key results

- TypeScript API: 13 source files, 25 integration tests
- Python API: fully removed (15 source + 5 test files deleted)
- Behavioral equivalence: 25 shared test cases, all MATCH
- Known difference: genome checksum validation not ported (documented)
- package.json: tsx added as dependency, npm start script added
- CI: Python API test step removed; vitest covers API tests

---

## Deployment status

PENDING — Bugsy needs to execute packet-31.5-manual-steps.md. Steps:
1. Create MySQL DB on Hostinger
2. Run migration
3. Set env vars
4. Deploy npm start to Node slot
5. Wire DNS

L5 closes when api.alienclaw.net is live.

---

## What this packet did NOT do

- Deploy the API (Hostinger manual steps required)
- Implement MySQL storage backend (flat-file storage ported; MySQL is opt-in)
- Server-side genome re-verification (still deferred)
- README onboarding polish beyond Python reference correction (Packet 32)
