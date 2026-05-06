# Packet 12 — Pre-Launch Hygiene

## Summary

**Verdict: All 3 gaps closed.** The API can now survive restarts cleanly, every submission has provenance, and web_search has no uncontrolled external dependency. The network is ready for a second operator.

---

## Gap 1 — Persistent rate limiter

**Before:** `RateLimiter` was in-memory. Server restart reset all buckets. A misbehaving client got a fresh 100-submission allowance every restart.

**After:** Flat-file persistent. Storage at `$ALIENCLAW_API_DATA_ROOT/rate_limit/<hash[:2]>/<hash>.json`. In-memory cache is primary state; disk is lazily loaded on first use per instance. Server restart no longer resets buckets.

**Key details:**
- Switched from `time.monotonic()` to `time.time()` (wall clock timestamps survive process restart)
- Atomic writes: tmpfile + rename (same as SubmissionStore)
- Per-install `threading.Lock()` prevents concurrent double-count
- Pruning keeps expired entries from accumulating
- `configure()` now wires `data_root` to RateLimiter
- 11/11 persistence tests pass including simulated restart

---

## Gap 2 — Submission audit log

**Before:** No record of who submitted what. A flooding attack left no traces.

**After:** Every submission attempt (accepted AND rejected) appends one JSONL line to `$ALIENCLAW_API_DATA_ROOT/audit/submissions-YYYY-MM-DD.jsonl`.

Log fields: `ts`, `api_key_hash`, `client_ip`, `martian_type`, `genome_sha256`, `fitness`, `result`, `rejection_code`

**Key details:**
- Raw API keys NEVER logged (only sha256 hash)
- Full genome NEVER logged (only sha256 hash)
- Write failure logs to stderr, never blocks submission
- Daily rollover: different dates → different files
- `genomes.py` handler accepts optional `audit_log` / `client_ip` params
- `server.py` initializes and passes `AuditLog` in `configure()`
- 16/16 tests pass including: raw-key-never-in-log, failure-non-blocking, rejection-code logging

---

## Gap 3 — web_search backend swap

**Before:** Runner hard-coded to `https://ddg-webapp-aagd.vercel.app/search` — a Vercel deployment nobody in the project controls.

**After:** No default backend. `ALIENCLAW_SEARCH_URL` env var is the only way to configure the search backend. Without it, runner returns `ok=False` with "backend not configured" message.

**Decision rationale:** See `packet-12-web-search-investigation.md`. Option 5 (remove default URL) was chosen over scraping alternatives because: (a) 5 lines vs. 100+ lines, (b) the env var override for testing already existed and works, (c) honesty — "web_search requires operator configuration" is the correct story for a self-hosted system.

**Key details:**
- Hermetic stub server pattern (ALIENCLAW_SEARCH_URL=stub URL) unchanged
- Sensitivity audit: web_search tc=0.35 preserved
- `web_search.msb` LIMITATIONS updated with env var documentation
- 8/8 backend tests pass

---

## Metrics

| Metric | Value |
| --- | --- |
| Python tests added | 35 (11 rate-limit + 11 audit + 5 integration + 8 web-search) |
| Files modified | rate_limit.py, server.py, genomes.py, web_search.py |
| Files created | audit_log.py + 4 test files |
| Full suite | 466 passed, 125 skipped |
| Commits | 3 (one per gap) + CI |
