---
task: Packet 31.6 MySQL storage layer fix bug 14 port drift
slug: 20260517-100000_packet-31.6-mysql-storage
effort: advanced
phase: verify
progress: 40/40
mode: interactive
started: 2026-05-17T10:00:00Z
updated: 2026-05-17T16:00:00Z
---

## Context

Bug #14: Packet 31.5 ported storage backend from MySQL to flat files silently.
The 25 HTTP-level equivalence tests passed because they didn't assert where data
landed. storage.ts has a false comment promising a MySQL path that doesn't exist.
Fix: MySQL-only storage for all three stores (SubmissionStore, InstallStore,
GlobalStats). Flat-file code removed. Migration extended. Persistence-asserting
tests that query MySQL directly. Deployment doc corrected.

Implementation complete in commit 3891895a (local, ahead of origin/main by 1).
Two artifacts (install-audit.md, verdict.md) added in a follow-up commit.

## Criteria

### Pre-flight
- [x] ISC-1: Starting commit recorded, working tree clean, CI green
- [x] ISC-2: Backup taken
- [x] ISC-3: packet-31.6-bug-14.md produced
- [x] ISC-4: packet-31.6-storage-plan.md produced

### Migration
- [x] ISC-5: migrations/001_leaderboard.sql extended to cover submissions table
- [x] ISC-6: migrations/001_leaderboard.sql covers installs table
- [x] ISC-7: GlobalStats derived via SQL aggregates (no mutable row)
- [x] ISC-8: ^[A-Z]{8}$ CHECK constraint retained on leaderboard_name
- [x] ISC-9: Fitness range CHECK constraint retained

### storage.ts rewrite
- [x] ISC-10: ALIENCLAW_DB_URL wires the MySQL connection pool
- [x] ISC-11: Missing ALIENCLAW_DB_URL → fail-fast at startup with clear error
- [x] ISC-12: Unreachable DB → fail-fast (no silent fallback)
- [x] ISC-13: SubmissionStore.save uses parameterized MySQL INSERT
- [x] ISC-14: SubmissionStore.topForType uses parameterized SELECT
- [x] ISC-15: SubmissionStore.rankForFitness uses parameterized COUNT
- [x] ISC-16: SubmissionStore.isNewTop uses parameterized MAX
- [x] ISC-17: SubmissionStore.findDuplicate uses parameterized SELECT
- [x] ISC-18: InstallStore.register uses parameterized INSERT
- [x] ISC-19: InstallStore.exists uses parameterized SELECT
- [x] ISC-20: InstallStore.count uses SELECT COUNT(*)
- [x] ISC-21: GlobalStats.get derives all values via SQL aggregates
- [x] ISC-22: All flat-file code (atomicWrite, dataRoot, node:fs helpers) removed
- [x] ISC-23: False "If ALIENCLAW_DB_URL is set..." comment removed
- [x] ISC-24: No `any` in storage.ts; tsc strict clean

### mysql2 dependency
- [x] ISC-25: mysql2 added to package.json dependencies

### Persistence-asserting tests
- [x] ISC-26: test queries MySQL directly after save() to confirm row exists
- [x] ISC-27: test queries MySQL after register() to confirm install row exists
- [x] ISC-28: test confirms GlobalStats.get() returns correct aggregated values
- [x] ISC-29: test confirms fail-fast on missing ALIENCLAW_DB_URL
- [x] ISC-30: CI workflow has MySQL service container for storage tests

### Deployment doc + install audit
- [x] ISC-31: packet-31.5-manual-steps.md corrected (ALIENCLAW_DB_URL documented)
- [x] ISC-32: .env.example documents ALIENCLAW_DB_URL
- [x] ISC-33: packet-31.6-install-audit.md confirms operator install is DB-free
- [x] ISC-34: README has no instruction asking operators to set up a database

### Final artifacts
- [x] ISC-35: packet-31.6-verdict.md
- [x] ISC-36: packet-31.6-report.md
- [x] ISC-37: packet-31.6-bugs.md
- [x] ISC-38: packet-31.6-deferred.md
- [x] ISC-39: packet-31.6-defaults.md
- [x] ISC-40: docs/LESSONS_FROM_THE_ARC.md updated with bug #14

### Anti-criteria
- [x] ISC-A1: No flat-file fallback — MySQL-only; API fails fast if DB unreachable
- [x] ISC-A2: No string-concatenated SQL — parameterized queries only
- [x] ISC-A3: No MySQL credentials committed
- [x] ISC-A4: CreatorBot leaderboard_check and operator-side storage untouched

## Decisions

- GlobalStats uses derived SQL aggregates (COUNT/MAX/GROUP BY), not a mutable singleton row. Derived stats cannot drift from reality.
- mysql2/promise (pool pattern) chosen; pool injected via constructor for test isolation.
- installs table keyed on api_key_hash UNIQUE — one install per API key; register() returns existing id on second call.

## Verification

- tsc --noEmit: clean (verified 2026-05-17)
- 21 persistence-asserting tests in test/api/ts-storage.test.ts: each queries MySQL directly
- CI workflow ci.yml: mysql:8.0 service container, ALIENCLAW_TEST_DB_URL set on test step
- storage.ts: no node:fs imports, no flat-file helpers, no false comment
- migrations/001_leaderboard.sql: leaderboard_entries + installs tables, both CHECK constraints
- README.md: no operator database instructions (grep confirmed)
- install.sh: no database references (grep confirmed)
- packet-31.6-install-audit.md: confirms operator install is DB-free
- packet-31.6-verdict.md: L5 deployment readiness confirmed
