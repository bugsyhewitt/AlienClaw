---
task: Hardening round: coverage, sync seeds, limits, knobs
slug: 20260703-120123_hardening-round
effort: advanced
phase: complete
progress: 27/27
mode: interactive
started: 2026-07-03T12:01:23-0400
updated: 2026-07-03T12:01:23-0400
---

## Context

User: "What else can we move forward on and improve?" Unblocked improvement surface after the leaderboard ship: 7 untested Python modules (brains/decoder, bridge/server, diagnostics/per_genome_capture, evolution/bridge_runner, fitness/function, genome/types, martians/types); TS governance coverage ratchet stale at 68/65 (ci.yml comment says raise as tests land); pull.ts writes flat network-*.json seeds Python never reads (noted follow-up from PR #127); 10 MiB limit duplicated across 3 Python tools; selection_strategy config knob (altitude finding, default-preserving); site lint debt (setState-in-effect) + single-tab UX; archived max-attempts patch (749 lines) needs land/rework/drop verdict. NOT touching: Subagent goal-loop thread (parallel session owns it, #123–#125), Wave-3 deploys/donate (held on user).

## Criteria

- [x] ISC-1: fitness/function.py direct unit tests landed
- [x] ISC-2: genome/types.py direct unit tests landed
- [x] ISC-3: martians/types.py direct unit tests landed
- [x] ISC-4: brains/decoder.py direct unit tests landed
- [x] ISC-5: bridge/server.py direct unit tests landed
- [x] ISC-6: evolution/bridge_runner.py direct unit tests landed
- [x] ISC-7: diagnostics/per_genome_capture.py direct unit tests landed
- [x] ISC-8: Current TS governance coverage measured with CI-identical command
- [x] ISC-9: Ratchet raised to measured-minus-margin, CI green
- [x] ISC-10: pull.ts writes entries/ files in PopulationEntry shape
- [x] ISC-11: Round-trip test proves Python read_all_entries consumes pulled seeds
- [x] ISC-12: limits module unifies the three 10-MiB sites
- [x] ISC-13: Tool behavior identical after limits unification (suites green)
- [x] ISC-14: EvolutionConfig gains selection_strategy defaulting to tournament
- [x] ISC-15: generation.py dispatches strategy; default path byte-identical behavior
- [x] ISC-16: Strategy dispatch covered by seeded tests
- [x] ISC-17: Site lint error fixed (setState-in-effect)
- [x] ISC-18: Site tabs show populated union base types
- [x] ISC-19: Site build exports clean
- [x] ISC-20: max-attempts archive assessed with explicit verdict
- [x] ISC-21: Verdict executed (landed, reworked, or documented drop)
- [x] ISC-22: Every change lands via green-CI squash-merged PR
- [x] ISC-23: Full pnpm test green on main at end
- [x] ISC-24: code-review run on hand-written src changes before merge
- [x] ISC-A1: No production submission or deploy
- [x] ISC-A2: No changes to the Subagent goal-loop thread files beyond what my PRs require
- [x] ISC-A3: Wall-check stays green

## Decisions

- max-attempts verdict: REWORK executed (#137) — archived design re-implemented over MSB-aligned tools; defaults byte-preserved.
- Both module-test agents died on the session usage limit mid-flight; work salvaged from their worktrees (one had even opened PR #135; the other's files were committed and shipped as #136).
- Mid-round bug of my own: a persisted `cd` into an agent worktree scattered edits across trees — consolidated; lesson recorded.
- CI lint (ruff E501) caught in-wave on #133; fixed, and remaining branches pre-linted with CI's exact scopes before resuming. Pre-existing: 56 ruff errors in dirs CI does not lint (test/martians, bridge, diagnostics, fitness) — future hygiene packet.

## Verification

Final gate on main 8443e219: 1122 pytest + full vitest green, 0 open PRs. Landed: #131 (pull seeds Python-readable, cross-language round-trip proven), #132 (shared 10 MiB limit), #133 (selection_strategy knob), #134 (governance coverage ratchet 68/65 → 82/77, verified with the CI-identical command), #135 (92 tests: fitness/genome-types/martians-types/decoder), #136 (53 tests: bridge server/bridge_runner/per_genome_capture), #137 (max_attempts honored in http_get/url_fetch/web_search, 18-case retry suite), site PR #3 (lint clean + union tabs). Code-review (low): no findings.
