# Architecture Review — AlienClaw salvage cut (teardown pass 2)

Independent read for Bugsy's morning decision. Read-only; sources are committed at HEAD
of worktree `overnight-2026-11-26`. Verified by reading SALVAGE.md, locked-decisions.md,
GENOME_SPEC.md, the ga-engine package + PROVENANCE, the DROP manifest, decoupling.patch,
delete-list.txt, the teardown README, and genome-ts PROVENANCE; plus one live check
(`PYTHONPATH=src pytest tests/test_no_drop_imports.py tests/test_tuner_contract.py`
→ **60 passed**).

---

## Q1 — Is the `alienclaw_ga` boundary right?  VERDICT: YES, with one deliberate omission to reconsider.

- The staged package imports no DROP package and loads with zero in-tree `alienclaw`
  modules in a clean interpreter — proven by the two guard tests I ran (60 passed), not
  just asserted.
- Named exclusions are all correct:
  - `fitness_ceiling.py` — delegates to the retired `fitness.function.evaluate`
    (tool_calls/slot_count Martian scorer). Product-specific; a domain tuner brings its
    own fitness. Correctly OUT.
  - `experiment.py` / `governance_gate.py` — this is the BossBot/AdvisorBot
    per-generation review seam (fitness reports → AdvisorBot). Re-including it would
    reintroduce the retired agent loop. Correctly OUT on architectural grounds, not just
    dependency grounds.
  - `online_fitness.py` — live-campaign telemetry, only consumer was `live_evo`. OUT is
    fine for offline tuners; it is DROP-free so a future live engine can re-add it.
  - diagnostics `scaling_experiment.py` — bridge-coupled, OUT. Note it is **distinct**
    from `evolution/scale_experiment.py` (multi-seed runner), which IS staged and is
    DROP-free. The exclusion list correctly separates the two.
- Nothing is wrongly included. `instrumentation.py` is staged but producer-less (inert
  until a host calls `record_*`) — acceptable as a reusable recorder API.
- **BrainSpec→protocol retype: sound.** `mutate_directed` and `EvolutionConfig.brain`
  read only `.parameter_schema[*].{xcode_index,range_min,range_max,direction}`.
  `schema.py` models that as the `DirectedMutationSpec` Protocol + concrete
  `MutationSchema`; in-tree `BrainSpec` still satisfies it. Behavior unchanged.
  (Minor inconsistency, not a defect: the OUT-OF-TREE package uses a real Protocol while
  the in-tree `decoupling.patch` retypes `brain` to bare `Any`. Same runtime; the
  Protocol is the stronger of the two.)
- **clamp01 copy: sound** — `max(0.0, min(1.0, value))`, verbatim.

One thing to reconsider: the graded-conformance fitness scaffold is excluded entirely
(see Q5/D-1). SALVAGE §1 wanted the *shell* kept as a per-domain adapter plug.

## Q2 — Does `decoupling.patch` preserve genome-spec + cross-language contract?  VERDICT: YES. No locked decision violated.

- The patch touches `evolution/types.py`, `diagnostics/{__main__,fitness_formula_candidates,reporting}.py`,
  a new `audit_types.py`, `index.ts`, three tests, `package.json`, `pyproject.toml`.
  **It does not touch `src/alienclaw/genome/`, `registry/genome-codec.ts`,
  `genome-operators.ts`, or `test/fixtures/genome-spec-fixtures.json`.** delete-list.txt
  deletes none of those either. The 256-char Base62 / 4×64-section / FNV-checksum codec
  and its shared fixture survive in-tree, unchanged.
- The Python↔TS contract is anchored by one fixture blob
  (`ac109de3…`) consumed by three verbatim copies (in-tree, ga-engine, genome-ts) plus
  `scripts/check-testvectors.sh`, which the patched `package.json` **keeps**. The
  languages stay locked.
- GENOME_SPEC.md is `status: locked` and is a KEEP doc; the cut leaves it in place.
- The P14-01 §5 locked decisions concern the reflective engine (`evolution/reflective/`,
  `prompts/reflect.v1.md`), which the kit explicitly KEEPS. The dry run's `tsc --noEmit`
  passed, so reflective does not depend on any deleted DROP/barrel symbol.

## Q3 — Do the manifest's three reclassifications hold?  VERDICT: ALL THREE CORRECT.

- `constants.ts` / `utils.ts`: SALVAGE said DROP; manifest raises to **KEEP** because
  KEEP `telemetry-reader.ts` and DEFER `api/` import them. Deleting would break
  `tsc --noEmit`. Manifest correct; the kit keeps them.
- `fitness/function.py`: **REVIEW/keep in-tree** is correct — `evolution/generation.py`
  and four diagnostics import `clamp01` from it at runtime. The ga-engine copies clamp01
  into `numeric.py` for the OUT-OF-TREE package only; in-tree the file must stay (or
  clamp01 must be relocated in-tree first). The kit correctly leaves it untouched. The
  retired `evaluate` scorer stays in-tree but inert; an optional later cleanup can split
  clamp01 out in-tree to mirror `numeric.py`.
- `evolution/__main__.py`: **gut, don't delete** is correct — `pyproject.toml` names it
  in the coverage `omit` list (which the kit keeps) and it still carries
  `migrate-pre-packet-16`. The kit removes only the bridge-backed subcommands.

## Q4 — Teardown sequencing safe?  VERDICT: YES for CI-first; recommend CLOSE #653.

