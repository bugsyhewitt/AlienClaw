---
task: Salvage at-risk work, verify gates, clean repo residue
slug: 20260716-133337_alienclaw-health-pass
effort: advanced
phase: complete
progress: 40/40
mode: interactive
started: 2026-07-16T13:33:37-04:00
updated: 2026-07-16T13:55:00-04:00
---

## Context

User asked for a full pass ensuring everything performs optimally. Recon (3 Explore agents + 1 Plan agent + hand verification) found the repo healthy — main CI green (~100s, 7 checks), zero FIXMEs, no perf debt — but three bodies of completed work unlanded and at risk: (1) the whole-codebase simplify pass surviving ONLY as stash@{0} `c2aece81` (33 files, +400/−390, PRD 27/27, parent `c11dbf71` = feat/fus-103 tip); (2) the P14-01 reflective/graph-evolution worktree (8 unpushed commits + dirty state); (3) the e1-wt governance-gated evolution loop commit. Plus: PR #235 merge-conflicted, junk stashes {2}–{6}, ~200 [gone] branches, stray coverage artifacts. Standing hazard: parallel packet automation resets this checkout — all application work in temp worktrees, stashes applied by SHA only. Approved plan: `Plans/hazy-tickling-quail.md` (Plans/ now gitignored; plan content mirrored by this PRD).

### Risks

- Concurrent stash pop/clear could vaporize stash@{0} → backup refs pushed before everything (done first).
- Stash indices unstable under automation → every apply/drop by SHA, re-verified.
- #229's head branch IS the stash parent → merged #229 before simplify transplant.
- Local gates are pre-flight only (DB suites skip without MySQL); PR CI is authoritative.

## Criteria

Phase 0 — Protect:
- [x] ISC-1: Backup branch for simplify stash exists locally
- [x] ISC-2: Simplify backup branch pushed to origin
- [x] ISC-3: Backup branch for packet-108 stash exists locally
- [x] ISC-4: Simplify PRD dir copied to session scratchpad
- [x] ISC-5: Plans dir copied to session scratchpad
- [x] ISC-6: P14-01 worktree dirty state committed in place
- [x] ISC-7: P14-01 branch pushed as feat/p14-01-graph-evolution
- [x] ISC-8: P14-01 draft PR open flagging unverified final phase
- [x] ISC-9: submitFromFile fix verified already present on origin/main (leaderboard.ts:286)
- [x] ISC-10: submitFromFile separate PR verified unnecessary — no PR opened (superseded)
- [x] ISC-11: e1-wt commit pushed to origin
- [x] ISC-12: e1-wt supersession verdict recorded in this PRD

Phase 1 — Land ready PRs:
- [x] ISC-13: PR 229 state MERGED confirmed via gh JSON
- [x] ISC-14: PR 222 state MERGED confirmed via gh JSON
- [x] ISC-15: PR 235 supersession by #246 verified via rebase conflict inspection
- [x] ISC-16: PR 235 closed with explanatory comment (not merged — superseded)
- [x] ISC-17: PR 235 remote branch swept after close

