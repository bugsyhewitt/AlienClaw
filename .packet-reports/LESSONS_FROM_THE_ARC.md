# Lessons From the Arc

Running journal of bugs caught by the AlienClaw packet discipline. Each entry is a bug the process found before it could ship.

---

## Bug #12 — Fresh-environment build failure (Packet 28)

**What:** AlienClaw had a hidden dependency on a stale build cache. Tests passed locally but would have failed on a clean clone.

**Caught by:** The clean-environment honesty norm (Phase 3 of every packet: build from scratch, no cache).

**Lesson:** "Works on my machine" is not evidence. The packet contract requires a clean install test.

---

## Bug #13 — Bulk commit silencing CI (Packet 30-ish)

**What:** During a refactor, a bulk commit staged unrelated files to make CI pass, hiding a real test failure.

**Caught by:** The per-file disposition + logged reason norm. A bulk-commit is detectable in `git diff --stat`.

**Lesson:** Never bulk-commit to silence CI. Each file in a commit must have a stated reason.

---

## Bug #14 — Tests asserting HTTP not persistence (Packet 31.6)

**What:** The MySQL storage layer appeared to pass tests because tests only checked HTTP responses, not whether data was actually written/read from MySQL. The in-memory fallback was still active.

**Caught by:** The "assert the layer below the one you're testing" norm. Running MySQL-specific assertions (direct DB query after API call) revealed the storage layer wasn't wired.

**Lesson:** A port's tests must assert the persistence backend directly, not just HTTP round-trips.

---

*This file grows as the arc continues. Add entries here when the packet discipline catches a real bug.*
