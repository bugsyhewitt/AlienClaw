# Packet 29 — GitHub Hygiene Audit

Audit date: 2026-05-16. Clean clone at /tmp/alienclaw-audit-20260516-170016.

---

## Standard files

| File | Present? | Size | Notes |
|------|----------|------|-------|
| LICENSE | Yes | 1 byte | **EMPTY** — newline only; see legal audit |
| CONTRIBUTING.md | **Yes** | 7588 bytes | Present and substantial |
| SECURITY.md | **Yes** | 20812 bytes | Present and substantial |
| CODE_OF_CONDUCT.md | No | — | **MISSING** |
| CHANGELOG.md | No | — | **MISSING** — ROADMAP.md exists as partial substitute |
| .github/ISSUE_TEMPLATE/ | **Yes** | — | bug_report.yml + feature_request.yml + config.yml |
| .github/workflows/ | **Yes** | — | ci.yml + auto-response.yml + labeler.yml + stale.yml + workflow-sanity.yml |
| .github/pull_request_template.md | **Yes** | 1939 bytes | Present |
| .github/dependabot.yml | **Yes** | 697 bytes | Present |

---

## CI status

CI workflows exist (ci.yml). However, CI is **currently failing**:

Last CI run: 2026-05-10
Result: **FAILURE**

Failed jobs:
- "TypeScript typecheck" — failed at "Install dependencies" step
- "Unit tests" — failed at "Install dependencies" step
- "Python lint + test + genome coverage" — failed at "Lint Python files" step

CI has not had a successful run since 2026-05-10 (the audit date is 2026-05-16).
Only the automated "Stale" bot workflow has run since then (daily, all cancelled).

Root cause of the "Install dependencies" failures: `package.json` has
`"install": "bash install.sh"` in its scripts section. When CI runs `npm install`
to install dev dependencies, npm executes `bash install.sh` as a lifecycle hook.
`install.sh` checks for the `openclaw` binary; it's not present in CI; the
script exits 1; npm install fails.

This is documented in `packet-29-bugs.md` as a genuine code defect.

A stranger visiting the GitHub repo sees no CI badge. If they clicked into
Actions, they would see a failing CI run from 6 days ago. This is worse than
no CI from a trust perspective.

---

## Repo metadata

| Element | State | Notes |
|---------|-------|-------|
| Description | Present | "Five-layer multi-agent governance system built on top of OpenClaw. Preset hierarchy, evolving Meeseeks genomes, and a community leaderboard." |
| Topics/tags | **Empty** | Zero topics. No discoverability via GitHub topics search. |
| README renders on repo page | Yes | README.md present and valid markdown |
| CI badge in README | **No** | No badges of any kind in README |
| CI status visible | Failing | Last run: failure, 2026-05-10 |
| Stars | 0 | Expected for new project |
| Open issues | 11 | Issues have been filed |
| Wiki | Enabled | Empty or unused (not checked) |

**Note on description:** The description says "Meeseeks genomes" — but the
codebase completed a "Meeseeks to Martian rename" (listed in ROADMAP.md as
Done). The GitHub repo description uses the old term. A stranger reading the
description and then the README/code would encounter inconsistent terminology.

---

## What's notably well-done

- CONTRIBUTING.md is substantial (7.5KB) with clear contribution guidelines
- SECURITY.md is comprehensive (20KB) — security policy, vulnerability reporting
- Issue templates exist for both bug reports and feature requests
- PR template exists
- Dependabot is configured
- Auto-response bot is configured
- Stale bot is configured

---

## Gaps found

| Gap | Severity | Notes |
|-----|----------|-------|
| CI is failing | **launch-blocker** | Breaks developer trust; no green badge to show |
| No GitHub topics | adoption-multiplier | Zero discoverability via topic search |
| Repo description uses "Meeseeks" (old term) | adoption-multiplier | Inconsistency with codebase rename |
| No CI badge in README | standard-hygiene | Industry standard; would show red for failing CI |
| CODE_OF_CONDUCT.md missing | standard-hygiene | Expected for open-source projects |
| CHANGELOG.md missing | standard-hygiene | ROADMAP.md partially substitutes but isn't the same |
