# Packet 12 — Defaults

## Three architectural decisions logged (per spec)

### 1. Rate limiter goes to flat-file, not SQLite

Same discipline as Population storage (Packet 8) and submission storage (Packet 10).
Storage at `$ALIENCLAW_API_DATA_ROOT/rate_limit/<hash[:2]>/<hash>.json`.
Forward-compatible to SQLite if scale demands — the public API of `RateLimiter` is unchanged.

### 2. Audit log is JSONL with daily rollover

One file per day at `data/audit/submissions-YYYY-MM-DD.jsonl`. JSONL because it's
append-friendly, grep-able, and parses incrementally. Daily rollover keeps individual
files manageable. Retention defaults to forever — deleted audit history is irrecoverable.

### 3. Web_search investigation before implementation

Investigation was completed first (`packet-12-web-search-investigation.md`) before
any code was written. Five options were surveyed. The chosen option (remove default URL)
was the simplest fix (<10 lines) and the most honest for a self-hosted system.
The investigation doc provides the full rationale for operators who want a different backend.

## New defaults

| Component | Default | Env var / option |
| --- | --- | --- |
| Rate limit file root | `$ALIENCLAW_API_DATA_ROOT/rate_limit/` | via `data_root` param |
| Audit log root | `$ALIENCLAW_API_DATA_ROOT/audit/` | via `data_root` param |
| web_search backend | (none — operator must configure) | `ALIENCLAW_SEARCH_URL` |
