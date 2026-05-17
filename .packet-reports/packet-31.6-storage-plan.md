# Packet 31.6 — Storage Rewrite Plan

## MySQL client

`mysql2/promise` — the standard Node.js MySQL client with native Promise
support. Added as a production dependency (not devDependency — the server
needs it at runtime).

## Connection

`ALIENCLAW_DB_URL` environment variable (e.g.
`mysql://u881291242_api:PASSWORD@localhost/u881291242_leaderboard`).

Single `mysql.createPool()` call at module load. The pool is shared across
all three stores. If `ALIENCLAW_DB_URL` is not set or the connection fails,
the API fails fast at startup — no silent fallback.

## Schema (all three stores in one migration)

### leaderboard_entries (submissions)
Existing table from migration 001 — retained and confirmed correct.
- Columns: id, leaderboard_name, genome, martian_type, fitness, api_key_hash,
  submitted_at, submission_id (UNIQUE), run_metadata
- CHECK constraints: leaderboard_name REGEXP '^[A-Z]{8}$', fitness [0,1]

### installs (new table)
- install_id VARCHAR(32) PRIMARY KEY
- api_key_hash VARCHAR(64) UNIQUE — enables fast exists() lookup
- machine_hash VARCHAR(64)
- registered_at DATETIME

### GlobalStats: derived, no table needed
Stats are derived at query time using SQL aggregates:
- total_genomes: SELECT COUNT(*) FROM leaderboard_entries
- total_installs: SELECT COUNT(*) FROM installs
- total_fitness_evaluations: same as total_genomes (one eval per submission)
- top_fitness_by_type: SELECT martian_type, MAX(fitness) ... GROUP BY martian_type

No mutable stats row that can drift from reality.

## Interface preservation

All three store classes keep their exact method signatures, now async.

| Method | Return type change |
|--------|-------------------|
| SubmissionStore.save | `[string, string]` → `Promise<[string, string]>` |
| SubmissionStore.topForType | `StoredSubmission[]` → `Promise<StoredSubmission[]>` |
| SubmissionStore.countForType | `number` → `Promise<number>` |
| SubmissionStore.rankForFitness | `number` → `Promise<number>` |
| SubmissionStore.isNewTop | `boolean` → `Promise<boolean>` |
| SubmissionStore.findDuplicate | `StoredSubmission | null` → `Promise<StoredSubmission | null>` |
| InstallStore.register | `[string, boolean]` → `Promise<[string, boolean]>` |
| InstallStore.exists | `boolean` → `Promise<boolean>` |
| InstallStore.count | `number` → `Promise<number>` |
| GlobalStats.get | `RawStats` → `Promise<RawStats>` |

## Handler changes (minimal)

All handler functions gain `async` and `await` their store calls. The
server.ts HTTP layer already uses async handlers, so this propagates cleanly.

`authBearer` in server.ts calls `_INSTALLS.exists()` — must become async.
The POST /v1/genomes path already awaits `readJson(req)`, so the pattern
is established.

## Removed

- `dataRoot()` function
- `atomicWrite()` function
- All `node:fs` imports from storage.ts
- The false `"If ALIENCLAW_DB_URL is set..."` comment

## Tests

`test/api/ts-storage.test.ts`:
- Uses `ALIENCLAW_TEST_DB_URL` (skipped if not set)
- Queries MySQL directly after each store operation
- CI: MySQL service container with `ALIENCLAW_TEST_DB_URL` set

`test/api/ts-api-server.test.ts`:
- Updated to use MySQL when `ALIENCLAW_TEST_DB_URL` is set
- Falls back to indicating "DB required" clearly when not set
