---
task: Unclog CI runner starvation, drain 32-PR backlog
slug: 20260702-025103_unclog-ci-drain-pr-backlog
effort: extended
phase: complete
progress: 26/26
mode: interactive
started: 2026-07-02T02:20:00-0400
updated: 2026-07-02T03:15:21-0400
---

## Context

"What is left to do" survey found stuck delivery, not missing code: main frozen at PR #77 (packet 089) while 32 green PRs (#78–#109, packets 090–121) sit open. Three OpenClaw vendor-residue workflows (labeler, auto-response, stale) target nonexistent runner `blacksmith-16vcpu-ubuntu-2404`; jobs hang 24h then fail, red-✗ing every PR. stale.yml would close the whole >10-day-old backlog if its runner ever worked. No branch protection; UNSTABLE = mergeable. User approved: delete all three workflows, full drain by Claude. Full plan: Plans/snazzy-exploring-honey.md.

### Risks

stale.yml must be deleted not repaired; #84/#86/#96 are triple duplicate (merge #84 only); #87⊂#90⊂#92 (merge #92 only); #85 and #109 need local conflict-resolving rebases; pull_request_target runs from main so deletion must land before any branch pushes or PR comments.

## Criteria

- [x] ISC-1: PR 109 substantive checks verified green
- [x] ISC-2: Open PRs enumerated as 32 spanning packets 090-121
- [x] ISC-3: Open issues verified zero
- [x] ISC-4: Failing check names identified on three sampled PRs
- [x] ISC-5: Failure signature is 24h runner-pickup timeout
- [x] ISC-6: runs-on blacksmith label confirmed in three workflows
- [x] ISC-7: stale.yml daily cancel pattern documented
- [x] ISC-8: UNSTABLE state and empty reviewDecision confirm unblocked merges
- [x] ISC-9: Conflict clusters computed from changed-file overlap
- [x] ISC-10: Merge topology verified at blob-hash level
- [x] ISC-11: Packet system located in MEMORY/WORK and skills
- [x] ISC-12: Remaining MSB tool gaps enumerated
- [x] ISC-13: ROADMAP in-flight items mapped to status
- [x] ISC-14: Dependabot PRs dispositioned into Wave 1
- [x] ISC-15: Untracked .coverage dispositioned as follow-up
- [x] ISC-16: Plan file written with prioritized queue
- [x] ISC-17: Plan contains CI-fix verification steps
- [x] ISC-18: Plan names Wave 0 as top action
- [x] ISC-19: Baseline main suites pass before changes
- [x] ISC-20: Vendor workflow deletion PR merged green
- [x] ISC-21: Queued hung runs cancelled to zero
- [x] ISC-22: Gate 1 suites pass after Wave 1
- [x] ISC-23: Gate 2 suites pass after Wave 2
- [x] ISC-24: Gate 3 shows zero open PRs and green main
- [x] ISC-A1: No writes outside plan file during plan mode
- [x] ISC-A2: All selected capabilities actually invoked

## Decisions

- Delete vendor workflows rather than repair: upstream App secrets absent, stale.yml booby trap, ROADMAP precedent for residue removal. (User confirmed.)
- Merge #84 over #86/#96 (superior invariant tests); merge #92 top-of-stack over #87/#90 (byte-verified containment); squash merges matching repo convention; never gh pr update-branch (nothing requires freshness, and pre-deletion it would mint hung runs).
- Full local suite per wave, not per PR; branch CI awaited only on rebased #85/#109.

## Verification

Investigation criteria verified via gh pr checks/list/view, workflow file reads, and two subagent reports (Explore: packet system map; Plan: blob-level topology). Execution evidence: baseline main fb85aa9c green (756 passed/125 skipped); PR #110 merged (−1383 lines vendor workflows), 3 hung runs cancelled; Gate 1 green at 37d7bc0e (785 passed); Gate 2 green at 1dbe0048 (governance suite 440 passed, tsc clean, #85 CI green); Gate 3 green at ccfa5a62 (866 passed/125 skipped, 0 open PRs, 0 queued runs, main CI run 28572294478 success). 28 backlog PRs merged + #110; 4 closed with explanations (#86 #87 #90 #96); 9 leftover remote branches swept (worktree-pinned local branches had blocked gh's remote deletion).