Phase 2 — Simplify-pass branch:
- [x] ISC-18: Simplify branch materialized from stash SHA in temp worktree
- [x] ISC-19: Simplify branch rebased onto current origin/main
- [x] ISC-20: tsc --noEmit clean on simplify branch
- [x] ISC-21: vitest full suite green locally on simplify branch
- [x] ISC-22: ruff clean on genome/brains/evolution scopes
- [x] ISC-23: pytest genome coverage gate 95 green (99.65%)
- [x] ISC-24: pytest brains coverage gate 90 green (91.53%)
- [x] ISC-25: pytest evolution coverage gate 85 green (99.79%)
- [x] ISC-26: pytest diagnostics coverage gate 90 green (99.08%)
- [x] ISC-27: Simplify PR open marked do-not-merge linking its PRD (#250)
- [x] ISC-28: stash@{0} object still reachable after Phase 2 (cat-file: commit)

Phase 3 — Hygiene:
- [x] ISC-29: Simplify PRD dir committed via hygiene PR (#251 MERGED)
- [x] ISC-30: No *.test.* files under MEMORY/ after hygiene (scan: 0 matches)
- [x] ISC-31: .gitignore covers coverage*.json, *,cover, /Plans/ (verified: Plans/ vanished from status)

Phase 4 — Gated cleanup:
- [x] ISC-32: Cleanup list presented and user confirmation received ("Everything listed")
- [x] ISC-33: stash@{1} disposition verdict recorded (superseded by PR #118, packet 106 — droppable)
- [x] ISC-34: Junk stashes dropped with per-drop SHA re-verification (6 dropped, {0} retained)
- [x] ISC-35: Stray root coverage artifacts deleted (4 files)
- [x] ISC-36: Gone-upstream branches pruned honoring exclusion list (155 pruned, 220→65)
- [x] ISC-37: Stale worktree agent-a6743f80 removed with its branch
- [x] ISC-38: P14-01 and e1-wt worktrees retained until PRs resolve

Final:
- [x] ISC-39: Main CI green after final merge (run 29521480883 success at 2d1737d8)
- [x] ISC-40: Final summary lists every PR opened/merged and deletion

Anti-criteria:
- [x] ISC-A1: No capital-S Specialist identifier introduced to main (P14-01 draft contains pre-existing ones — flagged on #247, not merged)
- [x] ISC-A2: No deploy or genome submission performed
- [x] ISC-A3: No edits to ~/.openclaw/openclaw.json
- [x] ISC-A4: Simplify PR not merged by me (#250 open, do-not-merge)

## Decisions

- Backups by immutable SHA, not stash index (indices renumber under concurrent automation).
- `git stash apply` only — pop/drop/branch mutate shared refs or flip HEAD in the racing checkout.
- submitFromFile fix NOT cherry-picked: content-verified already on main (landed independently); duplicate-test branch abandoned.
- PR #235 closed as superseded instead of rebase-merged: #246 covers the identical branch arms (L167/L188 arm-0) plus silent-skip arms; EACCES-vs-EPERM adds no coverage.
- review/session-union deleted: roulette/truncation exist on main (different impl); file_read fix landed as #113 "salvaged packet 124".
- Node gates use `npm install` (CI's mechanism) — no lockfile is tracked; pnpm-lock.yaml was untracked local state.
- P14-01 CI failures documented on #247, not fixed: wall-check Specialist violations + migrations/003 never wired into ci.yml are review-scoped for the draft.

## Verification

- ISC-1/2/3: branch create OK ×2; push `* [new branch] backup/stash-simplify-pass`.
- ISC-6/7/8: commit 9b4ef833 (21 files, +1533); push OK; PR #247 (draft).
- ISC-9/10: `origin/main:leaderboard.ts:286 genome: artifact.genome // was: artifact.genome_hash (BUG)`; artifact struct threads genome.
- ISC-11/12: push OK; `git grep GovernanceGate origin/main -- src/` = no matches → not superseded → PR #248 (draft).
- ISC-13/14: `gh pr view --json state` = MERGED 17:37:11Z / 17:37:25Z.
- ISC-15/16/17: conflict-body inspection showed identical arm coverage on HEAD; PR CLOSED; remote branch deleted.
- ISC-18–26: worktree at c11dbf71, apply c2aece81, commit 3a4fbc92, rebase clean; STEP-TSC-OK; vitest 1768 passed/38 skipped; ruff "All checks passed!" ×2; pytest 1194 passed + 4 gates (99.65/91.53/99.79/99.08).
- ISC-27/28: PR #250 (7/7 green after actionlint-flake rerun — corrupt tarball download, not diff-related); `cat-file -t c2aece81` = commit.
- ISC-29/30/31: PR #251 MERGED; find *.test.* = 0; ff-pull confirmed ignore behavior.
- ISC-32–38: user selected "Everything listed"; drop log 6× DROPPED with SHA match; FILES-DELETED; 155 pruned; WT-REMOVED + branch deleted; worktree list retains P14-01 + e1-wt.
- ISC-39: `gh run list --branch main` — CI success 29521480883 (2d1737d8).
