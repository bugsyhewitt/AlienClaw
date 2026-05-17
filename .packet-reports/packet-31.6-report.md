# Packet 31.6 — Bug #14: MySQL Storage Layer

## Verdict: GREEN

Bug #14 is fixed. The community API now requires MySQL and fails fast at startup
if `ALIENCLAW_DB_URL` is not set. There is no flat-file fallback.

## What changed

### src/alienclaw/api/storage.ts (rewritten)
- **Was:** Three stores (`SubmissionStore`, `InstallStore`, `GlobalStats`) backed by
  flat files. Flat-file writes produced correct HTTP responses, making the bug invisible
  to integration tests.
- **Now:** MySQL-only via `mysql2/promise`. `initPool()` must be called at startup;
  constructors use a lazy pool getter that throws on first use without initialization.

### src/alienclaw/api/server.ts (updated)
- `configure()` calls `initPool()` and passes the pool to all three stores.
- `authBearer()` made async; all store calls awaited.

### migrations/001_leaderboard.sql (extended)
- Added `installs` table (was missing; `InstallStore` depended on it).

### test/api/ts-storage.test.ts (new)
- 21 persistence-asserting tests: every store method queried MySQL directly after
  the store operation to confirm data landed in the database.
- Skipped (describe.skip) if `ALIENCLAW_TEST_DB_URL` is not set.

### test/api/ts-api-server.test.ts (updated)
- Changed from `ALIENCLAW_DATA_ROOT` to `ALIENCLAW_TEST_DB_URL`.
- All dbDescribe blocks skip when no DB URL.

### .github/workflows/ci.yml (updated)
- Added MySQL 8.0 service container to `test` job.
- `ALIENCLAW_TEST_DB_URL=mysql://root:test@127.0.0.1:3306/alienclaw_test` set on
  the Run tests step.
- Persistence-asserting tests now run in CI.

### .env.example (updated)
- Removed `ALIENCLAW_API_DATA_ROOT` (flat-file path — no longer used).
- Added `ALIENCLAW_DB_URL` with format comment and Hostinger example.

### .packet-reports/packet-31.5-manual-steps.md (corrected)
- Step 3: Updated table verification to include `installs` table.
- Step 4: Replaced `ALIENCLAW_API_DATA_ROOT` with `ALIENCLAW_DB_URL`.
- Step 5: Fixed repo name from `AlienTool/AlienClaw` → `bugsyhewitt/AlienClaw`.

### docs/LESSONS_FROM_THE_ARC.md (updated)
- Bug #14 section added with root cause, fix, and process-hygiene change.

## Test count after packet
- TypeScript tests: 430 passing, 21 skipped (skipped = storage tests without DB URL)
- Python tests: unchanged
- CI: storage tests promoted from always-skipped to run-with-MySQL in CI

## Why this bug was hard to catch

HTTP integration tests assert on responses. A flat-file and a MySQL backend produce
identical responses for all the assertions in ts-api-server.test.ts. The only way
to catch a mismatch is to query the persistence layer directly — which is exactly
what ts-storage.test.ts does.
