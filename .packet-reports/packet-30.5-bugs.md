# Packet 30.5 — Bugs

## Bug #13 — Untracked Architectural State

**What:** Files from Packets 14-23 were staged with `git add` but never committed.
The staging area accumulated across sessions. Packet 29's `git commit` swept all
staged files, violating the audit-only protocol (inadvertently, not by intent).
Result: the committed state had partial TypeScript files without their dependencies,
causing CI failures in Packets 30 and 30.5.

**Root cause:** Per-packet discipline didn't include a pre-commit staging check.
`git commit` commits ALL staged files — not just the ones you just added.

**Fix:** Packet 30.5 reconciliation — 11 scoped commits attributing all files to
their originating packets.

**Prevention:** Pre-commit staging check added to LESSONS_FROM_THE_ARC.md as a
required step in every packet's exit sequence.

## Discovered during reconciliation: missing requirements-dev.txt entries

Three dependencies were missing that caused CI test collection failures:
- **PyYAML** — used by `src/alienclaw/martians/parser.py` (Packet 16)
- **numpy** — used by `src/alienclaw/diagnostics/` (Packet 21)
- **scikit-learn** — used by `src/alienclaw/diagnostics/bayesian_optimizer.py` (Packet 21)

All three were added to `requirements-dev.txt`.

## Discovered during reconciliation: stale CI test path

The CI workflow `ci.yml` referenced `test/bridge/runners/test_web_search_backend.py`
which was deleted as part of the bridge/runners → tools/ refactor (Packets 22-24).
Updated to `test/tools/test_web_search_backend.py`.

This is a sub-item of Bug #13 — the CI was written for the old architecture but
the new architecture was committed without updating the CI reference.
