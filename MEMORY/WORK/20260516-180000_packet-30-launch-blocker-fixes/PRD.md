---
task: Packet 30 fix L1-L4 launch blockers CI green
slug: 20260516-180000_packet-30-launch-blocker-fixes
effort: advanced
phase: execute
progress: 0/48
mode: interactive
started: 2026-05-16T18:00:00Z
updated: 2026-05-16T18:05:00Z
---

## Context

Packet 30 closes the four launch-blockers from Packet 29's audit plus two trivial
discoverability fixes. L1: empty LICENSE → canonical MIT text. L2: README missing
API key requirement → add provider + env var docs. L3: README missing openclaw
configure guidance → add real prompt walkthrough. L4: npm install triggers broken
install.sh, CI has been red since 2026-05-10 → diagnose root cause, repair, verify
CI goes green. D1: zero GitHub topics → add 5+. D2: "Meeseeks" in repo description
→ update to current terminology. Verified by clean-clone re-test. No scope creep
into Packets 31-33 or protected subsystems.

### Risks

- L4 root cause may be deeper than the npm lifecycle hook — bash install.sh itself
  may have a broken dependency or path issue beyond the package.json trigger
- openclaw configure prompts may differ by OpenClaw version; documenting from the
  version on this machine (2026.4.22) while current npm is 2026.5.12
- Copyright holder for MIT license unknown — must confirm with Bugsy before writing
- CI may have infrastructure issues beyond install.sh; green run may require
  additional workflow config changes
- Pushing topics/description to GitHub requires gh CLI auth to be active

## Criteria

### Pre-flight
- [ ] ISC-1: Starting commit recorded in packet-30-starting-commit.txt
- [ ] ISC-2: Backup of codebase taken to alienclaw-backups/ with MANIFEST.txt entry
- [ ] ISC-3: packet-30-current-state.md produced documenting exact state of LICENSE, README, install.sh, package.json, CI config, repo metadata

### L1 — LICENSE
- [ ] ISC-4: LICENSE file contains canonical OSI MIT license text (not a paraphrase)
- [ ] ISC-5: LICENSE copyright line has confirmed holder name and year 2026
- [ ] ISC-6: LICENSE file ≥ 1000 bytes (canonical MIT text is ~1090 chars)
- [ ] ISC-7: L1 committed with descriptive commit message

### D1 — GitHub topics
- [ ] ISC-8: ≥5 relevant GitHub topics added to AlienTool/AlienClaw repo
- [ ] ISC-9: Topics confirmed set (verified via gh CLI or API, not just assumed)

### D2 — GitHub description
- [ ] ISC-10: GitHub repo description no longer contains "Meeseeks"
- [ ] ISC-11: Updated description uses current terminology and ≤160 chars
- [ ] ISC-12: Description confirmed set (verified via gh CLI or API)

### L4 — install.sh repair
- [ ] ISC-13: Root cause of install.sh breakage identified and documented in packet-30-install-fix-diagnosis.md
- [ ] ISC-14: The specific commit or change that introduced the breakage identified
- [ ] ISC-15: install.sh and/or package.json modified to fix the root cause
- [ ] ISC-16: CI workflow files modified if required by the fix
- [ ] ISC-17: `npm install` in the repo directory succeeds without triggering install.sh incorrectly
- [ ] ISC-18: `npm install` installs dev dependencies (typescript, vitest) correctly
- [ ] ISC-19: Verified on a clean clone (not just local working copy)
- [ ] ISC-20: CI run triggered by the fix commit shows GREEN status
- [ ] ISC-21: packet-30-install-fix-diagnosis.md produced with root cause, fix, and CI evidence
- [ ] ISC-22: L4 committed with descriptive commit message

### L2 — README API key requirement
- [ ] ISC-23: README contains a new section documenting LLM API key requirement
- [ ] ISC-24: At least one specific provider (Anthropic) named with exact env var (ANTHROPIC_API_KEY)
- [ ] ISC-25: At least one other provider option named (OpenAI, Gemini, or OpenRouter)
- [ ] ISC-26: `export ANTHROPIC_API_KEY="your-key-here"` or equivalent command shown
- [ ] ISC-27: Consequence of missing key documented (what error a stranger sees)

### L3 — README openclaw configure walkthrough
- [ ] ISC-28: README contains a new section walking through `openclaw configure`
- [ ] ISC-29: Each real interactive prompt documented (from actually running it)
- [ ] ISC-30: What a new user should answer for each prompt is stated explicitly
- [ ] ISC-31: The section is ≤ 30 lines (concise; not a wall of text)

### L2 + L3 committed
- [ ] ISC-32: L2 and L3 changes committed with descriptive commit message

### Re-verification
- [ ] ISC-33: Clean-clone re-verification run after all fixes are committed
- [ ] ISC-34: Stranger following README can find the API key requirement (L2 closed)
- [ ] ISC-35: Stranger following README can navigate openclaw configure (L3 closed)
- [ ] ISC-36: `npm install` in clean clone succeeds without install.sh triggering (L4 closed)
- [ ] ISC-37: LICENSE file in clean clone is ≥1000 bytes with real MIT text (L1 closed)
- [ ] ISC-38: packet-30-verification.md produced with evidence for each item

### Final artifacts
- [ ] ISC-39: packet-30-verdict.md produced (closure status table + stranger bottom line)
- [ ] ISC-40: packet-30-report.md produced
- [ ] ISC-41: packet-30-bugs.md produced
- [ ] ISC-42: packet-30-deferred.md produced
- [ ] ISC-43: packet-30-defaults.md produced
- [ ] ISC-44: docs/LESSONS_FROM_THE_ARC.md updated with L1-L4 closure

### Process compliance (anti-criteria)
- [ ] ISC-A1: No changes to governance/, genome/, fitness/, brains/, bridge/, martians/, evolution/, api/ subsystems
- [ ] ISC-A2: No L5/leaderboard work performed
- [ ] ISC-A3: No README sections beyond L2/L3 install docs (no examples, output samples, motivation)
- [ ] ISC-A4: L4 not declared closed without evidence of green CI run

## Decisions

## Verification
