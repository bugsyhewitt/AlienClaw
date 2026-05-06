# Packet 12 — Bugs Found and Fixed

## BUG-12-001: In-memory fallback didn't retain state between calls

**Severity:** Medium (test failure)  
**Discovery:** `test_no_data_root_falls_back_to_in_memory` failed — without data_root, each `check()` loaded empty state from disk (no disk) and never stored to memory.  
**Root cause:** First implementation only persisted to disk; no in-memory cache. Without disk, state was lost on each call.  
**Fix:** Added `_cache: dict[str, list[float]]` and `_cache_loaded: set[str]`. In-memory cache is the primary state; disk is lazily loaded once per instance. Both paths (no data_root = in-memory only; with data_root = in-memory + disk) now work correctly.  
**Lesson:** When adding persistence to an in-memory system, always test the "no persistence configured" path first.
