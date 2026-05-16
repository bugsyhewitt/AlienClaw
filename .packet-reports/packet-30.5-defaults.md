# Packet 30.5 — Architectural Defaults

1. **No bulk "ship the arc" commit.** Every file dispositioned individually. A file is committed only when examined, confirmed complete, and attributed to its originating packet.

2. **Per-file disposition into three buckets: commit / fix-then-commit / delete.** All 313 uncommitted changes in the tree were bucketed. All DELETE files removed. All COMMIT files committed in scoped groups. No HOLD files remained — every file had clear attribution.

3. **Trace the Packet 29 protocol question honestly.** Packet 29's `git add` was correctly scoped. The violation was in `git commit` sweeping pre-staged files from Packets 14-23. Root cause: those packets staged but never committed.

4. **CI green is the exit criterion, reached honestly.** Not by suppressing tests, not by bulk-committing, not by coverage threshold manipulation. The tree was committed correctly and CI verified green.

5. **No new development.** This packet completed files that were already present and complete in the local tree. No new features were added. Every committed file was produced by a prior packet.
