# Packet 29 — Genuine Code Defects Discovered

This file records genuine code defects discovered during the audit — things that are wrong in the code itself, separate from UX/documentation gaps (which go in the gap list).

*Note: An audit packet typically discovers environmental/dependency defects rather than logic bugs. This file is populated only if clean-environment testing reveals actual code defects.*

## Defects Found

### Bug #12 — `npm install` in repo directory triggers installer and breaks CI

**File:** `package.json`, line:
```json
"scripts": {
  "install": "bash install.sh"
}
```

**What it does:** The `install` lifecycle script in npm runs when `npm install`
is executed in the package directory. This means any developer or CI system
running `npm install` to install dev dependencies (TypeScript, vitest, etc.)
will also trigger `bash install.sh`, which checks for the `openclaw` binary.
If openclaw is not installed, install.sh exits with code 1, failing the
`npm install` step entirely.

**Evidence — CI failure confirmed:**
```
GitHub Actions CI run 25615274523 (2026-05-10):
  Job "TypeScript typecheck"  → FAILED at "Install dependencies"
  Job "Unit tests"            → FAILED at "Install dependencies"
  Job "Python lint + test"    → FAILED at "Lint Python files"
```

The CI workflow (`ci.yml`) runs `npm install` without pre-installing openclaw.
This has caused all CI runs to fail. CI has not had a successful run as of
audit date (2026-05-16) — last known run was 2026-05-10, result: failure.

**Stranger impact:** A developer cloning the repo and running `npm install`
to set up the dev environment hits this bug. The README doesn't say to run
`npm install` in the repo directory (the Quick Start says `bash install.sh`
directly), so end-users following the README don't hit this. But contributors
setting up a dev environment will.

**Suggested fix (not implemented — audit only):** Remove the `"install"` script
from package.json scripts, or rename it to `"postinstall-skip"` or use a
different script key (e.g., `"setup"`). The `"install"` lifecycle hook should
not be used for application-level installers in a development package.

**Bug number in sequence:** Bug #12 (continuing from pre-packet-29 count of 11).
