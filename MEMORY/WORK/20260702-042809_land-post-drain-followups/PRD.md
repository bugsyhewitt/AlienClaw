---
task: Land remaining follow-ups: salvage, packets, evolution, site
slug: 20260702-042809_land-post-drain-followups
effort: advanced
phase: complete
progress: 28/28
mode: interactive
started: 2026-07-02T04:28:09-0400
updated: 2026-07-02T05:04:00-0400
---

## Context

Follow-up to the 2026-07-02 CI unclog + 32-PR drain (see 20260702-025103_unclog-ci-drain-pr-backlog). User approved finishing the post-drain list: ① compute.py MSB alignment/tests (salvage /tmp worktree branches packet-121/122 first), ② evolution selection.py roulette-wheel + truncation stubs, ③ Specialist/Martian spawning + fitness evaluation loop (ROADMAP "Next"), ④ alienclaw.net rebuild, plus housekeeping (.coverage gitignore, historical remote branches). Never-PR'd packet branches exist on the remote (100, 101×2, 102, 105-reporting, 106, 114, 121, 122, 124) with possible uncommitted deltas in /tmp worktrees. Repo convention: branch → PR → green CI → squash merge. Production deploy of alienclaw.net requires explicit user confirmation.

## Criteria

- [x] ISC-1: .coverage pattern added to .gitignore
- [x] ISC-2: Local stray .coverage artifact removed
- [x] ISC-3: Remote branches fully merged into main enumerated
- [x] ISC-4: Provably-merged remote branches deleted
- [x] ISC-5: Unmerged historical branches dispositioned in report, not deleted
- [x] ISC-6: Every never-PR'd packet branch diffed against main
- [x] ISC-7: All /tmp worktrees checked for uncommitted changes
- [x] ISC-8: Superseded salvage branches identified against merged packets
- [x] ISC-9: compute.py output matches compute.msb OUTPUT CONTRACT
- [x] ISC-10: compute tests cover exact contract keys
- [x] ISC-11: compute tests cover error paths
- [x] ISC-12: file_read.py output aligned per packet-124 intent
- [x] ISC-13: file_read alignment covered by updated tests
- [x] ISC-14: Other salvage branches landed or closed with reasons
- [x] ISC-15: roulette-wheel selection implemented without NotImplementedError
- [x] ISC-16: truncation selection implemented without NotImplementedError
- [x] ISC-17: Unit tests pass for roulette-wheel selection
- [x] ISC-18: Unit tests pass for truncation selection
- [x] ISC-19: Selection tests deterministic under seeded RNG
- [x] ISC-20: Spawning/fitness gap mapped against ROADMAP intent
- [x] ISC-21: Evolution design reviewed by alienclaw-architect
- [x] ISC-22: Tractable evolution increment landed or scoped packet written
- [x] ISC-23: Canonical alienclaw.net location determined with evidence
- [x] ISC-24: Live site verified covering ROADMAP content except donate (needs destination decision)
- [x] ISC-25: Live site verified via HTTP probes; retired site/ guarded
- [x] ISC-26: Every code change landed via green-CI PR
- [x] ISC-27: code-review skill run on changes before merge
- [x] ISC-28: Full suites green on main at completion
- [x] ISC-A1: No unmerged branch content deleted
- [x] ISC-A2: No production deploy without explicit confirmation
- [x] ISC-A3: No architecture wall violations introduced

## Decisions

- Architect BLOCKED the original sketch: capital-S term is wall-check-banned (renamed to Subagent in packet 17), persistent per-domain agents are a rejected anti-pattern, and direct population access violates the bridge seam. Re-scoped to CreatorBot.buildSubagent + DomainResolver + fromPopulation:true (PR #120).
- Site pivot: live alienclaw.net is the Next.js app (alienclaw-site repo) — repo site/ is retired; deploy.sh now refuses without ALIENCLAW_DEPLOY_LEGACY_SITE=1 (--dry-run still allowed). Donate button deferred: no sponsorship destination exists to link.
- Salvage: 6 branches landed as PRs (#114 #115 #116 #117 #118 #119 + rework #113), 4 deleted as superseded with evidence, dirty-worktree diffs archived under this PRD's salvage/ (test files renamed *.salvaged so vitest/CI skip them).
- Code review (8 angles + verify): 0 correctness bugs in session diffs; TS fileReadAdapter contract violation found adjacent and fixed (PR #121); 3 cleanups applied pre-merge; immaterial efficiency nits rejected.

## Verification

Final gate on main 09636dd0: 950 pytest passed + full vitest suite green, 0 open PRs, 0 queued runs. Session PRs all squash-merged: #111 (gitignore+PRD), #112 (selection), #113 (file_read py), #114 #115 #116 #117 #118 #119 (salvage), #120 (buildSubagent), #121 (TS adapter), #122 (ROADMAP+deploy guard). Wall-check and governance/integration suites green throughout.
