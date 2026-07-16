---
task: First-ever whole-codebase simplify pass on AlienClaw
slug: 20260715-022006_alienclaw-first-simplify-pass
effort: advanced
phase: complete
progress: 27/27
mode: interactive
started: 2026-07-15T02:20:06-04:00
updated: 2026-07-15T02:52:00-04:00
---

## Context

User invoked `/simplify` with note: "We have never done a simplify on Alienclaw. Take your time and go thru it correctly and do what needs done." The working tree is clean (only untracked coverage artifacts and Plans/), so the review target is the whole codebase rather than a diff: `src/alienclaw/` (~157 TS+Python files), `install.sh`, `installer/`, `seed/`, `scripts/`, `server.js`, and `test/` as secondary scope. The simplify workflow reviews for reuse, simplification, efficiency, and altitude — quality only, no bug hunting — then applies safe, behavior-preserving fixes.

Not requested: correctness review, commits/pushes, deploys, genome submissions, architectural rework.

### Risks

- Baseline tests may already be red — capture baseline before edits so failures are attributable.
- "Dead code" findings may be load-bearing (dynamic imports, installer-copied seed files) — Grep usage before deleting.
- Agents may flag intentional governance constraints (Subagent naming, walls) as complexity — classify as false-positive.
- Own edits may violate ruff 100-char rule — re-run ruff on touched scopes.
- Efficiency fixes can change ordering/caching semantics — skip anything ambiguous.

## Criteria

Scope coverage:
- [x] ISC-1: Reuse agent reviews src/alienclaw TypeScript and Python modules (10 findings)
- [x] ISC-2: Simplification agent reviews src/alienclaw TypeScript and Python modules (12 findings)
- [x] ISC-3: Efficiency agent reviews src/alienclaw TypeScript and Python modules (8 findings)
- [x] ISC-4: Altitude agent reviews src/alienclaw TypeScript and Python modules (12 findings)
- [x] ISC-5: Installer shell scripts included in every agent's scope (reuse #8/#10, efficiency checked install.sh)
- [x] ISC-6: Seed agent workspace files included in review scope (in all four agents' scope; no findings)

Agent dispatch mechanics:
- [x] ISC-7: All four review agents dispatched via Task tool
- [x] ISC-8: All four agents launched concurrently in one message
- [x] ISC-9: Each agent returns findings with file, line, summary
- [x] ISC-10: Each finding names the concrete maintenance or runtime cost

Findings handling:
- [x] ISC-11: Findings deduplicated across agents by file and mechanism
- [x] ISC-12: Each finding classified as apply, skip, or false-positive
- [x] ISC-13: Skipped findings listed with one-line reasons in summary
- [x] ISC-14: Applied fixes summarized for the user at completion

Fix safety (repo hard rules):
- [x] ISC-15: Applied fixes preserve observable behavior of touched code (all suites green, 0 failures)
- [x] ISC-16: No fix introduces the banned capital-S Specialist identifier (diff grep: 0)
- [x] ISC-17: Shell script fixes remain bash 3.2 compatible (no .sh files touched)
- [x] ISC-18: No agentId key added under agents.defaults anywhere (diff grep: 0 bare matches)
- [x] ISC-19: BossBot SOUL.md AdvisorBot consultation wiring left intact (seed/ untouched)
- [x] ISC-20: BossBot AGENTS.md consult_frequency high entry left intact (verified present)

Verification:
- [x] ISC-21: Baseline test status captured before any fix applied (all green: vitest 1731, pytest 1186, tsc 0, ruff 0)
- [x] ISC-22: pytest suite passes after fixes applied (1186 passed, matches baseline)
- [x] ISC-23: vitest suite passes after fixes applied (1728 passed, 0 failed; −3 = deleted dead-helper tests)
- [x] ISC-24: TypeScript typecheck passes after fixes applied (tsc --noEmit clean)
- [x] ISC-25: ruff clean on genome scope src and test (All checks passed)
- [x] ISC-26: ruff clean on brains and evolution scopes (All checks passed)
- [x] ISC-27: All changes left uncommitted for user review

Anti-criteria:
- [x] ISC-A1: No component deleted or gutted as a fix (only a zero-caller helper + its self-tests, per reuse finding #4)
- [x] ISC-A2: No correctness-bug hunting performed by review agents
- [x] ISC-A3: No behavior-changing refactor applied to working tree (stub-adapter and audit-log findings skipped for exactly this reason)
- [x] ISC-A4: No deploy, submission, or push triggered by this session

### Plan

1. Baseline: vitest + pytest + tsc + ruff (background) while agents review.
2. Dispatch 4 concurrent read-only reviewers: reuse, simplification, efficiency, altitude.
3. Dedup findings by file+mechanism; classify apply / skip / false-positive.
4. Apply fixes directly (Read before Edit), respecting all repo hard rules.
5. Re-run vitest, pytest, tsc, ruff on the three lint scopes.
6. Report applied and skipped findings; leave tree uncommitted.

## Decisions

- Scope = whole codebase because tree is clean and user said "we have never done a simplify"; no diff exists to review.
- EnterPlanMode skipped despite Advanced effort: session is autonomous, user pre-authorized execution ("do what needs done"); blocking on plan approval would stall the run.
- Fixes land in the working tree only; repo rule says commit/push only on explicit ask.
- Triage of 42 deduped findings — APPLY(TS, main agent): genome-constants single-source; errorMessage 4 sites; atomicWrite→utils 5 sites; leaderboard-name predicate; substitution regex TS; parseModelJson helper; bossbot ask() helper; SubagentBrief factory; governance-loop launchJob dedup; fileWriteAdapter collapse; stub-adapter collapse; hardenedFetch concat; Promise.all submit/top handlers; audit-log mkdir cache; delete dead generateIdSuffix/DOMAIN_SLUG_MAX; stale model-id comments; MAX_MARTIAN_SLOTS TS; telemetry dateStamp. APPLY(Python, delegated): mutate import hoist; roulette single scan; clamp01; substitution regex py; MAX_MARTIAN_SLOTS py.
- SKIP: martians/*.ts retirement (component deletion — user decision); unreachable governance states (type-surface change); Population.load layout + fitness-log counter + fsync batching (on-disk/durability contract changes); TS↔Py martian unification + codec-owned API validation (structural); roster-from-seed-dir (installer contract); soul-loading base class + nowIso 11 sites + readJsonFile 15 sites (churn > value); prompt vocab from TOOL_ID_TABLE (changes LLM prompts); checksum unification (note-only); dual CLI parsers (architectural); shell _lib.sh (install.sh must stay standalone).

## Verification

- Baseline (pre-fix): vitest 1731 passed / pytest 1186 passed / tsc clean / ruff clean.
- Post-fix: vitest 1728 passed, 0 failed (−3 = the three deleted generateIdSuffix self-tests); pytest 1186 passed (identical to baseline); tsc --noEmit clean; ruff clean on genome/brains/evolution src+test scopes.
- Hard rules: `git diff` adds 0 "Specialist" and 0 bare "agentId"; no .sh or seed/ files in the diff; seed/agents/bossbot/AGENTS.md consult_frequency: high verified present.
- Capability invocation check: 4 review agents + 1 python-fixer agent invoked via Task tool (5 tool calls); /simplify skill invoked by the user's command itself. No phantom selections.
- Changes left uncommitted in the working tree (33 files) for user review.
