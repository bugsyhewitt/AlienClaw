# Packet 12 — Deferred Items

## DEFERRED-12-001: Rate limiter concurrent file access under heavy load

The current implementation uses per-install threading.Lock which prevents concurrent double-count within a single process. Under extreme concurrent load from the same install (unlikely at current scale), the tmp+rename pattern could have edge cases on certain OS/filesystem combinations. SQLite with WAL mode would be more robust. Deferred until scale demands it.

## DEFERRED-12-002: Audit log rotation / retention policy

The audit log grows indefinitely (one file per day, retained forever). For v1 with one operator, this is fine (disk is cheap). A retention policy (e.g., keep 90 days) and automatic log rotation should be added before multi-operator scale.

## DEFERRED-12-003: web_search with real backend

The backend swap removed the uncontrolled URL but doesn't provide a default. Operators must configure ALIENCLAW_SEARCH_URL. A follow-up packet could implement:
- DDG HTML scraping with a stable parser (Option 1 from investigation)
- Brave Search API integration with operator API key configuration
- A bundled SearXNG Docker compose config for self-hosting

## DEFERRED-12-004: Rate limiter audit log correlation

Currently the rate limiter and audit log don't cross-reference. A RATE_LIMIT_EXCEEDED event in the audit log would make incident response easier. Deferred — low priority until multi-operator scale.
