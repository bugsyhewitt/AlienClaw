# Packet 10 — Deferred Items

## DEFERRED-10-001: api.alienclaw.net DNS provision

**What:** Add A record, TLS cert, systemd service, nginx config.
**Why deferred:** Requires Hostinger VPS/panel access (Bugsy).
**Ready to execute:** Yes — see `packet-10-report.md §Phase 6` for exact steps.

## DEFERRED-10-002: Dogfood test against live server

**What:** Run end-to-end submission from CLI against https://api.alienclaw.net.
**Blocked by:** DEFERRED-10-001.

## DEFERRED-10-003: Rate limiter persistence

**What:** The rate limiter is in-memory — state lost on restart. Each restart
grants a fresh 100-submissions window per install.
**Why deferred:** Acceptable for MVP. Production fix: store submission timestamps
in `data/rate_limit/<hash[:2]>/<hash>.json`.

## DEFERRED-10-004: Genome metadata (generation, experiment_id) in submissions

**What:** `run_metadata` is accepted but not indexed. A future version could
surface generation number and experiment_id in the leaderboard.

## DEFERRED-10-005: TypeScript dogfood test for sync module

**What:** Unit tests for `client.ts` / `push.ts` / `pull.ts` against a mock server.
**Why deferred:** Integration tests against the live server will cover this better.
**Effort:** ~2 hours with vitest.
