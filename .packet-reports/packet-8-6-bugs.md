# Packet 8.6 Bugs

## Bug — server.py instrumentation missed from Packet 8.5 commit (FIXED)

**Phase:** Pre-flight  
**Root cause:** During Packet 8.5, `git add` staged only the new diagnostics files.
The modifications to `src/alienclaw/bridge/server.py` were in the working tree
but not staged, so they weren't committed. The tests passed because they ran
against the on-disk file. Discovered at Packet 8.6 Phase 1 via `git status`.

**Fix:** Committed `server.py` as the first commit of Packet 8.6 (`4a29a1ea`).

---

## No other bugs in Packet 8.6.

The parameter_schema parser, decoder, and all 8 runner updates worked on
first pass. The shell escaping issue with newlines in `--inputs` was a
test-execution issue (not a code bug) — the Python-direct approach worked
correctly.
