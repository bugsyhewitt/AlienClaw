---
task: Execute P2 API and leaderboard hardening packet
slug: 20260908-000000_p2-api-leaderboard
effort: comprehensive
phase: build
progress: 0/43
mode: interactive
started: 2026-09-08T00:00:00Z
updated: 2026-09-08T00:00:00Z
---

## Context

AlienClaw P2 — API & Leaderboard Hardening (LAUNCH BLOCKER, branch `feat/p2-api-leaderboard`).
Builds on P0 audit findings and P1's hardened-fetch. Full packet T1–T12. Single PR.

The API already has: single pool, byte-accurate body cap, structured error envelope, per-install token
bucket, /v1/health stub. This packet is additive hardening + verified split + Ed25519 identity +
migration runner.

### Risks
- server.ts + storage.ts + handlers/genomes.ts touched by multiple groups — implement in dependency order
- T9 (Ed25519) changes wire contract — add fields additively, gate enforcement behind flag
- Only one production board row — treat as production data; all migrations additive only

## Criteria

### Group A — Crash-proofing (T1)
- [ ] ISC-1: `main.ts` has `process.on('unhandledRejection')` handler that logs structured JSON
- [ ] ISC-2: `main.ts` has `process.on('uncaughtException')` handler that logs structured JSON
- [ ] ISC-3: Both handlers attempt graceful `server.close()` before any exit
- [ ] ISC-4: Both handlers exit non-zero only when `ALIENCLAW_EXIT_ON_FATAL=1` is set
- [ ] ISC-5: Default (no env var) keeps serving after a throwing handler — test proves it
- [ ] ISC-6: `POST /__diag/crash` route exists and throws (guarded by `ALIENCLAW_DIAG_TOKEN`)
- [ ] ISC-7: `/__diag/crash` is unreachable (404/disabled) when `ALIENCLAW_DIAG_TOKEN` is unset

### Group B — Pool hardening (T2)
- [ ] ISC-8: `initPool` passes `connectionLimit` (default 8, env `ALIENCLAW_DB_POOL_MAX`) to `createPool`
- [ ] ISC-9: `initPool` passes `idleTimeout: 60_000` and `enableKeepAlive: true`
- [ ] ISC-10: `initPool` passes `queueLimit: 50` (fail fast over queuing forever)
- [ ] ISC-11: `poolStats()` exported from storage.ts for use by `/v1/health`
- [ ] ISC-12: Test: N concurrent queries never exceed connectionLimit

### Group C — Read cache (T3)
- [ ] ISC-13: `cache.ts` implements in-process TTL cache (default 10s, `ALIENCLAW_BOARD_CACHE_TTL_MS`)
- [ ] ISC-14: Cache key includes martian_type and n
- [ ] ISC-15: `/v1/genomes/top` response includes `Cache-Control: public, max-age=10, stale-while-revalidate=60`
- [ ] ISC-16: `/v1/genomes/top` response includes strong `ETag` header
- [ ] ISC-17: `If-None-Match` matching the ETag returns 304
- [ ] ISC-18: Test: 100 reads inside one TTL window hit the database exactly once

### Group D — IP derivation & rate limits (T6)
- [ ] ISC-19: `client-ip.ts` derives client IP from right side of XFF by `ALIENCLAW_XFF_HOPS` (default 1)
- [ ] ISC-20: IP derivation falls back to `req.socket.remoteAddress` on invalid XFF
- [ ] ISC-21: Spoofed XFF entries on the left do not change the derived key
- [ ] ISC-22: Submission IP bucket: 10/hr per IP (`ALIENCLAW_RATE_SUBMIT_PER_HOUR`), 429 + Retry-After
- [ ] ISC-23: Read IP bucket: 120/min per IP (`ALIENCLAW_RATE_READ_PER_MIN`), 429 + Retry-After
- [ ] ISC-24: LRU eviction under many distinct IPs (bounded map)
- [ ] ISC-25: `GET /__diag/whoami` returns raw XFF, derived IP, hop index (token-guarded)

### Group B/D — Server hygiene (T4)
- [ ] ISC-26: Non-JSON Content-Type on POST routes returns 415
- [ ] ISC-27: `server.headersTimeout`, `requestTimeout`, `keepAliveTimeout` set on the server instance
- [ ] ISC-28: Wrong method on a known route returns 405 with JSON error envelope
- [ ] ISC-29: `GET /` returns a small JSON index (routes, version) — no longer 404

### Group E — Data correctness (T7, T8, T11)
- [ ] ISC-30: `migrate.ts` runs pending migrations in filename order inside `GET_LOCK`
- [ ] ISC-31: Migration runner is idempotent: running twice applies each file once
- [ ] ISC-32: `004_verified_fitness.sql` adds nullable `verified_fitness`, `verified_at`, version columns — additive only
- [ ] ISC-33: `004_verified_fitness.sql` adds `genome_id` column (SHA-256 hex of genome)
- [ ] ISC-34: Unique key `(leaderboard_name, genome_id)` enforced in migration 004
- [ ] ISC-35: `SubmissionStore.save` uses `INSERT … ON DUPLICATE KEY UPDATE` (single statement)
- [ ] ISC-36: Test: 100 concurrent identical submissions → exactly one row
- [ ] ISC-37: Ranking orders by `verified_fitness` where present; unverified rows in separate section with `verified: false`
- [ ] ISC-38: Test: fabricated 1.0 client fitness never appears in the ranked section

### Group F — Ed25519 Identity (T9)
- [ ] ISC-39: Ed25519 keypair generated at install, stored 0600, private key never transmitted
- [ ] ISC-40: Submission payload extended with `pubkey`, `nonce`, `timestamp`, `signature` (additive)
- [ ] ISC-41: Server: first submission registers `(name, pubkey)` in `identities` table (TOFU)
- [ ] ISC-42: Server: subsequent submissions with wrong key return 403

### Group G — Health & Sync (T5, T10)
- [ ] ISC-43: `/v1/health` returns `{ok, sha, builtAt, node, pid, uptimeSec, db:"ok"|"fail", pool:{…}, version}`

## Decisions

## Verification
