---
task: Ship leaderboard end-to-end: evolve, submit, site fixes
slug: 20260703-083151_ship-leaderboard-end-to-end
effort: advanced
phase: complete
progress: 24/24
mode: interactive
started: 2026-07-03T08:31:51-0400
updated: 2026-07-03T08:50:00-0400
---

## Context

Approved plan: Plans/snazzy-exploring-honey.md (2026-07-03 version). Make the live site's "Submit a genome" promise true: fix the sync-layer population-layout bug, fix the site's API-contract mismatches, add `alienclaw evolve` and `alienclaw submit` CLI commands reusing the existing runner/leaderboard/client machinery, untrack .packet-reports, close moot packet-36 branch. Wave-3 production submission and site deploy are HELD for explicit user go. No API redeploy.

## Criteria

- [x] ISC-1: Live API health, stats, types verified
- [x] ISC-2: Site fetch targets read from alienclaw-site source
- [x] ISC-3: Sync layout bug confirmed against evolution/storage.py
- [x] ISC-4: Evolve runner interface confirmed complete
- [x] ISC-5: Auth spec located (self-generated key + install)
- [x] ISC-6: packet-36 mootness verified against current main
- [x] ISC-7: local-population.ts reads entries/ layout with unit tests
- [x] ISC-8: push.ts uses the new reader
- [x] ISC-9: Flat-layout test fixtures migrated green
- [x] ISC-10: Site HeroStats fetches /v1/stats
- [x] ISC-11: Site widget/full use dynamic types, n= param, real field shape
- [x] ISC-12: Site pnpm build exports clean
- [x] ISC-13: .packet-reports untracked and gitignored
- [x] ISC-14: packet-36 branch closed with rationale
- [x] ISC-15: alienclaw evolve runs 2 offline generations via CLI
- [x] ISC-16: evolve/submit registered in args, mjs routing, help
- [x] ISC-17: credentials module writes 0600 key and stable machine hash
- [x] ISC-18: submit round-trips against a local API server or mocked fetch suite
- [x] ISC-19: All PRs green-CI squash-merged; full pnpm test green on main
- [x] ISC-20: README leaderboard quickstart with correct .genomes example
- [x] ISC-A1: No production submission without explicit go
- [x] ISC-A2: No site or API deploy without explicit go
- [x] ISC-A3: No scheduler auto-wiring into run
- [x] ISC-A4: Wall-check stays green

## Decisions

- Fix the limit/n mismatch site-side: zero API redeploy.
- Manual submit only; SyncScheduler stays unwired (opt-in follow-up) — no surprise background POSTs, no pooled ALIENBOT handle.
- packet-36 not rebased: README target section gone, pnpm-workspace superseded; only .packet-reports untracking survives.

## Verification

Ship gate on main 5b33a471: 953 pytest + full vitest green, 0 open PRs. Landed: #126 (.packet-reports untracked), #127 (sync entries/ layout fix + readOperatorBest), #128 (alienclaw evolve + parseCliArgs interpreter-basename fix; offline 2-gen sanity run green), #129 (alienclaw submit + credentials + validateLeaderboardResponse server-contract fix), alienclaw-site#2 (HeroStats /v1/stats, dynamic types, n= param, real field shapes; static export green). packet-36 branch deleted after salvaging its intent. Two real pre-existing bugs found and fixed en route: CLI interpreter-prefix detection (every command fell through to the OpenClaw passthrough) and the pull-path validator requiring a field the deployed server omits. Wave 3 (staging submission, first prod submission, site deploy) remains HELD for the user.
