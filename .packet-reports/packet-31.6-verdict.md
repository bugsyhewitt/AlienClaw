# Packet 31.6 — Verdict

## Bug #14 status: FIXED

Bug #14 (storage-backend port drift) is resolved. `storage.ts` is MySQL-backed.
The flat-file port-drift code is gone. The false comment is gone.

## Storage layer

| Store          | Backend   | Status   |
|----------------|-----------|----------|
| SubmissionStore | MySQL     | ✅ Done  |
| InstallStore    | MySQL     | ✅ Done  |
| GlobalStats     | Derived (SQL aggregates) | ✅ Done |

- **Connection:** `initPool(process.env.ALIENCLAW_DB_URL)` called at startup from `server.ts`
- **Fail-fast:** missing or unset `ALIENCLAW_DB_URL` throws immediately with a clear error
- **No silent fallback:** flat-file code removed entirely
- **Parameterized queries:** all SQL uses `pool.execute(sql, params)` — no string concatenation
- **Type safety:** tsc strict mode; no `any` in store or query code

## Migration

`migrations/001_leaderboard.sql` covers all three server stores:
- `leaderboard_entries` — genome submissions (was present, retained + extended)
- `installs` — operator installs (added in this packet)
- GlobalStats — derived at query time; no mutable row needed

Constraints: `^[A-Z]{8}$` CHECK on `leaderboard_name`; `[0, 1]` CHECK on `fitness`.

## Persistence-asserting tests

`test/api/ts-storage.test.ts` — 21 tests that query MySQL directly after each store
operation to confirm data physically landed. This applies the bug #14 lesson: HTTP-layer
assertions alone cannot detect persistence-backend drift.

CI MySQL service container (`mysql:8.0`) runs these tests on every push. The gap
that let bug #14 through is closed.

## Deployment doc

`packet-31.5-manual-steps.md` corrected:
- Step 3: both `leaderboard_entries` and `installs` tables verified after migration
- Step 4: `ALIENCLAW_DB_URL` documented as the server connection string (replaces stale `ALIENCLAW_API_DATA_ROOT`)
- Step 5: GitHub repo name fixed to `bugsyhewitt/AlienClaw`
- Note added: the API fails fast if `ALIENCLAW_DB_URL` is not set — no flat-file fallback

## Operator install

Confirmed database-free. See `packet-31.6-install-audit.md`.
The server runs MySQL; operators run on files. No operator is ever asked to set up a database.

## L5 deployment readiness

**READY.** The steps in `packet-31.5-manual-steps.md` are now genuinely load-bearing and accurate:

1. Install dependencies (`npm install`)
2. Create MySQL database on Hostinger (`u881291242_leaderboard`)
3. Run migration (`migrations/001_leaderboard.sql`) — creates both `leaderboard_entries` and `installs`
4. Set `ALIENCLAW_DB_URL` in Hostinger environment variables
5. Deploy from `bugsyhewitt/AlienClaw` main branch
6. Wire `api.alienclaw.net` DNS
7. Run live verification (curl tests from Packet 31.5 Phase 7)

When those steps are done and the live verification passes, L5 closes.

## What's next

Bugsy executes the corrected `packet-31.5-manual-steps.md`, then the live
verification from Packet 31.5 Phase 7 runs against the real MySQL-backed API.
L5 closes on successful curl verification.
