# Packet 29 — Launch-Readiness Audit — Report

**Date:** 2026-05-16
**Starting commit:** 3bdcc90f096a8000e86b86b28c29aa64393c4535
**Type:** Audit only — zero fixes applied

---

## What this packet did

Ran a full stranger-perspective audit of the AlienClaw GitHub repo. Cloned fresh
from github.com/AlienTool/AlienClaw (not the local working copy), followed the
README literally, tested alienclaw.net and api.alienclaw.net directly, inspected
every standard GitHub file, and produced nine artifact reports.

---

## Key findings

### Launch-blockers (5)

**L1 — LICENSE is empty.** The LICENSE file contains one byte (a newline). The
website and README both claim MIT, but no license text exists. Nobody can legally
use, fork, or contribute to the code.

**L2 — No API key guidance.** The README never mentions that an LLM API key is
required. A stranger completes the install and hits a runtime error with no
explanation.

**L3 — `openclaw configure` is undocumented.** Step 2 of the Quick Start is an
interactive wizard with zero README guidance. A stranger without prior OpenClaw
experience cannot complete this step.

**L4 — `npm install` triggers the installer and breaks CI.** `package.json` has
`"install": "bash install.sh"` in scripts. This is npm's `install` lifecycle
hook, which fires on every `npm install`. Since openclaw is not installed in CI,
this breaks the "Install dependencies" step in both TypeScript and unit test CI
jobs. CI has been failing since at least 2026-05-10. This is Bug #12.

**L5 — Leaderboard is non-functional.** `api.alienclaw.net` is unreachable
(HTTP 000 — no connection). The leaderboard page on alienclaw.net shows only
placeholder rows. No genome can be submitted, no rank exists, no feedback loop
works.

### Adoption-multipliers (10)

See gap list: no example BossBot goal, no example output, no use-case
motivation, Node version unspecified, .env.example unlinked, no GitHub topics,
stale Meeseeks terminology in GitHub description, .packet-reports/ visible to
strangers, openclaw version compatibility untested, status section vague.

### Standard-hygiene (4)

Missing: CODE_OF_CONDUCT.md, CHANGELOG.md, CI badge in README. Unverified:
`@mariozechner/pi-ai` license compatibility.

---

## What this packet did NOT do

- Fix anything (all gaps deferred to follow-up packets)
- Modify the codebase
- Modify the GitHub repo
- Test `openclaw configure` interactively (requires API key + TTY)
- Test `openclaw chat` interactively (requires configured openclaw)
- Deploy api.alienclaw.net

---

## Recommended next packets

| Packet | Work | Closes |
|--------|------|--------|
| **Packet 30** | LICENSE text, npm install fix (CI), README API key + configure guidance | L1, L2, L3, L4 |
| **Packet 31** | api.alienclaw.net deployment + leaderboard live data | L5 |
| **Packet 32** | README onboarding polish: example, output, motivation, .env.example link | A1-A5, A10 |
| **Packet 33** | GitHub hygiene: topics, description, CODE_OF_CONDUCT, CHANGELOG, badges | A6-A8, H1-H4 |

---

## Artifacts produced

1. `packet-29-environment.md` — audit environment + clean clone record
2. `packet-29-readme-audit.md` — README assessment from stranger perspective
3. `packet-29-install-audit.md` — install path audit, step by step
4. `packet-29-helloworld-audit.md` — hello-world experience audit
5. `packet-29-leaderboard-audit.md` — leaderboard state audit
6. `packet-29-legal-audit.md` — license and legal audit
7. `packet-29-hygiene-audit.md` — GitHub hygiene audit
8. `packet-29-gap-list.md` — THE HEADLINE: prioritized gap list with severity
9. `packet-29-report.md` — this file
10. `packet-29-bugs.md` — Bug #12: npm install lifecycle script breaks CI
11. `packet-29-defaults.md` — architectural defaults for this packet
12. `packet-29-starting-commit.txt` — starting commit record
