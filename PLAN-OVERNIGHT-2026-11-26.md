# Overnight Plan — 2026-11-26 (17:45 → 01:30 ET)

Branch `overnight/2026-11-26` (from origin/main `401f4099`), worktree
`.claude/worktrees/overnight-2026-11-26`. Push the branch; never merge to main.

## Parked until morning (Bugsy's six questions)

Not doing tonight: merge #653 · workflow-scope token or ci.yml edits · octarig · Pho3nix
rate-limit/concurrency/timeout fields · `api/` keep-or-retire and the DB password rotation itself ·
moving code into Pho3nix, necromancer, ToolTime, or a V3X OSS repo.

## Ground rules

- Every extraction is a **copy** into `staging/<package>/`. Sources stay untouched.
- Each staged package: own packaging file, README, `PROVENANCE.json` (source path + git blob sha
  for every copied file), and its own tests.
- Unique package names so nothing shadows `alienclaw` on `PYTHONPATH`.
- No installs inside `staging/`; reuse root `node_modules` and the system Python.
- Tests are network-free.
- Every test suite, typecheck, or build runs through `heavy.sh` (`flock /tmp/alfred-heavy.lock`,
  only with MemAvailable > 4 GB).
- Subagents write only inside their assigned folder and never run git writes; the coordinator
  commits after each agent lands.
- No `.env*` file is opened. No secret values in any file.

## Steps

### Wave 1 — extraction + docs (8 parallel agents)

1. **Sandbox (Python)** → `staging/agent-tool-sandbox/python/`: package `agent_tool_sandbox`
   (SSRF guard + filesystem boundary jail), boundary root passed in rather than read from
   OpenClaw env, ported tests, parity test against the in-tree modules, PR #630 CGNAT note.
2. **Sandbox (TypeScript)** → `staging/agent-tool-sandbox/ts/`: `hardened-fetch` without the
   leaderboard policy, own tsconfig, ported SSRF vector tests, parity against the in-tree module.
3. **GA engine (Python)** → `staging/ga-engine/`: package `alienclaw_ga` = genome codec +
   evolution spine (generation, population, selection, storage, stats, types) + the
   DROP-free diagnostics; ported genome/evolution tests; cross-language fixture.
4. **Genome codec (TypeScript)** → `staging/genome-ts/`: TS mirror of the codec + operators,
   passing the shared `genome-spec-fixtures.json`.
5. **DROP archive manifest** → `staging/tools/build_drop_manifest.py` + test, generating
   `docs/salvage/DROP-ARCHIVE-MANIFEST.md` and `docs/salvage/drop-manifest.json` (per-file blob
   sha, LOC, KEEP→DROP inbound imports, CI steps that reference each area, tag + bundle).
6. **DB rotation scope** → `docs/salvage/DB-ROTATION-SCOPE.md`: every consumer of
   `ALIENCLAW_DB_URL`, runbook with rollback, blast radius, no secret values.
7. **Teardown pass 2 prep** → `staging/teardown-pass2/`: the ci.yml change as a `.patch` file
   (not applied), the decoupling plan for `bridge_runner`/`live_evo`/`__main__`/diagnostics,
   and a dry-run script that applies pass 2 in a throwaway worktree and runs the required suites.
8. **Stranded-work inventory** → `docs/salvage/STRANDED-WORK.md`: every local worktree, branch,
   and stash touching AlienClaw, with pushed/merged status and a disposition. Deletes nothing.

9. Coordinator: review each landing (`git status` limited to the assigned folder), run its
   tests under the lock, commit, push.

### Wave 2 — dependent extractions + review (6-8 parallel agents)

10. **Recon HTTP suite** → `staging/pho3nix-recon-http/` (http_get, url_fetch, web_search,
    search_text) importing the staged sandbox, network-free tests.
11. **Necromancer tuners** → `staging/necromancer-tuners/` (mangle, ouija) re-pointed at
    `alienclaw_ga`, tests with Ollama mocked.
12. **Pho3nix tuner** → `staging/pho3nix-tuner/` re-pointed at `alienclaw_ga`, tests including
    the `--dry-run` STOP gate.
13. **ToolTime bounds proposal** → `staging/tooltime-bounds/`: JSON Schema for
    `min`/`max`/`direction`, validator, tests, checked read-only against real ToolTime output.
14. **OSS extraction plan** → `docs/salvage/OSS-LIB-EXTRACTION-PLAN.md`, written against the
    actual staged sandbox packages: names, API, license, versioning, CI, pre-publication gates.
15. **Independent security review** of the staged sandbox (security-engineer agent) and an
    architecture review of `alienclaw_ga` boundaries + the pass-2 plan (alienclaw-architect).
16. **Drift control** → `staging/tools/check_drift.py` + test: every `PROVENANCE.json` entry
    still matches its source blob, or the divergence is declared.

### Wave 3 — hardening + CI

17. Fix or park review findings; run `/simplify` and `/code-review` over the staged code; run
    every staged suite once more under the lock; `staging/README.md` index.
18. Open a **draft** PR `overnight/2026-11-26 → main` for CI signal only, drive the three
    required checks green, then write `NIGHT-REPORT-2026-11-27.md` (done, the six decisions
    with a recommendation each, next wave).

Waves after 3 are planned from what's left when wave 3 lands.
