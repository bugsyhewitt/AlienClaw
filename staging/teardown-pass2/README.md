# AlienClaw teardown pass 2: ready-to-apply kit

Prepared overnight on 2026-11-26 against `origin/main` @ `401f4099`. Nothing here has been
applied to any branch. The only git activity was a throwaway detached worktree
(`.claude/worktrees/pass2-dryrun`), which has since been removed.

## Files

| File | What it is |
|---|---|
| `ci-pass2.patch` | Changes to `.github/workflows/ci.yml` only. **Needs a token with `workflow` scope.** |
| `decoupling.patch` | Edits to 13 KEEP files, plus 1 new file (`diagnostics/audit_types.py`), so they stop depending on DROP code. Applies with `git apply`. |
| `delete-list.txt` | 406 tracked paths, one per line. It covers the pass-2 DROP set plus everything pass 1 (#653) deletes, so it works whether #653 is merged or not. |
| `gen-delete-list.sh` | Rebuilds `delete-list.txt` from the DROP pathspecs it contains. |
| `dry_run.sh` | Applies the kit to a fresh worktree and runs the CI-equivalent steps of the 3 required jobs through `heavy.sh`. Exits non-zero if anything fails. Bash 3.2. |
| `last-run/` | Per-step logs and `summary.txt` from the final dry run, plus `00-baseline-origin-main-probe.log` (the one red test, run on unmodified `origin/main`). |

Both patches pass `git apply --check` against `origin/main` and against
`origin/chore/teardown-pass1`. I checked each one with a temporary index file, without a
worktree:
`GIT_INDEX_FILE=/tmp/x git read-tree <ref> && GIT_INDEX_FILE=/tmp/x git apply --cached --check <patch>`.

## Procedure (in this order)

**Step 1. Bugsy, with a workflow-scoped token: land `ci-pass2.patch` on `main` by itself, first.**

```bash
git switch -c chore/ci-pass2 origin/main
git apply --check staging/teardown-pass2/ci-pass2.patch && git apply staging/teardown-pass2/ci-pass2.patch
git commit -am "ci: drop governance/brain/site/install-smoke steps ahead of teardown pass 2"
git push -u origin chore/ci-pass2      # workflow-scoped token
gh pr create --base main --fill        # wait for the 3 required checks, then merge
```

The patched workflow is safe to land on today's `main`, before any code is deleted. Every
step it keeps is byte-identical to the current workflow except the three Python
`--cov-fail-under` floors, and none of those floors is raised (see *Coverage floors*). So
the patched CI runs a strict subset of what is green on `main` now.

Landing CI first means the code PR in step 2 never touches `.github/workflows/`. That lets
an agent whose token lacks `workflow` scope push and update the code PR. If the two were
combined in one PR, an agent could never push to that branch again after a rebase.

**Step 2. Anyone (no workflow scope needed): the code PR.**

```bash
git switch -c chore/teardown-pass2 origin/main     # works with or without #653 merged
xargs git rm -q --ignore-unmatch -- < staging/teardown-pass2/delete-list.txt
git apply --check staging/teardown-pass2/decoupling.patch && git apply --index staging/teardown-pass2/decoupling.patch
git commit -m "chore: teardown pass 2 — remove agent product (governance/agents/brains/martians/bridge/cli/...)"
```

`delete-list.txt` has no paths with spaces, so plain `xargs` is safe. Push, open the PR, and
merge once the 3 required checks are green.

**On #653:** step 2 works on either base. If #653 is still open when step 2 lands, close
#653: step 2 deletes a superset of what #653 deletes, including the two `it.skip`-ed
governance tests. If #653 merges first, step 2 deletes the rest, including
`seed/martians/.gitkeep`, which #653 adds.

## Dry-run result

**Command:**
`HEAVY=/usr/bin/env bash staging/teardown-pass2/dry_run.sh /home/xil/dev/alienclaw/.claude/worktrees/pass2-dryrun`.
I ran it inside a single outer `heavy.sh` call, which also ran the baseline check below.
The tree was a fresh detached worktree of `origin/main` @ `401f4099`, with `node_modules`
symlinked from the main checkout.

**When:** 2026-11-26, 19:08:31 to 19:12:02 EST (run 2, the final kit). Run 1 used the kit
before the manifest cross-check (reporting deleted instead of kept), ran 18:40 to 19:03 EST
(mostly waiting on the lock), and gave the same per-job result.

Apply phase: 405 paths deleted (1 already absent: `seed/martians/.gitkeep`, which exists
only on #653). Both patches applied cleanly. Guard passed: the 3 required job names are
present, there is no `install-smoke` job and no DROP path in `ci.yml`, and every command
the script runs appears in `ci.yml`.

| Required job | Step (CI-equivalent) | Result |
|---|---|---|
| TypeScript typecheck | `npx tsc --noEmit` | PASS |
| | genome TS fixture runner | PASS: 1 file, 134 tests |
| | `test/api/` with coverage, DB-less | PASS: 24 files, 382 passed / 32 skipped. Thresholds not enforced (no MySQL). |
| Unit tests | `npx vitest run --reporter=verbose --no-file-parallelism` | **FAIL, but the failure is local-only and already on `main`:** 64 files (62 passed, 1 failed, 1 skipped); 1235 tests (1194 passed, 1 failed, 40 skipped) |
| Python lint + test + genome coverage | fixture validate; ruff on genome | PASS |
| | genome pytest, floor 95 | PASS: 340 passed, **99.65%** |
| | ruff on evolution | PASS |
| | evolution pytest, floor 85 | PASS: 210 passed, **99.61%** |
| | leak check | PASS |
| | diagnostics pytest, floor 90 | PASS: 302 passed, **99.11%** |
| | web-search backend | PASS: 19 passed |

**The one red test** is
`test/telemetry/online-fitness-streaming-cap-probe.test.ts > R-013`: RSS grew 68.3 MiB
against a 30 MiB budget. The same heavy call ran that test file on the **unmodified
`origin/main` tree** first, and it fails there identically (68.19 MiB; see
`last-run/00-baseline-origin-main-probe.log`). So the failure is local and already on
`main`, not caused by the kit.

The likely cause is this machine's Node v24 versus CI's Node 22, with no `--expose-gc`, so
`global.gc` is undefined. `main`'s CI is green with the same test. The kit leaves R-013's
code and the reader it tests (`telemetry-reader.ts`) untouched; it only removes the sibling
R-014 and R-015 cases.

**Verdict:** every required-job step that can run here is green, except that one known
local failure. The full summary is in `last-run/summary.txt`.

## What the kit changes

### ci-pass2.patch (`.github/workflows/ci.yml`)
- **TypeScript typecheck:** removes "Cross-language brain registry compliance (TypeScript
  side)" and "Governance loop tests with coverage", along with its ratchet comment. Keeps
  Typecheck, the genome TS fixture step, and both API steps (migrations, plus API coverage
  at lines 75 / branches 63) unchanged.
- **Unit tests:** unchanged (`npx vitest run --reporter=verbose --no-file-parallelism`).
- **Python lint + test + genome coverage:** removes "Validate brain registry fixture", "Test
  brain registry with coverage", "Lint seed/msb/ brains", and "Verify site/ structural
  integrity". Narrows "Lint Python files" to `src/alienclaw/genome/ test/genome/`. Narrows
  "Verify no leak directories" to `~/.alienclaw/populations/`; the `~/.alienclaw/specialists/`
  half came from governance, and no remaining code writes there. Keeps genome, evolution,
  diagnostics, and web-search, with the floors below.
- **install-smoke job:** removed (`install.sh` is gone).
- **Unchanged:** the three required job names (branch protection keys on them), the shell
  job, and triggers.

### decoupling.patch (KEEP-side edits)
| File | Change |
|---|---|
| `src/alienclaw/evolution/types.py` | Drops the `TYPE_CHECKING` import of `alienclaw.brains.types.BrainSpec`. `EvolutionConfig.brain` becomes `Any \| None`, with a comment giving the duck-typed shape `mutate_directed` reads (`.parameter_schema` fields with `xcode_index/range_min/range_max/direction`). Behaviour is unchanged. |
| `src/alienclaw/evolution/__main__.py` | Removes the bridge-backed `run-experiment` and `run-scale-experiment` subcommands (and `_parse_seeds_csv`). Keeps `migrate-pre-packet-16`. The tuners drive `evaluate_and_evolve` directly and don't use this CLI. |
| `src/alienclaw/diagnostics/fitness_formula_candidates.py` | Removes `make_formula_bridge_runner`, which had a lazy `alienclaw.bridge.server` import, plus the `json`/`uuid`/`Any` imports that only it used. The formula functions and `landscape_grid` stay. |
| `src/alienclaw/diagnostics/audit_types.py` (new) | `PairTrace`, `RunnerSensitivity`, and `AuditResults` (with `to_dict`/`from_dict`), moved verbatim out of the DROP `sensitivity_audit.py`. |
| `src/alienclaw/diagnostics/reporting.py` | Kept, as the manifest asked. Its only change is the import, now `from .audit_types import ...` instead of `.sensitivity_audit`. |
| `src/alienclaw/diagnostics/__main__.py` | Kept and gutted. The bridge-backed `audit` and `audit-martians` commands are gone. In their place are `report <json> [--report out.md]` and `diff <pre> <post>`, which wrap the existing `format_report` and `diff_audits` for saved audit JSON. I smoke-tested both by hand; the module stays coverage-omitted. |
| `test/diagnostics/test_reporting.py` | Imports the dataclasses from `audit_types` instead of `sensitivity_audit`. |
| `src/alienclaw/index.ts` | The barrel now exports only `constants` and the genome codec. Nothing imports the barrel. |
| `test/genome/test_step_mutation.py`, `test/evolution/test_generation.py` | These imported `BrainSpec`/`ParameterSchemaField` from `alienclaw.brains.types` at runtime. They now use small local frozen-dataclass stand-ins, so `mutate_directed` keeps its tests (it is part of the genome 95% gate). |
| `test/telemetry/online-fitness-streaming-cap-probe.test.ts` | Drops R-014 (governance `OnlineFitnessLog`) and R-015 (cli `runStatus`). Keeps R-013 and R-016, which test the KEEP `telemetry-reader`. |
| `test/wall-check.test.ts` | Empties `ALLOWLIST`. Its three entries pointed at `test/registry/seed-installer.test.ts`, which is deleted. The mechanism stays. |
| `package.json` | Drops the `setup` script (`bash install.sh`) and `check-seed-drift.sh` from `test`, and drops the deleted `AGENTS.md`, `install.sh`, `installer/`, and `seed/` from `files`. Dependencies are untouched, so `--frozen-lockfile` still holds. |
| `pyproject.toml` | Drops the coverage-`omit` entries for the deleted `brains/decoder.py` and `diagnostics/scaling_experiment.py`. |

### delete-list.txt: what goes
- **DROP source:** `src/alienclaw/{governance,agents,brains,martians,comms,bridge,cli,wiring,msb,config,prompts}/`,
  `registry/` except `genome-codec.ts` and `genome-operators.ts`, `registry-bootstrap.ts`,
  and `types.ts`. `types.ts` holds only governance types; its only importers are DROP code
  and `index.ts`.
- **KEEP-adjacent files that only work with DROP:**
  - `evolution/{bridge_runner,live_evo}.py`
  - `diagnostics/{sensitivity_audit,composition_decoder_audit,synthetic_compositions}.py`
    (its result dataclasses move to `audit_types.py`)
  - `diagnostics/scaling_experiment.py`: every entry point calls the bridge runner
  - `fitness/conformance.py`: see open decision D-1
- **Data:** all of `seed/`, `site/`, and the brain/martian/bridge/test-goals fixtures in `test/fixtures/`.
- **Scripts:** `check-seed-drift.sh`, `gen-seed-genomes.py`, `run_packet25_experiments.py`,
  `run_packet28_rerun.py`, `deploy.sh`, and `local-preview.sh`. The last two serve the
  retired `site/`.
- **Tests:**
  - whole directories: `test/{governance,agents,brains,martians,comms,bridge,cli,config,wiring,msb,site,integration}/`
  - the DROP half of `test/registry/`
  - the root-level tests that import DROP: `brain-composition`, `cli-args`, `decide_null_check`, `rule5-channel-isolation`
  - `test/helpers/agent-channel-cleanup.ts`
  - in `test/evolution/`: `test_bridge_runner`, `test_end_to_end`, `test_composition_evolution`, `test_live_evo`, `test_main_cli`
  - in `test/diagnostics/`: the tests of the removed modules, plus `test_instrumentation.py`, which drives `bridge.server.handle`
  - in `test/fitness/`: the conformance tests
  - in `test/tools/`: `test_pkt087_extract_json_empty_extracted.py`, which tests conformance
- **Pass 1's deletions (69 files):** included so the kit stands alone.

Kept on purpose:
- `constants.ts` and `utils.ts`: `api/` and `telemetry/` import them.
- `api/`, `migrations/`, `server.js`: DEFER, untouched.
- `diagnostics/{instrumentation,martian_stub_generator,stub_servers,per_genome_capture,...}`: no DROP imports.
- `prompts/reflect.v1.md`: used by `evolution/reflective`.
- `perf/`: REVIEW.
- The unreferenced OpenClaw-era fixtures (`hooks-install/`, `plugins-install/`, `system-run-*`, `exec-*`, `child-process-bridge/`): nothing references them, but they are not pass-2 DROP. A later cleanup can take them.

### Cross-check against `docs/salvage/drop-manifest.json`
The kit was built independently from the code. I then reconciled it against the manifest's
KEEP→DROP blockers:

| Manifest item | How the kit handles it |
|---|---|
| `fitness_formula_candidates.py:176` lazy bridge import | Function removed (decoupling.patch). |
| `reporting.py` and `diagnostics/__main__.py` import `sensitivity_audit` | Imports gutted. Both files kept, using the new `audit_types.py`. |
| `fitness/conformance.py:53` reads `seed/msb/*.msb` | **Deliberately deleted** along with `seed/msb/`; its only caller was the DROP bridge. See D-1 for the keep-alternative. |
| Runtime DROP imports in tests | `test_generation`/`test_step_mutation` use stand-ins. `test_reporting` uses `audit_types`. The streaming-cap probe is trimmed. `test_instrumentation`, `test_end_to_end`, `test_composition_evolution`, `test_main_cli`, and `live-submit-from-file` (all of `test/integration/`) are deleted. |
| package.json `files`/`setup`/`test`, pyproject omits, wall-check allowlist | All edited (decoupling.patch). |
| Seed, site, and bridge scripts | All six scripts are in `delete-list.txt`. |
| `constants.ts`/`utils.ts` are KEEP; `fitness/function.py` is REVIEW; `evolution/__main__.py` is gutted, not deleted | All three match the kit. `fitness/function.py` is untouched. |

## Coverage floors

I measured coverage on the trimmed tree with pytest-cov's `Total coverage` and kept the
floors in `ci-pass2.patch` unchanged:

| Gate | Floor (main and kit) | Run 1 (pre-manifest kit) | Run 2 (final kit) |
|---|---|---|---|
| `alienclaw.genome` | 95 | 99.65% (287 stmts, 1 missed) | 99.65% (287 stmts, 1 missed) |
| `alienclaw.evolution` | 85 | 99.61% (517 stmts, 2 missed) | 99.61% (517 stmts, 2 missed) |
| `alienclaw.diagnostics` | 90 | 98.91% (552 stmts, 6 missed) | 99.11% (677 stmts, 6 missed) |

Deleting `bridge_runner.py`, `live_evo.py`, and their tests did not push evolution coverage
toward its floor: the removed code leaves the numerator and the denominator together.
Nothing needed lowering.

I deliberately did not raise any floor here. That keeps `ci-pass2.patch` a strict subset
of today's green CI, which is what makes step 1 safe on unmodified `main`. Once the code PR
has landed, a follow-up ratchet to about genome 98 / evolution 98 / diagnostics 97 would
lock in the measured numbers. That PR also needs a workflow-scoped token.

DB-less TypeScript API coverage was 83.95% statements, 77.84% branches, and 85.75% lines
(607/723, 383/492, 548/639). Some DB-backed suites skip without MySQL, so this is for
reference only. The CI gate (lines 75 / branches 63) runs with MySQL.

## Risks the dry run cannot see

1. **MySQL-backed tests did not run.** I didn't start a database, and
   `ALIENCLAW_TEST_DB_URL` was unset, so the DB-backed `test/api/` suites (`ts-storage`, the
   handler integration suites, and others) self-skipped in both vitest runs. Neither
   "Run migrations" step ran, and the API coverage thresholds (lines 75 / branches 63) could
   not be checked: DB-less coverage is far lower and would fail them spuriously. The kit
   does not touch `src/alienclaw/api/`, `test/api/`, or `migrations/`. The api code imports
   only kept modules (`utils.ts`, `registry/genome-codec.ts`, `telemetry/telemetry-reader.ts`).
   Expect these steps to behave exactly as on `main`.
2. **actionlint and the no-tabs check did not run.** actionlint isn't installed here. The
   patched `ci.yml` parses as YAML: 4 jobs, the 3 required names unchanged, and the
   `install-smoke` job gone. It has 0 tab characters, and the change only removes steps and
   narrows two run lines.
3. **shellcheck did not run** (not installed). The code PR only deletes shell scripts. If
   `staging/teardown-pass2/` itself is ever committed, the Shell job will lint `dry_run.sh`
   and `gen-delete-list.sh`, which I could only check with `bash -n`.
4. **Toolchain drift.** Local runs used Python 3.14.9 (CI uses 3.12), ruff 0.15.20 (CI
   installs the latest `<1.0`), Node v24 (CI uses 22), and the main checkout's existing
   `node_modules` (CI uses `pnpm install --frozen-lockfile`).
5. **Suites outside CI were not run as a gate.** `pytest` over `test/tools/` (except
   `test_web_search_backend.py`) and `test/fitness/` is not in CI. That includes the
   package.json `test` script and the `scripts/check-testvectors.sh` path. Three tuner
   modules (`{mangle,ouija,pho3nix}_tuner.{run_ga,fitness_adapter}`) import cleanly on the
   trimmed tree.
6. **No local `__pycache__` problem in CI.** On a long-lived checkout, `git rm` leaves
   untracked `__pycache__/` directories behind under the deleted Python packages. They are
   gitignored, so CI never sees them.

## Open decisions for Bugsy

- **D-1 `fitness/conformance.py` and `seed/msb/`.** Graded conformance (PR #573) reads
  each brain's OUTPUT CONTRACT from `seed/msb/*.msb`. Its only production caller is
  `bridge/server.py`, which is DROP. The tuners score fitness through their own adapters.
  - The kit deletes `conformance.py` and its three tests along with `seed/msb/`.
  - To keep it instead, remove these lines from `delete-list.txt`: `src/alienclaw/fitness/conformance.py`,
    `test/fitness/test_conformance.py`, `test/fitness/test_field_valid_branches.py`,
    `test/tools/test_pkt087_extract_json_empty_extracted.py`, and the 8 `seed/msb/*.msb`
    lines. Nothing in CI depends on either choice.
- **D-2 Evolution CLI.** `python3 -m alienclaw.evolution run-experiment` and
  `run-scale-experiment` could only fetch fitness through the bridge, so the kit removes them
  together with `test_main_cli.py`. If a generic GA CLI is wanted (e.g. a `--runner
  module:function` flag), that is a new packet, not a teardown edit.
- **D-3 Diagnostics.** As the DROP manifest asked, `reporting.py` and
  `diagnostics/__main__.py` stay: the audit dataclasses were split into `audit_types.py`,
  and the CLI keeps only `report` and `diff`. Three more pieces were bridge-coupled and are
  dropped: `scaling_experiment.py`, `test_instrumentation.py`, and
  `fitness_formula_candidates.make_formula_bridge_runner`. All are Packet 19/27 research
  harnesses for the old Martian pipeline.
- **D-4 No TypeScript coverage gate remains** except the API one. The governance gate goes
  with governance. If you want a ratchet on KEEP TypeScript, add a follow-up step covering
  `src/alienclaw/evolution/**/*.ts` (graph + reflective) with a measured floor. The kit
  doesn't add new gates.
- **D-5 Leftover dependencies.** `commander` (used by the deleted `cli/`) and
  `@mariozechner/pi-ai` (a type-only import in `utils.ts`, kept) are still devDependencies.
  Dropping them means changing `pnpm-lock.yaml`, so leave that to a separate PR.
  `package.json → files` still lists `install.sh`, `installer/`, `seed/`, `AGENTS.md`, and
  `assets/`. It is inert, because the package is `"private": true`.
- **D-6 Docs and top-level markdown** (README, VISION, ROADMAP, CLAUDE.md hard rules about
  BossBot/AdvisorBot, docs/) still describe the agent product. Those are for the parallel
  `docs/salvage/drop-manifest.json` work; the kit doesn't touch them. The repo `CLAUDE.md`
  rules 1–5 and the "Install works" definition stop making sense after pass 2.

## Regenerating the kit

1. Edit the `DROP_SPECS` list in `gen-delete-list.sh` if needed, then run
   `bash gen-delete-list.sh > delete-list.txt`. Defaults: repo `/home/xil/dev/alienclaw`,
   base `origin/main`, pass-1 ref `origin/chore/teardown-pass1`.
2. Create a throwaway worktree and link `node_modules` into it:
   `git -C /home/xil/dev/alienclaw worktree add --detach .claude/worktrees/pass2-dryrun origin/main`,
   then `ln -s /home/xil/dev/alienclaw/node_modules .claude/worktrees/pass2-dryrun/node_modules`.
3. In that worktree:
   - Apply the current kit: delete the listed paths, then `git apply decoupling.patch ci-pass2.patch`.
   - Make your edits.
   - Regenerate the patches:
     - `git diff --no-color --no-ext-diff -- .github/workflows/ci.yml > ci-pass2.patch`
     - `git diff --no-color --no-ext-diff --diff-filter=M -- . ':(exclude).github/workflows/ci.yml' > decoupling.patch`

     The decoupling patch carries modifications only; deletions live in `delete-list.txt`.
4. Restore the worktree to pristine: `git -C <wt> checkout -- . && git -C <wt> clean -fdq`.
5. Run `bash dry_run.sh <wt>`. It refuses a dirty worktree. By default it gates through
   the session `heavy.sh` (`HEAVY=...`). Set `HEAVY=/usr/bin/env` when you are already
   inside a `heavy.sh` call, because nested flocks deadlock, or when the scratchpad copy of
   `heavy.sh` is gone.
6. Remove the worktree: `git -C /home/xil/dev/alienclaw worktree remove --force .claude/worktrees/pass2-dryrun`.