- ci-pass2.patch keeps the three *required context names* byte-for-byte
  (`TypeScript typecheck`, `Unit tests`, `Python lint + test + genome coverage`), removes
  only non-required steps/the non-required `install-smoke` job, and raises no coverage
  floor. It is a strict subset of today's green CI, so landing it on unmodified `main`
  cannot go red, and the intermediate state (CI trimmed, code still present) also stays
  green because `vitest`'s default include still runs the not-yet-deleted tests.
- CI-first correctly decouples the workflow-scoped token from the code PR, so a
  non-workflow-scope agent can rebase/repush the code PR. Sound.
- **#653 (pass 1, open):** the pass-2 delete-list is a superset of #653 and works on
  either base. A single atomic teardown is less error-prone than a two-PR partial-teardown
  window (and avoids the `seed/martians/.gitkeep` ordering edge). Recommend **close #653
  and land pass 2 as the single teardown**; merging #653 first is also safe but buys
  nothing.

## Q5 — What should the repo become, and what shouldn't be deleted?

- **End state: an engine-only library** — genome codec (Py + TS mirror), the Python GA
  (`evolution/`), `diagnostics/`, `telemetry-reader`, the hardened SSRF/boundary tools,
  plus the DEFER'd `api/` leaderboard. Note the three tuners route OUT (necromancer /
  Pho3nix), and the `staging/*` packages are a transit lounge destined to leave for
  PyPI/npm/Pho3nix/ToolTime — so the *final* repo is narrower than staging suggests.
- **Rename: not yet.** The name is still load-bearing for live `api.alienclaw.net` and
  the separate `alienclaw-site` repo. Revisit a rename only when `api/` (DEFER) is
  retired or migrated; renaming now churns the live deployment for no gain.
- **Don't delete what the kit deletes:**
  1. **`fitness/conformance.py` + its tests (D-1).** SALVAGE §1 explicitly keeps the
     conformance *shell* ("stays as per-domain adapter plug") and `docs/fitness-graded-conformance.md`
     is a KEEP doc; graded-conformance is listed SELLABLE. The kit deletes conformance.py
     because its only *production* caller is the DROP bridge — but that is an argument for
     decoupling it from `seed/msb/` (read the contract from a parameter), not for deleting
     the scaffold. Recommend KEEP conformance.py + `test/tools/test_pkt087_extract_json_empty_extracted.py`
     and have it take its OUTPUT CONTRACT as an argument instead of reading `seed/msb/`.
  2. **Institutional memory.** The KEEP docs (LESSONS_FROM_THE_ARC, locked-decisions,
     GENOME_SPEC, MATHEMATICAL_FOUNDATIONS, VISION, ROADMAP) are correctly preserved. The
     DROP'd dead specs (SUBAGENT/SPECIALIST/MARTIANBRAIN/SUMMON_BRIDGE/LEADERBOARD_API) go
     to the `pre-teardown-20261126` tag+bundle (verified OK), which is acceptable — but
     before deleting, confirm LESSONS_FROM_THE_ARC captures the *why* of the 3-layer
     design so the rationale is one `cat` away, not a bundle restore.

## Q6 — Top 5 architectural risks (ranked)

1. **Live leaderboard half-orphaned + unrotated secret.** `api/` (Express+MySQL,
   `api.alienclaw.net`, live) is kept/DEFER, but the submission *client*
   (`governance/common/leaderboard.ts`, all `cli/*submit*`, `live-submit-from-file.test.ts`)
   is deleted. After pass 2 a live internet-facing server has no in-repo client and the
   SALVAGE §4 Hostinger DB password is still unrotated. (Server-side never-trust-client
   validation in `api/validation.ts` does survive, so this is an operational/ownership
   risk, not a trust-boundary regression.) Decide api/'s fate and rotate the secret
   before, or alongside, pass 2.
2. **Coverage floors left slack + no KEEP-TypeScript gate.** Measured coverage is ~99%
   but floors stay 95/85/90, and removing the governance TS gate (D-4) leaves genome-codec.ts
   and the kept `evolution/**/*.ts` with no coverage gate at all. Future regressions in the
   surviving engine won't trip CI. Land the kit's proposed ratchet (≈98/98/97) and add a
   KEEP-TS coverage step as the immediate follow-up.
3. **Dry run couldn't exercise the full required set.** R-013 fails locally (Node 24 vs
   CI 22, no `--expose-gc`) and is pre-existing on `main`; MySQL-backed `api/` suites
   self-skipped so the API coverage gate (lines 75 / branches 63) was never run against
   the trimmed tree; actionlint/shellcheck/no-tabs didn't run. Low probability of a
   surprise, but the API gate is genuinely unverified here. Watch the first real CI run.
4. **Conformance/graded-fitness scaffold deleted against SALVAGE intent (D-1).** Loses a
   documented KEEP/SELLABLE asset; reversible from the bundle but a cut-line error. See Q5.
5. **Genome codec now lives in ≥3 homes while the seed-genome regenerator is deleted.**
   Integrity holds today (no codec change, shared fixture, check-testvectors kept), but
   `scripts/gen-seed-genomes.py` goes and three codec copies (in-tree, ga-engine, genome-ts)
   are destined to separate. Any future codec change multiplies drift risk; designate one
   canonical codec home and a single regen path before the staging packages leave.

---

**Bottom line:** the cut lines are substantially correct and well-evidenced; the boundary,
genome integrity, cross-language contract, manifest reclassifications, and CI-first
sequencing all hold. Before executing: (a) decide api/ + rotate the Hostinger secret,
(b) keep `conformance.py` (decouple it from `seed/msb/` rather than delete), (c) land the
coverage ratchet as a fast follow, (d) close #653 and ship pass 2 as one PR.
