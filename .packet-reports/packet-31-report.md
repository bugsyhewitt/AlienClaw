# Packet 31 — Leaderboard Backend — Report

**Date:** 2026-05-17
**Starting commit:** 7a3e3d9e
**Type:** Implementation (L5 code complete, deployment pending)

---

## What this packet built

1. **leaderboard_name field** (^[A-Z]{8}$) throughout the API:
   - SubmissionRequest dataclass
   - validation.py: MISSING/INVALID_LEADERBOARD_NAME errors
   - storage.py: persists with each submission
   - GenomeEntry: returned in GET /v1/genomes/top
   - 4 new validation tests + 13 updated existing tests

2. **CreatorBot leaderboard_check** (`governance/common/leaderboard.ts`):
   - leaderboardCheck(): pull-only, hardened fetch, strict validation, file-mediated
   - hardenedFetch(): timeout + size cap
   - validateLeaderboardResponse(): whitelist validation, injection rejection
   - submitFromFile(): separate explicit submission step
   - validateLeaderboardName(): ^[A-Z]{8}$ enforcement
   - 21 tests

3. **MySQL schema**: `migrations/001_leaderboard.sql` with CHECK constraints

4. **Leaderboard UI**: `site/leaderboard.html` fetches live data, shows
   leaderboard_name column, handles empty state

5. **Trust model**: `packet-31-trust-model.md` documents 5 guarantees with
   code citations

6. **Hostinger audit**: MySQL confirmed on plan; deployment steps documented

---

## Commit

`360e6b97` — leaderboard: name field, CreatorBot check, MySQL schema, UI (Packet 31)

CI: SUCCESS on this commit.

---

## L5 status

PARTIAL — code complete, CI green. Deployment requires Bugsy executing
packet-31-deployment.md (Hostinger MySQL setup + API deploy + DNS).

---

## What this packet did NOT do

- Deploy the API (requires Bugsy's Hostinger access)
- Server-side genome re-verification (deferred)
- MySQL storage backend (flat-file storage used for v1)
