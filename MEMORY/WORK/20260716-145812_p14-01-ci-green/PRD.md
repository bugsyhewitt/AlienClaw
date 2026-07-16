---
task: Make salvaged P14-01 PR 247 pass all CI checks
slug: 20260716-145812_p14-01-ci-green
effort: extended
phase: complete
progress: 21/21
mode: interactive
iteration: 2
started: 2026-07-16T14:58:12-04:00
updated: 2026-07-16T14:58:12-04:00
---

## Context

Continuation of the 2026-07-16 health pass (user: "yes continue"). PR #247 (salvaged P14-01 reflective/graph evolution) fails 2 of 7 checks: wall-check R-002 (capital-S Specialist in 7 TS files under src/alienclaw/evolution/graph/ — prompts/specialist.soul.md is prose, .md not scanned, left alone) and 8 MySQL re_* store tests (branch adds migrations 002+003 but CI loads only 001). Branch ci.yml is stale (Jun 18) — must merge origin/main into the branch BEFORE touching ci.yml to avoid regressing main's CI at squash time. No history rewrite (salvage rule). #250 remains do-not-merge; merge decisions for #247/#248/#250 go to the user at the end via AskUserQuestion.

### Risks

- Merge of origin/main into branch may conflict (leaderboard.ts fix landed on main via a different commit).
- Rename must be identifier-only — no behavior change, tsc is the oracle.
- ci.yml migration loop must load files in sorted order (002 before 003; 003 may depend on 002).

## Criteria

- [x] ISC-1: origin/main merged into feat/p14-01-graph-evolution without history rewrite (clean merge, exit 0)
- [x] ISC-2: Merge conflicts (if any) resolved preserving both sides' tests (none arose)
- [x] ISC-3: Zero capital-S Specialist tokens in worktree src/ code files (only .md prose remains, unscanned)
- [x] ISC-4: Zero capital-S Specialist tokens in worktree test/ files (only wall-check's own patterns + allowlisted file)
- [ ] ISC-5: types.ts renamed identifiers compile (tsc clean)
- [ ] ISC-6: graph module imports/exports consistent after rename (index.ts)
- [x] ISC-7: ci.yml loads all migrations/*.sql in sorted order (glob loop, numeric prefixes)
- [x] ISC-8: Every MySQL-backed CI job gets the migration change (API-gate job + test job)
- [x] ISC-9: npm install succeeds in P14-01 worktree
- [x] ISC-10: npx tsc --noEmit clean in worktree
- [x] ISC-11: wall-check test green locally in worktree (6/6)
- [x] ISC-12: evolution/graph tests green locally in worktree (36/36; 108/108 with DB incl. reflective)
- [x] ISC-13: Full vitest suite green locally in worktree (1923 passed / 3 skipped WITH real MySQL)
- [x] ISC-14: Branch pushed (no force) to origin (a5c4fe0c, 2b94e1d7 appended)
- [x] ISC-15: PR 247 all 7 checks green including re_* store tests (MERGEABLE CLEAN)
- [x] ISC-16: PR 247 body updated to reflect fixed items
- [x] ISC-17: Merge/undraft decisions for 247/248/250 presented to user

Anti-criteria:
- [x] ISC-A1: PR 250 not merged this run
- [x] ISC-A2: No force-push, rebase, or history rewrite on the salvage branch (merge + appended commits only)
- [x] ISC-A3: specialist.soul.md prose left unmodified (behavioral prompt)
- [x] ISC-A4: Main checkout untouched (all work in the P14-01 worktree)

## Decisions

- CI failure #2 root cause was THREE layered defects, not just unloaded migrations: (a) 002 used CHAR(256) for the genome raw column — MySQL CHAR caps at 255 → VARCHAR(256); (b) 003 used reserved word `partition` bare → backticked (no code queries re_topology_* yet); (c) 003 used MariaDB-only ADD COLUMN IF NOT EXISTS → plain ADD COLUMN (fresh DB per CI run).
- Validated migrations + store tests locally against dockerized mysql:8.0 (same image as CI) before pushing — found four further genuine salvage defects: store JSON.parse on mysql2's pre-parsed JSON columns (getGenome, loadRun), an unguarded lineage walk that hangs forever on cyclic data, a test JSON.parse with the same driver mismatch, and makeTestGenome hashing every default call to ONE genome id (which planted a child==parent self-cycle row and cross-test collisions).
- makeTestGenome fixed at the helper (raw derived from theta, deterministic) rather than per-call-site — the trap stays disarmed for other suites; full local run guards regressions.

## Verification

- Migrations: dockerized mysql:8.0 (CI's image) loads 001→002→003 cleanly after fixes (ALL-MIGRATIONS-OK, fresh DB).
- Store suite: 8/8 against real DB (was 0/8 in CI, 4/8 after schema fixes, 8/8 after store+test-infra fixes).
- Full suite WITH DB: 1923 passed / 3 skipped, tsc clean — CI-equivalent locally.
- PR CI: 7/7 pass on head 2b94e1d7132c (earlier "fail" reading was the stale prior run — a `--watch` race right after push).
- MERGEABLE CLEAN via gh JSON.
