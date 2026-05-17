# Packet 31.6 — Defaults and Invariants

## Storage invariants (as of Packet 31.6)

- `ALIENCLAW_DB_URL` is **required**. The API throws at startup if not set.
- No flat-file fallback exists anywhere in `src/alienclaw/api/`.
- `initPool()` must be called before any store method. Constructors do not fail on import.
- All SQL uses parameterized queries. No string-concatenated SQL.
- `installs` table keyed on `api_key_hash` (UNIQUE). One install per key.
- `leaderboard_entries` has CHECK constraints: `fitness` in [0, 1], `leaderboard_name` matches `^[A-Z]{8}$`.

## Test defaults

- `ALIENCLAW_TEST_DB_URL`: persistence tests skip (describe.skip) if not set.
- CI provides `mysql://root:test@127.0.0.1:3306/alienclaw_test`.
- Each test run cleans `leaderboard_entries` and `installs` tables in beforeEach.
