# Packet 31.6 — Bug #14: Storage-Backend Port Drift

## What drifted

Packet 31.5 ported the leaderboard API from Python to TypeScript under a
stated behavior-preserving-port rule. The storage backend changed from MySQL
to flat files. `src/alienclaw/api/storage.ts` writes JSON files to disk via
`node:fs` and carries a comment:

> "If ALIENCLAW_DB_URL is set, SubmissionStore uses MySQL instead."

That MySQL path does not exist anywhere in the code. The comment described
an intention that was never implemented.

## Why the equivalence tests missed it

The 25 equivalence tests in `test/api/ts-api-server.test.ts` asserted
HTTP request/response behavior — same inputs, same HTTP status codes, same
response shapes. They did not assert where data physically landed.

A flat-file store and a MySQL store produce identical HTTP responses for
every operation: `POST /v1/genomes` returns `{submission_id, rank, is_new_top}`
whether the data landed in a file or a database row. HTTP-layer equivalence
is not persistence-layer equivalence. That gap is exactly how an entire
storage backend changed without a single test failing.

## The concrete cost

Flat-file storage on a Hostinger Node deployment slot fails in a specific,
predictable way: redeploys wipe the deployment directory. Every operator
submission would be erased on the next code push. Not a working leaderboard.

Additionally, the MySQL database at `u881291242_leaderboard` was provisioned
in Packet 31, the migration was written, and Bugsy's Hostinger deployment
steps explicitly include running the migration. The API should have been
using MySQL all along.

## The fix

MySQL-only storage for all three server stores (`SubmissionStore`,
`InstallStore`, `GlobalStats`). No dual backend, no flat-file fallback.
Flat-file code removed. False comment removed. API fails fast on missing or
unreachable database — no silent degradation.

## The lesson (applied in Packet 31.6)

A port's equivalence tests must assert the persistence layer directly:
query the actual datastore after each operation and confirm the data is
there with the expected values. An HTTP-level "the response looked right"
assertion is NOT sufficient.

Packet 31.6's tests query MySQL directly after every store operation.

## Family

Bugs #12, #13, #14 are all layer-divergence bugs:
- **#12**: `npm install` triggered `bash install.sh` — worked locally, broke in CI
- **#13**: Files staged in git but never committed — tree looked clean, repo was partial
- **#14**: Storage backend changed — HTTP tests passed, persistence was wrong

Each looked correct at one level while being wrong at another. The through-line
is systems that test the surface without testing the substrate.
