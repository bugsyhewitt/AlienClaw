# Stranded Work Inventory — AlienClaw

**Date:** 2026-11-26 (overnight salvage pass, Wave 1 step 8)
**Repo:** `bugsyhewitt/AlienClaw`, main checkout `/home/xil/dev/alienclaw`
**Reference point:** `origin/main` = `401f4099` (#652). The live remote heads were read with
`git ls-remote`. Nothing was fetched.
**Method:** read-only. Worktree status was read with `git --no-optional-locks status --porcelain`.
Content comparisons used `git diff`, `git cherry`, `git hash-object` (without `-w`), and the
merged PR list from `gh pr list --state all` (653 PRs). Nothing was checked out, reset, stashed,
deleted, fetched, committed or pushed. No index-writing command was run.
**Out of scope:** `.claude/worktrees/overnight-2026-11-26` and `.claude/worktrees/pass2-dryrun`
(tonight's work; `pass2-dryrun` is detached at `401f4099` = `origin/main`).

How to read "in main %": the share of a branch's added lines (longer than 12 characters, with
whitespace trimmed) that already appear in the same file on `origin/main`. It is a heuristic for
squash-merged or re-authored work, not a proof.

---

## 1. Summary

### 1.1 Counts

| Kind | Total | Unique unshipped work | Already in main or on origin |
|---|---|---|---|
| Worktrees (stranded) | 8 | 6 (the release stack) | 2 (`agent-*`, shipped in #593) |
| Main checkout | 1 | 0 (its branch is pushed as PR #653) | — |
| Stashes | 8 | 7 | 1 (PKT-1443, superseded by #635) |
| Local branches | 471 | 2 significant + 6 release-stack + 11 small or superseded | 452 merged, pushed, or alias refs |

### 1.2 Summary table

| Item | Kind | Unique unshipped work? | Recommended disposition |
|---|---|---|---|
| `tmp-wt/ac-pr5-contracts` (`release/pr5-contracts`) | worktree | **yes**: 7 commits plus **8 uncommitted modified files** | needs Bugsy decision (archive to bundle first; save the uncommitted diff) |
| `tmp-wt/ac-c23-fault-harness` (`release/c23-fault-harness`) | worktree | **yes**: 4 commits plus **1 untracked write-up** | needs Bugsy decision (archive to bundle first; copy the untracked doc) |
| `tmp-wt/ac-pr2-cuts` (`release/pr2-cuts`) | worktree | yes: 11 commits (C3–C12 cuts) | needs Bugsy decision; overlaps teardown #653 |
| `tmp-wt/ac-pr3-honesty` (`release/pr3-honesty`) | worktree | yes: 6 commits | needs Bugsy decision |
| `tmp-wt/ac-pr4-run-ready` (`release/pr4-run-ready`) | worktree | yes: 6 commits | needs Bugsy decision |
| `tmp-wt/alienclaw-release-simplify` (`simplify/release-readiness`) | worktree | yes: 12 commits (the base of all five above) plus 1 ignored PRD file in no commit | needs Bugsy decision; archive to bundle |
| `.claude/worktrees/agent-a90125425fa56c1f6` | worktree | no (7/8 files byte-identical to #593; the 8th is a draft #593 replaced) | already merged → safe to clean later |
| `.claude/worktrees/agent-aba0449464cc02ddc` | worktree | no (12/12 files byte-identical to #593) | already merged → safe to clean later |
| `/home/xil/dev/alienclaw` on `chore/teardown-pass1` | main checkout | no (pushed, PR #653 open) | leave; note that local `main` is 6 ahead of `origin/main` |
| stash `58b64f7a` (genome operators Base62 precondition) | stash | **yes** | ship via PR (genome/ is KEEP; add a test) |
| stash `f3711d7c` (PKT-1477 MI bias-correction clamp) | stash | **yes** | ship via PR (diagnostics/ is KEEP; add a test) |
| stash `55a181fe` (PKT-1313 Unicode `id_tag`, 2 sites plus tests) | stash | **yes** | ship via PR (KEEP modules; tests included) |
| stash `dd597f7b` (live_evo watermark atomic write plus flock) | stash | **yes** | needs Bugsy decision (live_evo is a pass-2 decoupling target) |
| stash `aa2fe241` (web_search output keys matching the MSB contract) | stash | **yes** | needs Bugsy decision (changes output keys) |
| stash `002e9a09` (api client-ip IPv4-mapped IPv6 parsing) | stash | **yes** | needs Bugsy decision (api/ is DEFER) |
| stash `653e8fb1` (sync pull uses `verified_fitness`, T7/T10) | stash | **yes** | archive to bundle (governance/ is DROP; base file changed since) |
| stash `b9d78be0` (PKT-1443 agent-channel cleanup) | stash | no (superseded by #635) | already merged → safe to clean later |
| `feat/1464-goal-manager-write-path-subgoals-envelope` | branch, local-only | **yes**: REVISE round 2 never shipped | needs Bugsy decision (governance/ is DROP) |
| `feat/pkt-1468-scanner-variant` | branch, local-only | **yes**: 7 commits, quote-aware SQL scanner | needs Bugsy decision; ship via PR if `api/` stays deployed |
| `fix/pkt-468-parsemodeljson-anchor-fence-strip`, `test/309-…`, `feat/360-…` | branches, local-only | yes, small (legacy or DROP areas) | archive to bundle |
| 7 superseded local-only branches (§3.3) | branches, local-only | no (a merged implementation exists) | archive to bundle → clean |
| `fix/103-runcompletionflow-invalid-transition` | branch, local-only, PR #96 closed | June work, 78% in main | archive to bundle |
| 16 alias or duplicate local-only refs (§3.3) | branches | no | already merged → safe to clean later |
| 309 branches fully contained or patch-equivalent (`cherry -`) | branches | no | already merged → safe to clean later |
| 33 branches squash-merged (local head = merged PR head) | branches | no | already merged → safe to clean later |
| 28 branches merged with small diverged residue (§3.2) | branches | no (residue superseded by later packets) | already merged → safe to clean later |
| 4 branches with an open PR (#653, #630, #631, #632) | branches, pushed | n/a | leave; #630–632 are stale (Oct 18) and need Bugsy decision |
| 62 pushed branches with no merged PR (§3.4) | branches, pushed | yes, but already on origin | the local ref is safe to delete; pruning the remote copies is Bugsy's call |

---

## 2. Worktrees

None of the stranded worktrees has a live process with its cwd inside it. No `alienclaw` systemd
user units are active. None of them has a rebase, merge or cherry-pick in progress.

### 2.1 The release stack (six worktrees under `/home/xil/tmp-wt/`)

All five `release/*` branches sit on top of `simplify/release-readiness`. All six are based on
`a04c6dc7` (#605), which is **17 commits behind `origin/main`**. None has an origin branch or a
PR. `git cherry` shows every commit as unique (`+`). They implement the council release plan
`/home/xil/dev/alienclaw/Plans/council-3-member-council-to-crystalline-orbit.md`. Its execution PRD
(ignored, in the simplify worktree) stopped at **6/14**. These are still open: ISC-2 (PR2 green),
ISC-5 (PR5), ISC-6 (C23 verdict), ISC-7 (stacked without conflicts) and ISC-11 (Bugsy confirming
the destructive Phase 0: history scrub, force-pushing 132 branches, closing #630–632, stopping the
fleet units). Since then the project pivoted: the Nov 14–20 repurpose and the salvage
`PLAN.md`/`SALVAGE.md` mark governance/, cli/, agents/ and the leaderboard product as DROP or DEFER.
Much of this stack therefore targets surfaces that are being retired. It is still the only copy of
that work.

**Backup coverage:** `/home/xil/Backups/alienclaw-local-branches-20261031.bundle` (written
2026-10-31 20:58) holds `simplify/release-readiness` at its current tip `7d5ee3ab`. It holds every
`release/*` branch only at `7d5ee3ab`, so **the 34 commits made after 20:58 on the five release
branches exist in no backup**. The local tags `park/diagnostics`, `park/graph-reflective` and
`park/hermes` point at `7d5ee3ab` and are not on origin.

| Worktree | Branch @ HEAD | HEAD date, subject | Porcelain | Own commits (above simplify) |
|---|---|---|---|---|
| `/home/xil/tmp-wt/alienclaw-release-simplify` | `simplify/release-readiness` @ `7d5ee3ab` | 2026-10-31 20:55 "chore: stop committing session PRDs; MEMORY/ is local-only" | 0 tracked changes. Ignored `MEMORY/`: 63 files; 62 are byte-identical to `6d9b408d`; **1 is in no commit**: `MEMORY/WORK/20261031-000500_execute-council-release-plan/PRD.md` | 12 (the base) |
| `/home/xil/tmp-wt/ac-pr2-cuts` | `release/pr2-cuts` @ `095e3592` | 2026-10-31 21:13 "docs(src): update the module table for the PR 2 cuts" | 0 | 11 (C3–C12) |
| `/home/xil/tmp-wt/ac-pr3-honesty` | `release/pr3-honesty` @ `1926bfc9` | 2026-10-31 21:18 "test(evolve): default inputs resolve from the package, not CWD" | 0 | 6 (C1, C13, C23 framing, C25, C26) |
| `/home/xil/tmp-wt/ac-pr4-run-ready` | `release/pr4-run-ready` @ `e1bf6df5` | 2026-10-31 21:22 "test: pin ALIENCLAW_HOME in the two default-path tests" | 0 | 6 (C15, C2, C16) |
| `/home/xil/tmp-wt/ac-pr5-contracts` | `release/pr5-contracts` @ `c4b04b44` | 2026-10-31 21:32 "feat(evolution): record the run's fitness_formula_version in population entries (C22)" | **8 modified, uncommitted** (" M"; the index matches HEAD, so this is real WIP and not index drift) | 7 (C18, C19, C20, C22, C24) |
| `/home/xil/tmp-wt/ac-c23-fault-harness` | `release/c23-fault-harness` @ `6eb4ace1` | 2026-10-31 21:46 "feat(experiments): C23 pass test resists generation-0 luck; undirected mode" | **1 untracked**: `docs/experiments/c23-fault-injection.md` (16 KB, 21:45) | 4 |

**What each one is**

- **simplify/release-readiness.** The Oct 30 "what can it really do" pass: run surfaces LLM
  errors and exits (`e934bbf4`); evolve reports the last evaluated generation (`602b7698`); lazy
  run path plus `--version` repair; an empty-leaderboard message; removal of 4,314 lines of
  unreachable duplicate code paths (`30d7a99c`); one `ALIENCLAW_HOME` rule for every reader and
  writer (`f739719d`); NaN-safe `clamp01` plus the codec reusing the genome alphabet (`5830ce23`,
  which touches genome/ and fitness/, both KEEP); one `envInt` parser; a `pnpm alienclaw` script;
  `docs/RELEASE_ASSESSMENT.md` (`5ffd5a9c`, the keep/cut verdict the salvage PLAN cites as
  "unpushed"); and MEMORY/ untracked. Spot check: main's `clamp01` is still not NaN-safe.
- **release/pr2-cuts.** One commit per cut: it removes fitness-update/advise-from-telemetry/live-evo
  jobs (C3), the TS msb executor (C4), evolution/graph and reflective (C5, parked), diagnostics
  except the live modules (C6), the TS martian parser/registry/validator/operators (C7), TS
  hardened-fetch (C8), the Hermes host (C9, parked), the in-repo site (C10), the chrome extension,
  reskin scripts and labeler config (C11), and it trims `.env.example` (C12). **Overlap:** 31 of
  its 168 deleted paths are also deleted by teardown PR #653 (seed/agents-hermes, the chrome
  extension, installer scripts, test/site, install-hermes.sh). C8 cuts `net/hardened-fetch.ts`,
  which the salvage PLAN now rates **KEEP + SELLABLE**. Do not land C8 as written.
- **release/pr3-honesty.** Ships default evolve inputs only for the three types that show a fitness
  gradient (`compute_then_validate`, `compute_then_write`, `write_then_verify`); README/CLAUDE.md/
  ROADMAP honesty; `--type` and `--martian-type` on every verb; `run` marked experimental; the
  OpenClaw prompt pack stops claiming genome tools.
- **release/pr4-run-ready.** Model ids configurable via `ALIENCLAW_MODEL_POWER/FAST`; absolute
  PYTHONPATH and seed registries from the package location (C2); `run` exits on a terminal goal
  (C16); a named error for unknown model ids (C15).
- **release/pr5-contracts.** Bridge validates `run_metadata.correctness` (C18); `storage_version`
  stamped in population metadata (C19); `fitness_version`/`msb_version` stamped on submissions
  (C22); tolerant leaderboard parser, labelled unverified rows, warn-only submit gate (C20/C24);
  fitness ties ranked by earliest submission (C24); `/v1/martian-types` from one cached GROUP BY.
  **Uncommitted WIP** is the plan's last PR5 step, "restrict `_REGISTERED` to shipped types
  (C13)": `src/alienclaw/api/registered-types.ts` shrinks the accepted list from 16 names to the
  three shipped types, and `docs/specs/LEADERBOARD_API_SPEC.md` plus 6 test files are updated to
  match (+91/−63). It was edited at 21:35, after the last commit. This is a public-API behavior
  change, because the board would stop accepting `web_search` and the others.
- **release/c23-fault-harness.** A seeded fault-injection mode for the compute tool with grading
  against `expected` (`5a3023c8`, tools/ KEEP); the C23 experiment script plus committed inputs;
  `run-experiment` attaching each slot's brain for directed mutation (`d24f7b82`, evolution/ KEEP);
  and a pass test that resists generation-0 luck. The **untracked** write-up records the result:
  **Pass**. The best `max_attempts` moves with the fault rate (k\*=1 at p=0.10, k\*=4 at p=0.32);
  directed evolution found the joint optimum in 6 of 6 runs. That is direct evidence for the
  repurposed GA thesis, and the only copy of the document is this untracked file.

### 2.2 `.claude/worktrees/agent-a90125425fa56c1f6`

- Branch `worktree-agent-a90125425fa56c1f6` @ `ef778201`, 2026-09-08 09:45, "feat(p2): new
  standalone files — cache, client-ip, migrate, migrations, perf, API spec". Porcelain: 0.
- 1 commit not on `origin/main` (behind 56); no origin branch; cherry `+1`; no PR from this branch.
- **Shipped via #593** (`feat/p2-api-leaderboard`, merged 2026-09-08). 7 of 8 files are
  byte-identical to #593's tree. The 8th, `migrations/004_verified_fitness.sql`, is the earlier
  `IF NOT EXISTS` draft, which #593 deliberately replaced for MySQL 8.0.
- A subagent output from the P2 API hardening run. In the Oct 31 bundle. 8.1 MB.

### 2.3 `.claude/worktrees/agent-aba0449464cc02ddc`

- Branch `worktree-agent-aba0449464cc02ddc` @ `8453872d`, 2026-09-08 10:03, "feat(p2): harden
  existing API files — crash handlers, pool, cache, rate-limit, health, verified split, identity,
  sync quarantine". Porcelain: 0.
- 1 commit not on `origin/main`; no origin branch; cherry `+1`; no PR.
- **Shipped via #593**: all 12 files are byte-identical to #593's tree. In the Oct 31 bundle.
  220 MB on disk (it has its own `node_modules`).

### 2.4 Main checkout `/home/xil/dev/alienclaw`

- On `chore/teardown-pass1` @ `be1ad3b4` (2026-11-26 14:01), clean, identical to origin, **PR #653
  open**.
- **Local `main` is 6 commits ahead of `origin/main`** (`6fc89359`, not pushed). The commits are
  the repurpose GA Phases 1–3 (`9ab7dcaa`, `b7de00ce`, `a7809017`), the 11-19 handoff, the salvage
  PLAN/SALVAGE docs and a merge of origin/main. All 6 are contained in `chore/teardown-pass1`, so
  they ride on PR #653 and exist on origin, and no work is at risk. If #653 is squash-merged, local
  `main` will diverge from `origin/main`. Reset it then, after a content diff. The tag
  `pre-teardown-20261126` (`6fc89359`) is on origin.

---

## 3. Local branches (471)

| Group | Count | Criterion | On origin | Disposition |
|---|---|---|---|---|
| A. Fully contained | 36 | `origin/main..b` is empty | 0 | safe to clean later |
| B. Patch-equivalent | 273 | every `git cherry` line is `-` | 34 | safe to clean later |
| C. Squash-merged | 33 | a MERGED PR whose head == the local head (or contains it) | 1 | safe to clean later |
| D. Merged + diverged residue | 28 | MERGED PR; the local head was amended after the push | 26 | safe to clean later (§3.2) |
| E. Open PR | 4 | `chore/teardown-pass1` #653; `tester/pkt-1367-…` #630, `tester/pkt-1372-…` #631, `tester/pkt-1373-…` #632 | 4 | leave |
| F. Pushed, no merged PR | 62 | an origin branch exists; the PR is closed or there is none | 62 | local ref safe; remote = Bugsy (§3.4) |
| G. Local-only, closed PR | 1 | `fix/103-runcompletionflow-invalid-transition` (#96 closed) | 0 | archive to bundle |
| H. Local-only, no PR | 34 | no origin branch, no PR | 0 | itemized in §3.3 |

22 branches (excluding tonight's `overnight/2026-11-26`) were created after the Oct 31 bundle
and are not in it. One is `chore/teardown-pass1` (open PR #653), and 19 are merged or superseded.
The 2 that matter are `feat/1464-…` and `feat/pkt-1468-scanner-variant`.

### 3.1 Groups A, B, C

Nothing unique. The cleanup script (§5) re-derives A and B at run time with `git cherry` and
deletes C from an explicit list. Group C:
`feat/1032-evolve-cli-selection-strategy-levers` (#578), `feat/1039-alienclaw-show-top-n-genomes`
(#589), `feat/1443-agent-channel-tmpdir-resurrection-audit-cleanup` (#635),
`feat/267-operators-cold-applyoperator-arms` (#271), `feat/284-correctness-validateschema-cold-branches`
(#296), `feat/335-engine-merge-validate-gate-cold` (#334), `feat/471-submission-id-entropy-widening`
(#402), `feat/472-api-validation-install-null-undefined-type-guard` (#405),
`feat/477-registry-duplicate-id-guard` (#407), `feat/536-weightedpick-contract-violations` (#446),
`feat/file-write-atomic-372` (#354), `feat/governance-loop-processEvent-switch-arms-cold` (#257),
`feat/pkt-1460-campaign-strike-accumulation` (#645), `feat/pkt-1466-error-path-correctness-coercion`
(#639), `feat/pkt-1475-sync-pull-response-shape-guard` (#641), `feat/pkt-576-file-tools-workspace-boundary`
(#462), `feat/pkt-679-storage-genome-length-guard` (#514), `feat/scale-experiment-brain-forwarding`
(#406), `fix/1464-goal-manager-write-path-subgoals-envelope` (#647), `fix/376-search-text-context-lines`
(#356), `fix/506-cli-submit-type-path-traversal` (#430), `fix/586-vitest-exclude-probe-namespaces`
(#468), `fix/pkt-1462-transition-table-quote-aware-fields` (#638), `fix/pkt-408-top-routing-prefix-shadow`
(#380), `fix/pkt-426-seed-installer-copyfile-excl` (#386), `fix/pkt-493-parsemodeljson-extract-json-substring`
(#421), `fix/pkt-537-vitest-collection-scope` (#447), `fix/pkt-555-lineage-parent-ids` (#450),
`fix/pkt-621-online-fitness-read-poison-guard` (#486), `fix/pkt-634-online-fitness-ts-hardening`
(#491), `fix/pkt-674-extractparameterschema-strict-integer-regex` (#510),
`packet-37.1-hpanel-stored-slot` (#15), `test/packet-463-scale-experiment-forward-selection-strategy`
(#396).

### 3.2 Group D (merged PR, local head diverged)

Each branch's diff was compared line by line with its PR's squash commit. Most residues are 0–7
lines. Where the branch changed a source file the PR did not, main now holds a later,
differently-written fix for the same defect: PKT-912 for the SIGKILL grace timer in
`hierarchy-bootstrap.ts`, a `Number.isFinite` range guard in `local-population.ts`, and a named
section-boundary list in `msb-loader.ts` `extractSection`. Nothing here needs shipping.

`feat/322-…` #322, `feat/673-…` #512, `feat/702-fitness-client-validation` #524,
`feat/parseSchemeDraft-martianTags-non-array-passthrough` #362, `feat/pkt-1041-target-fitness` #591
(no origin), `feat/pkt-328-…` #328, `feat/pkt-660-…` #504, `feat/pkt-671-…` #509, `feat/pkt-690-…`
#519, `feat/pkt-691-substitution-ascii-d-parity` #520 (no origin), `feat/pkt-694-…` #521,
`feat/pkt-704-…` #526, `feat/pkt-753-sigkill-timer-leak` #536, `feat/pkt-756-…` #538,
`fix/387-…` #366, `fix/614-cli-shim-shell-false` #481, `fix/pkt-658-…` #503, `fix/pkt-659-…` #502,
`fix/pkt-662-…` #505, `fix/pkt-670-…` #508, `fix/pkt-687-…` #516, `fix/pkt-705-…` #527,
`fix/pkt-727-…` #532, `fix/pkt-737-…` #534, `fix/pkt-756-brains-parser-strict-int-regex` #537,
`fix/pkt-933-atomicwrite-d2-cleanup` #553, `fix/search-text-totalmatches-truncation` #352,
`tester/fitness-nan-inf-defense` #470.

### 3.3 Group H (local-only, no PR), itemized

**Unique and significant (needs Bugsy decision)**

- **`feat/1464-goal-manager-write-path-subgoals-envelope`** (2 commits, 2026-11-12, in main 46%).
  PR #647 shipped the first round, from the sibling branch `fix/1464-…`. This branch also carries
  `630bc04b`, the **round-2 REVISE** after the binding review. It replaces the
  `(goal.subGoals ?? [])` guard in `markGoalComplete` with `Array.isArray`, because a non-nullish,
  non-array `subGoals` value still throws a raw TypeError out of `drain()`. It also links the
  `GoalStatus` union to the runtime list at compile time, corrects a prior-art claim, and grows
  File-A from 15 to 21 cases. **Verified:** `origin/main` `goal-manager.ts:189` still reads
  `(goal.subGoals ?? []).filter(`. governance/ is DROP in the salvage plan, so ship this only if
  governance stays alive until teardown pass 2.
- **`feat/pkt-1468-scanner-variant`** (7 commits, 2026-11-12, behind only 2, in main 14%). This is
  an alternative to the merged #649 (a regex strip of SQL comments, 112 diff lines). It replaces
  the regex strip in `src/alienclaw/api/migrate.ts` `splitStatements` with a quote-aware scanner
  that handles literals, identifiers, MySQL `/*! */` and MariaDB `/*M! */` executable comments,
  and the exact `--` lexical rule. According to the commit messages, every rule was verified
  against MySQL 8.0.46 and MariaDB 13.0.2 through mysql2. Two test files, +597 lines. The deployed
  API runs these migrations. api/ is DEFER (kept alive), so this is a ship-via-PR candidate if
  Bugsy keeps the API.

**Unique, small, in legacy or DROP areas (archive to bundle)**

- `fix/pkt-468-parsemodeljson-anchor-fence-strip` (2026-07-31). Anchors the ```` ``` ```` fence
  strip in `utils.ts parseModelJson` to boundary lines. Main still uses the global replace.
  utils.ts is "DROP (fold)".
- `test/309-ensemble-all-incorrect-fallback` (+11 lines) and
  `feat/360-reviewreviseop-trim-whitespace-arm` (+10 lines). Tests for evolution/graph, which is
  parked.

**Superseded by a merged implementation (archive to bundle, then clean)**

- `feat/1490-cli-status-online-fitness-range-guard`: PKT-1490 shipped as #648 from
  `feat/pkt-1490-…`; main's `status.ts:89-91` has the `[0,1]` guard.
- `feat/pkt-1467-transition-table-states-own-property`: PKT-1467 shipped as #646; 15 of 230
  lines differ.
- `feat/250-rank-based-selection-strategy` (Jul 16): rank selection shipped differently as #577.
- `feat/pkt-467-fitness-ceiling-delegate-to-evaluate`: main's `fitness_ceiling.py` already
  delegates to `fitness.function.evaluate`.
- `tester/pkt-1354-effiency-nan-toolCalls-slotCount` (Oct 12): main's
  `evolution/reflective/objectives.ts` already has `Number.isFinite` guards (lines 22, 41, 43),
  and reflective/ is parked.
- `fix/atomicwrite-fd-vs-path-mock-compat` (Aug 30): writes via path, not fd. This contradicts
  main's PKT-935 fd plus `fsyncSync` durability design. Rejected direction.
- `test/packet-096-discovery` (Jun 20, 4 commits): governance-loop transition fixes; #84 fixed
  the same transition.
- (Group G) `fix/103-runcompletionflow-invalid-transition` (Jun 21, 4 commits, packets 096, 097,
  099 and 103, PR #96 closed, 78% in main).

**Aliases and duplicates (safe to clean later)**

- `pr-605`, `pr/605`, `pr605`, `pr-605-tmp`, `pull-605`, `resolve-pr605-conflict`, `pkt1142-test`:
  all at `b6ac285a` (PKT-1142, shipped as #605, 100% in main).
- `pr-591`: the same sha as `feat/pkt-1041-target-fitness` (#591 merged).
- `pr-630`: the same sha as `tester/pkt-1367-ssrf-cgnat-python-guard` (open PR #630).
- `pr144-rebase`, `pr145-rebase`: the same shas as the pushed `test/online-fitness-clear-coverage`
  and `test/url-fetch-latin1-fallback`.
- `feat/leaderboard-hfetch-error-paths`: a commit plus its revert, net empty.
- `feat/martian-executor-msbdir-default-arm` (100% in main);
  `packet/02-evolve-the-graph` (P14-01, merged as #247, 97% in main).
- `worktree-agent-a90125425fa56c1f6`, `worktree-agent-aba0449464cc02ddc` (§2.2, §2.3).

**Release stack**

`simplify/release-readiness` and `release/{pr2-cuts,pr3-honesty,pr4-run-ready,pr5-contracts,c23-fault-harness}`
(§2.1).

### 3.4 Group F (pushed, no merged PR)

Every one of these exists on origin at the same sha, except where noted. Deleting the local ref
loses nothing. Whether to prune the remote copies is Bugsy's call. Most are July–September tester
packets whose PRs were closed unmerged, many as duplicates of the same PKT re-filed under another
number.

- **Keep:** `main` (§2.4; local is 6 ahead), `overnight/2026-11-26` (tonight),
  `deploy-baseline-20260614` (the rig baseline, 9 commits, June).
- **Differs from origin:** `test/packet-075-martians-parser-unit-tests` has 1 commit that is not
  on origin (`e2633f57`, Jun 20, parseMartian unit tests; martians/ is DROP; a v2 of the same work
  is pushed as `test/packet-075-v2-…`). `packet-37-fix-stored-artifact` is 2 commits **behind**
  its origin branch (PR #14 closed, May).
- **No PR at all:** `test/packet-074-push-leaderboard-name-fixture` (100% in main),
  `test/packet-075-v2-martians-parser-unit-tests`, `test/packet-124-file-read-msb-field-alignment`,
  `fix/pkt-1260b-decision-engine-own-property` (shipped as #644 from `feat/pkt-1260b-…`, 98% in
  main).
- **Closed-unmerged PR (53):** feat/380 #358, feat/389 #369, feat/432 #389, feat/441 #391,
  feat/470 #403, feat/476 #414, feat/481 #410, feat/484 #412, feat/492 #419, feat/499 #424,
  feat/502 #425, feat/api-genomes-catch-internal-error #378, feat/governance-handlejobcomplete-coverage
  #262, feat/parser-findkeycolon-backslash-outside-quotes #258, feat/pkt-466 #398, feat/pkt-518
  #433, feat/pkt694-malformed-sentinel #564, feat/seed-installer-eexist-overwrite-false-silent-skip
  #249, feat/topology-adapter-non-array-subagents #367, feat/transition-table-cold-branch-coverage
  #253, fix/379 #359, fix/384 #363, fix/385 #364, fix/396 #375, fix/491 #418, fix/523 #437,
  fix/532 #442, fix/564 #455, fix/msb-loader-error-format-parity #565, fix/packet-1000 #566,
  fix/packet-1003 #568, fix/packet-998 #569, fix/pkt-1008 #570, fix/pkt-395 #374, fix/pkt-409
  #379, fix/pkt-411 #381, fix/pkt-413 #382, fix/pkt-417 #383, fix/pkt-442 #390, fix/pkt-485 #413,
  fix/pkt-494 #420, fix/pkt-560 #451, fix/pkt-567 #458, pkt-394-online-fitness-log-malformed-json-guard
  #373, tester/atomic-write-d2-fd-mock-fix #563, tester/hermes-inline-comment-no-space #561,
  tester/parser-slot-index-nan-guard #399, tester/real-summon-adapter-spawn-error-handler #562,
  tester/summon-v1-martian-type-shape-guard #400, test/hermes-readconfigmodel-cold-arms-l54-l57-20260719
  #326, test/online-fitness-clear-coverage #144, test/pkt-368-utils-direct-coverage #351,
  test/url-fetch-latin1-fallback #145.
  Low "in main %" (0–6%), meaning the closed fix never landed in any form: feat/380, feat/492,
  feat/476, fix/pkt-560, fix/pkt-413, fix/pkt-411, fix/564, fix/pkt-485, feat/484, test/pkt-368.
  They are safe on origin. Re-filing any of them is a packet-queue decision, not salvage.

---

## 4. Stashes (8)

All 8 are "WIP on (no branch): `a04c6dc7`" (#605, detached `origin/main` of Nov 6–11). All were
authored under the repo's local identity "AlienClaw Tester", so the author field does not identify
the session. The pattern fits the overmind/tester packet executor parking WIP. All are
tracked-file changes except where noted. For 6 of the 7 unique ones, the base file is unchanged on
`origin/main`, so they should still apply cleanly. **No branch or bundle holds any of them.** They
live only in the `refs/stash` reflog. Index numbers shift when anyone pushes or drops a stash, so
address them by SHA.

| SHA | Index (now) | Date | Files | In main | Content | Disposition |
|---|---|---|---|---|---|---|
| `58b64f7a` | stash@{0} | 11-11 23:25 | `genome/operators.py` +30 | no (2/20 lines) | `_assert_base62_genome()` precondition in `mutate()`/`mutate_directed()`: a corrupt stored genome raises the documented `ValueError` instead of a bare `KeyError` several frames away. No test. | ship via PR (genome/ is KEEP + SELLABLE; add a test) |
| `653e8fb1` | stash@{1} | 11-08 23:59 | `governance/common/sync/pull.ts` +28/−1 | no | T7/T10 trust-model repair: the local population takes `verified_fitness`, not the client-claimed `fitness`, and rejects a verified row without a usable value. The base file has changed since. | archive to bundle (governance/ is DROP) |
| `dd597f7b` | stash@{2} | 11-08 20:44 | `evolution/live_evo.py` +89/−10 | no | Watermark read/write made atomic (tmp + fsync + rename) under `fcntl.flock` on a separate lockfile; corruption-tolerant read. No test. | needs Bugsy decision (live_evo is a pass-2 decoupling target) |
| `aa2fe241` | stash@{3} | 11-08 16:09 | `tools/web_search.py` +17/−3 | no | Output keys match the MSB OUTPUT CONTRACT: `snippet`→`excerpt`, `result_count`→`totalResults`, adds `rank`. A behavior change for consumers. | needs Bugsy decision |
| `f3711d7c` | stash@{4} | 11-08 08:18 | `diagnostics/genome_information.py` +12/−1 | no (main line 109 is unchanged) | **PKT-1477**: the MI bias correction may only reduce the estimate. A constant input currently reports positive mutual information (0.125 at n=4). No test. | ship via PR (diagnostics/ is KEEP; add a test) |
| `002e9a09` | stash@{5} | 11-08 07:35 | `api/client-ip.ts` +64/−2 | no | Client-IP normalization: `[v6]:port`, IPv4 with a port, and IPv4-mapped IPv6 in dotted and hex tails. The rate-limit bucket key cannot be minted from a mapped form. | needs Bugsy decision (api/ is DEFER; security-relevant) |
| `55a181fe` | stash@{6} | 11-08 00:40 | `diagnostics/sensitivity_audit.py`, `evolution/population.py` and 2 test files, +231/−6 (the untracked part is empty) | no | **PKT-1313**: `_id_tag_for()` transliterates Unicode martian types (NFKD) so the 8-char `id_tag` stays Base62, at both duplicate sites. The overmind review REJECTED the packet's form (findings-only, tautology gate) but wrote "the defect is real and its fix is correct". | ship via PR (KEEP modules; tests included) |
| `b9d78be0` | stash@{7} | 11-06 14:11 | `test/comms/agent-channel.test.ts` plus 2 untracked test helpers | tracked part 17/17 in main; untracked files exist in main in a newer form | **PKT-1443** agent-channel tmpdir cleanup | superseded by #635 → safe to clean later |

---

## 5. Proposed cleanup script

> **DO NOT RUN WITHOUT BUGSY'S GO.** This was written and not executed. It assumes the §1.2
> decisions have been made. In particular, ship or explicitly abandon the "needs Bugsy decision"
> rows *before* step 5. Steps 1–3 are non-destructive and can be run on their own.

```bash
#!/usr/bin/env bash
# STRANDED-WORK cleanup — AlienClaw — proposed 2026-11-26. DO NOT RUN WITHOUT BUGSY'S GO.
set -euo pipefail
R=/home/xil/dev/alienclaw
TW=/home/xil/tmp-wt                       # never delete this directory itself (never-delete list)
OUT=/home/xil/Backups/alienclaw-stranded-20261126   # local only: history contains Hostinger
mkdir -p "$OUT" && chmod 700 "$OUT"       # hostnames (see §6); never push or upload these bundles

# ── 1. Capture uncommitted / untracked / ignored worktree state ───────────────
git -C "$TW/ac-pr5-contracts" diff --binary > "$OUT/ac-pr5-contracts.uncommitted.patch"
git -C "$TW/ac-pr5-contracts" diff --stat   > "$OUT/ac-pr5-contracts.uncommitted.stat"
cp -a "$TW/ac-c23-fault-harness/docs/experiments"   "$OUT/ac-c23-docs-experiments"
cp -a "$TW/alienclaw-release-simplify/MEMORY"       "$OUT/release-simplify-MEMORY"
cp -a "$R/Plans/council-3-member-council-to-crystalline-orbit.md" "$OUT/"

# ── 2. Pin every stash by SHA, and export each as a patch ────────────────────
git -C "$R" stash list --format='%H %gd %ci %gs' > "$OUT/stash-list.txt"
for s in $(git -C "$R" stash list --format='%H'); do
  git -C "$R" update-ref "refs/salvage/stash-${s:0:8}" "$s"
  git -C "$R" stash show -p --include-untracked "$s" > "$OUT/stash-${s:0:8}.patch"
done

# ── 3. One bundle with every ref (branches, tags, refs/salvage/*, remotes) ────
git -C "$R" for-each-ref --format='%(objectname) %(refname)' > "$OUT/refs-at-bundle-time.txt"
git -C "$R" bundle create "$OUT/alienclaw-all-refs-20261126.bundle" --all
git -C "$R" bundle verify "$OUT/alienclaw-all-refs-20261126.bundle"
git bundle list-heads "$OUT/alienclaw-all-refs-20261126.bundle" | grep -c . # expect ≈ 471+tags+8+remotes

# ── 4. Ship / decide (manual, out of band) ───────────────────────────────────
#   stashes 58b64f7a, f3711d7c, 55a181fe → PRs; feat/1464-…, feat/pkt-1468-scanner-variant,
#   the release stack, stashes dd597f7b/aa2fe241/002e9a09 → Bugsy's call. Stop here until done.

# ── 5. Worktrees ─────────────────────────────────────────────────────────────
git -C "$R" worktree remove "$R/.claude/worktrees/agent-a90125425fa56c1f6"   # clean; shipped in #593
git -C "$R" worktree remove "$R/.claude/worktrees/agent-aba0449464cc02ddc"   # clean; shipped in #593
# Release stack — ONLY after Bugsy's decision. Clean ones first; plain `remove` refuses on a dirty
# tree, which is the safety net. Use --force on the two dirty ones only after verifying step 1:
#   git -C "$TW/ac-pr5-contracts" apply --check -R "$OUT/ac-pr5-contracts.uncommitted.patch"
#   test -s "$OUT/ac-c23-docs-experiments/c23-fault-injection.md"
# for wt in ac-pr2-cuts ac-pr3-honesty ac-pr4-run-ready alienclaw-release-simplify; do
#   git -C "$R" worktree remove "$TW/$wt"; done          # simplify has ignored MEMORY/ → needs --force
# git -C "$R" worktree remove --force "$TW/ac-pr5-contracts"
# git -C "$R" worktree remove --force "$TW/ac-c23-fault-harness"

# ── 6. Branches fully in main (groups A + B), re-derived at run time ─────────
git -C "$R" fetch origin --prune          # refresh origin/main before judging
checked_out=$(git -C "$R" worktree list --porcelain | sed -n 's#^branch refs/heads/##p')
git -C "$R" for-each-ref refs/heads --format='%(refname:short)' | while read -r b; do
  case "$b" in main|chore/teardown-pass1|overnight/*|deploy-baseline-*|release/*|simplify/*) continue;; esac
  grep -qxF "$b" <<<"$checked_out" && continue
  git -C "$R" cherry origin/main "$b" | grep -q '^+' || git -C "$R" branch -D "$b"
done

# ── 7. Squash-merged (C), merged-with-residue (D), aliases (H) ───────────────
for b in \
  feat/1032-evolve-cli-selection-strategy-levers feat/1039-alienclaw-show-top-n-genomes \
  feat/1443-agent-channel-tmpdir-resurrection-audit-cleanup feat/267-operators-cold-applyoperator-arms \
  feat/284-correctness-validateschema-cold-branches feat/335-engine-merge-validate-gate-cold \
  feat/471-submission-id-entropy-widening feat/472-api-validation-install-null-undefined-type-guard \
  feat/477-registry-duplicate-id-guard feat/536-weightedpick-contract-violations feat/file-write-atomic-372 \
  feat/governance-loop-processEvent-switch-arms-cold feat/pkt-1460-campaign-strike-accumulation \
  feat/pkt-1466-error-path-correctness-coercion feat/pkt-1475-sync-pull-response-shape-guard \
  feat/pkt-576-file-tools-workspace-boundary feat/pkt-679-storage-genome-length-guard \
  feat/scale-experiment-brain-forwarding fix/1464-goal-manager-write-path-subgoals-envelope \
  fix/376-search-text-context-lines fix/506-cli-submit-type-path-traversal \
  fix/586-vitest-exclude-probe-namespaces fix/pkt-1462-transition-table-quote-aware-fields \
  fix/pkt-408-top-routing-prefix-shadow fix/pkt-426-seed-installer-copyfile-excl \
  fix/pkt-493-parsemodeljson-extract-json-substring fix/pkt-537-vitest-collection-scope \
  fix/pkt-555-lineage-parent-ids fix/pkt-621-online-fitness-read-poison-guard \
  fix/pkt-634-online-fitness-ts-hardening fix/pkt-674-extractparameterschema-strict-integer-regex \
  packet-37.1-hpanel-stored-slot test/packet-463-scale-experiment-forward-selection-strategy \
  feat/322-api-server-handleinstall-validation-catch-arm feat/673-msb-loader-whitelist-anchor-extractsection \
  feat/702-fitness-client-validation feat/parseSchemeDraft-martianTags-non-array-passthrough \
  feat/pkt-1041-target-fitness feat/pkt-328-storage-pool-db-free-cold-arms feat/pkt-660-cli-spawn-shell-false \
  feat/pkt-671-hierarchy-bootstrap-inner-sigkill-timer-leak feat/pkt-690-writeentry-fitness-guard \
  feat/pkt-691-substitution-ascii-d-parity feat/pkt-694-advisorbot-parse-shape-validation \
  feat/pkt-704-martian-report-shape-validation feat/pkt-753-sigkill-timer-leak \
  feat/pkt-756-aft-malformed-outcome-filter fix/387-storage-run-metadata-malformed-json \
  fix/614-cli-shim-shell-false fix/pkt-658-null-element-iteration-guard \
  fix/pkt-659-advisorbot-parseresponse-shape-validation fix/pkt-662-parseStrictInt-msb-loader \
  fix/pkt-670-inner-sigkill-timer-leak fix/pkt-687-isfinite-guard-local-population \
  fix/pkt-705-extractsection-allcaps-boundary fix/pkt-727-ssrf-guard-idna-uncaught \
  fix/pkt-737-bridge-timeout-bool-guard fix/pkt-756-brains-parser-strict-int-regex \
  fix/pkt-933-atomicwrite-d2-cleanup fix/search-text-totalmatches-truncation tester/fitness-nan-inf-defense \
  pr-591 pr-605 pr/605 pr605 pr-605-tmp pull-605 resolve-pr605-conflict pkt1142-test pr-630 \
  pr144-rebase pr145-rebase feat/leaderboard-hfetch-error-paths feat/martian-executor-msbdir-default-arm \
  packet/02-evolve-the-graph worktree-agent-a90125425fa56c1f6 worktree-agent-aba0449464cc02ddc ; do
  git -C "$R" branch -D "$b"
done

# ── 8. Superseded / small local-only (archived in step 3) — after Bugsy OKs ──
# for b in feat/1490-cli-status-online-fitness-range-guard feat/pkt-1467-transition-table-states-own-property \
#   feat/250-rank-based-selection-strategy feat/pkt-467-fitness-ceiling-delegate-to-evaluate \
#   tester/pkt-1354-effiency-nan-toolCalls-slotCount fix/atomicwrite-fd-vs-path-mock-compat \
#   test/packet-096-discovery fix/103-runcompletionflow-invalid-transition \
#   fix/pkt-468-parsemodeljson-anchor-fence-strip test/309-ensemble-all-incorrect-fallback \
#   feat/360-reviewreviseop-trim-whitespace-arm ; do git -C "$R" branch -D "$b"; done

# ── 9. Pushed refs (group F): local ref only, origin copy stays ──────────────
# For each F branch except main/overnight/deploy-baseline: delete locally only if the local sha
# equals the origin sha (skips test/packet-075-martians-parser-unit-tests, which is 1 ahead):
# [ "$(git -C "$R" rev-parse "$b")" = "$(git -C "$R" rev-parse "origin/$b")" ] && git -C "$R" branch -D "$b"

# ── 10. Stashes — drop by SHA, re-resolving the index each time (shared stack) ─
drop_stash() { local sha=$1 idx
  idx=$(git -C "$R" stash list --format='%H %gd' | awk -v s="$sha" '$1==s{print $2}')
  [ -n "$idx" ] && git -C "$R" stash drop "$idx"; }
drop_stash b9d78be01b8b4cb25db9b1164e57d11510f2bea0      # PKT-1443, superseded by #635
# The other 7: drop only after their PR is merged or Bugsy abandons them; refs/salvage/* keeps them.

# ── 11. Local main (after #653 lands) ────────────────────────────────────────
# git -C "$R" diff --stat origin/main main   # expect empty or only HANDOFF/teardown deltas
# git -C "$R" branch -f main origin/main     # only from a checkout that is not on main
```

---

## 6. Risks

1. **`ac-pr5-contracts` has 8 uncommitted modified files** (the C13 public-API type restriction,
   +91/−63). A `git worktree remove --force`, `git checkout -- .`, `git reset --hard` or
   `rm -rf` of that directory destroys it. It exists nowhere else.
2. **`ac-c23-fault-harness` has an untracked write-up** (`docs/experiments/c23-fault-injection.md`).
   It records the C23 **Pass** result, evidence that directed evolution finds an interior optimum.
   `git clean`, `worktree remove --force` or removing the directory destroys it.
3. **The release stack's last 34 commits are in no backup.** The Oct 31 bundle predates them.
   Deleting `release/*` (or removing the worktrees and then the branches) loses five branches of
   work. Bundle first.
4. **The 7 unique stashes live only in the `refs/stash` reflog.** A `git stash clear`, a mistaken
   `stash drop` by index (other sessions shift indices), or reflog expiry can destroy them. Git's
   default `gc.reflogExpireUnreachable` is 30 days, and no `gc.*` override is configured here, so
   the Nov 6–11 entries may become prunable by auto-gc from about Dec 6. Pin them
   (`refs/salvage/*`) or bundle them soon.
5. **The ignored `MEMORY/` in the simplify worktree** holds the only copy of the council
   release-plan PRD (progress 6/14, the record of what was rehearsed: a mirror backup, a
   filter-repo scrub with zero hits for the hosting provider's host and user strings, and a green rewritten main).
   `git clean -fdX` or `worktree remove --force` destroys it.
6. **Bundles contain sensitive history.** The council plan's Phase 0 scrub exists because history
   (MEMORY/ and .packet-reports) carries Hostinger host and user strings. Keep every bundle under
   `~/Backups` (mode 700), and never push or upload one. `~/Backups` and `~/tmp-wt` are on the
   never-delete list: remove individual worktrees, never the parent directories.
7. **Local `main` is 6 commits ahead of `origin/main`.** It is safe today, because the commits are
   in PR #653. After a squash merge, `git pull` on main will conflict or duplicate. Reset it
   deliberately (script step 11).
8. **`release/pr2-cuts` conflicts with the current direction.** 31 of its deletions overlap
   teardown #653, and its C8 cut removes `net/hardened-fetch.ts`, which the salvage plan rates as
   the most sellable asset (tonight's Wave 1 step 2 extracts it). Do not merge pr2-cuts wholesale.
9. **Index-drift hazard.** This inventory used only `--no-optional-locks` status reads and
   `hash-object` without `-w`. Before anyone `git add`s in `ac-pr5-contracts`, check for `MM`
   entries per the worktree-index-drift note. Today it shows ` M` only, so the index equals HEAD.
10. **Open PRs #630–632 (Oct 18) are stale.** The council plan proposed closing them, and tonight's
    Wave 1 step 1 cites #630's CGNAT note. Decide them together; do not let a branch sweep close
    them silently.
