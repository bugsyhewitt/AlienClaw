# P3 Staging Runbook

These are the four live-staging operations that came out of the P2 packet review.
They **must be run by the user** (Bugsy) — autonomous sessions do not touch staging or production.

All commands assume you have an SSH connection or hPanel terminal to the staging server and know the staging domain (`<staging>`). Never run these against `api.alienclaw.net` until explicitly ready.

---

## 1 — Measure real XFF hop count (follow-up #1)

**Goal:** Determine how many hops LiteSpeed/Cloudflare add before the Node process, so `ALIENCLAW_XFF_HOPS` can be set correctly and the real client IP surfaces in logs/rate-limiting.

**Steps:**

```bash
# 1a. Set a one-time diagnostic token on staging (hPanel env vars → restart).
ALIENCLAW_DIAG_TOKEN=<a-long-random-secret>

# 1b. Hit the whoami diagnostic endpoint from your local machine.
curl -s -H "x-diag-token: $ALIENCLAW_DIAG_TOKEN" \
     https://<staging>/__diag/whoami | jq .

# 1c. Read the response fields:
#   hopIndex  — the 0-based index into x-forwarded-for that is the real client IP
#   rawXff    — the full X-Forwarded-For header value as the server sees it
#   remoteAddr — the socket-level peer (may be a LiteSpeed internal address)
```

**Action:** Set `ALIENCLAW_XFF_HOPS=<hopIndex + 1>` in the staging (and eventually production) hPanel environment and restart.

---

## 2 — Run migrations on staging (follow-up #3)

**Goal:** Apply migrations 004 (`verified_fitness`) and 005 (`identities`) to the staging MySQL database. The migration runner is idempotent — safe to re-run.

**Option A — standalone CLI (preferred; no server restart needed):**

```bash
# From the repo root on your local machine, targeting staging:
ALIENCLAW_DB_URL="mysql://user:pass@<staging-db-host>:3306/alienclaw" pnpm migrate
```

Expected output:
```
[migrate] Applied 004_verified_fitness.sql
[migrate] Applied 005_identities.sql
[migrate-cli] done
```

On a second run: `[migrate] All migrations already applied.`

**Option B — via server restart with env gate:**

Set `ALIENCLAW_RUN_MIGRATIONS=1` in hPanel → restart the server. Migrations run at startup before the server starts accepting requests. Unset the env var and restart again once done (or leave it — it's idempotent but adds ~100 ms startup latency).

**Verify:**
```sql
SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at;
-- Expect rows for 001 through 005
```

---

## 3 — k6 load test (follow-up #4)

**Goal:** Run the load-test harness against staging off-peak to validate P2 API performance under load. See `perf/README.md` for the full stopping rules and success criteria.

> ⚠️ **Never run k6 against `api.alienclaw.net` (production).** Staging only.

**Steps:**

```bash
# Install k6 if not present: https://grafana.com/docs/k6/latest/set-up/install-k6/

# Board-read smoke test (quick):
k6 run -e BASE_URL=https://<staging> perf/k6/board-read.js

# Full load scenario (follow stopping rules in perf/README.md before scaling up):
k6 run --vus 20 --duration 60s \
       -e BASE_URL=https://<staging> \
       perf/k6/board-read.js
```

**Action:** Capture the summary output. If p95 latency on `GET /v1/genomes/top` stays under 200 ms at 20 VUs, the endpoint is healthy. File a follow-up if it degrades.

---

## 4 — Measure crash/restart behaviour (follow-up #5)

**Goal:** Determine whether Hostinger auto-restarts the Node process after a crash, so the correct `ALIENCLAW_EXIT_ON_FATAL` policy can be set.

> ⚠️ This will kill the staging server process. Do it during a low-traffic window and verify the server comes back before ending the session.

**Steps:**

```bash
# 4a. Trigger a deliberate crash via the diagnostic endpoint.
curl -s -X POST \
     -H "x-diag-token: $ALIENCLAW_DIAG_TOKEN" \
     https://<staging>/__diag/crash

# 4b. Wait 10–30 seconds, then check if the server is back.
curl -s https://<staging>/v1/health | jq .ok

# 4c. Repeat the health check a few times over 2 minutes to observe restart timing.
```

**Action:**
- **Hostinger auto-restarts within 30 s:** Safe to set `ALIENCLAW_EXIT_ON_FATAL=1` in production config — crashes get cleaned up automatically.
- **Hostinger does NOT auto-restart:** Keep `ALIENCLAW_EXIT_ON_FATAL` unset (current default) — the process keeps running after uncaught exceptions, which is safer than a cold restart with no guarantee of recovery.

Document the result as a decision in `docs/locked-decisions.md`.
