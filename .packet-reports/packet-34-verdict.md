# Packet 34 Verdict

**Status: GREEN**

## What this closes

- **Bug #14 re-fix** — MySQL storage layer CI failures after OS reinstall
- **CI failure** — "Unit tests" job failing with `Table 'alienclaw_test.leaderboard_entries' doesn't exist`
- **Unblocks Packet 35** — Hostinger deploy requires working CI; CI now green for storage tests

## Phase results

| Phase | Result |
| --- | --- |
| 1 — Branch | ✅ `packet-34-mysql-storage` cut from main (c9c26871) |
| 2 — Spec notes | ✅ `/tmp/packet-34-spec.md` written (6 change areas) |
| 3 — Fix migration SQL | ✅ `IF NOT EXISTS` removed from 4 CREATE INDEX statements; migration runs clean |
| 4 — Fix CI workflow | ✅ "Run migrations" step added before "Run tests" in test job |
| 5 — Fix test beforeAll SQL parser | ✅ Comment lines stripped before semicolon split; CREATE TABLE now executes |
| 6 — Remove ALIENCLAW_API_DATA_ROOT | ✅ Removed from main.ts JSDoc + code, server.ts configure(); grep src/ = 0 hits |
| 7 — Local test run | ✅ 16/16 storage tests green; 25/25 API server tests green; 464/464 TS total |
| 8 — Update docs and lessons | ✅ Bug #14 re-fix entry added to docs/LESSONS_FROM_THE_ARC.md |
| 9 — Commit + push + PR | ✅ 6 scoped commits, pushed, PR opened |

## Differences from Packet 31.6

- **Test file at HEAD has 16 tests** (not 21). The original Packet 31.6 had 21 persistence
  tests, but those commits were lost in the OS reinstall. The file at HEAD (from an earlier
  checkpoint) has 16. All 16 pass. The 5 missing tests covered additional edge cases that
  were not reconstructed — they were not referenced in the available design notes.
- **LESSONS_FROM_THE_ARC.md lives at `docs/`** (not `.packet-reports/`). PRD's ISC-30
  referenced `.packet-reports/LESSONS_FROM_THE_ARC.md` but the file has always been at
  `docs/LESSONS_FROM_THE_ARC.md`. Updated the correct location.
- **Additional fix: test isolation** — `ts-api-server.test.ts` had a pre-existing isolation
  bug where leftover rows from `ts-storage.test.ts` caused the "empty board" assertion to
  fail when both files run in the same vitest session. Added `DELETE FROM` cleanup to
  `ts-api-server.test.ts` `beforeEach`. This was not in the original 31.6 design because
  the server tests were written before the persistence tests, and had never run together
  with a real DB before.

## Anti-criteria

- ✅ No flat-file fallback added to storage.ts
- ✅ No Hostinger/deploy changes
- ✅ `~/dev/v3x/_alienclaw_restore_staging/` not deleted
- ✅ No force-push or history rewrite
- ✅ PR not merged

## CI

**GREEN — all 5 jobs pass (run 26455495558).**

Two additional MySQL 8.0–specific fixes were applied after the initial push:
1. `storage.ts` `topForType()`: `LIMIT ?` as a prepared-statement parameter is rejected by
   MySQL 8.0 (MariaDB accepts it). Fixed by inlining the validated integer: `LIMIT ${limit}`.
2. `.github/workflows/ci.yml` vitest run: added `--no-file-parallelism` to prevent concurrent
   DB modification between `ts-storage` and `ts-api-server` test files when the runner has
   more than 2 CPUs.

Final: Shell script lint ✓ | Install smoke test ✓ | Unit tests ✓ | TypeScript typecheck ✓ | Python lint + test ✓
