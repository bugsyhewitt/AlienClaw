# AlienClaw — Salvage Plan

**Date:** 2026-11-20
**Repo state:** `main` @ `2d1cace3` (working tree dirty: 4 modified, several untracked)
**Status:** PLAN ONLY — no action has been taken. This document is the decision record that precedes execution.

---

## 0. Executive summary

The original AlienClaw product thesis ("share code configs, not LLM data" via a three-agent
BossBot/AdvisorBot/CreatorBot governance engine) is dead: the fitness signal is self-referential,
there is no real external task, and the "share code not data" problem is already solved by the 2026
plugin/skill/MCP ecosystem. This is the verdict in `Plans/starry-nibbling-pizza.md` and the team's own
(unpushed) `docs/RELEASE_ASSESSMENT.md`.

**What survives is the engineering, not the product.** The repurpose = keep the GA core, the portable
checksummed genome codec, the hardened tool sandbox, and the SSRF/boundary security tooling; retire the
governance engine, the Martian abstraction, the agent installer, and the self-referential fitness; and
attach a *real* external fitness per domain (necromancer fuzzers, Pho3nix recon). Phases 1–2 of that
repurpose are already proven (mangle ✅, ouija ✅); Phase 3 (Pho3nix) is scaffolded but blocked on data.

This plan classifies every module KEEP / SELLABLE / DROP, routes KEEP code to its destination project,
records the secret-at-rest finding, and gives a disposition for every dirty file in the tree.

---

## 1. Component inventory — KEEP / SELLABLE / DROP

Line counts are source only (`.ts`/`.py`, excluding `__pycache__`). "Class" is the dominant disposition;
mixed modules are split in the notes.

| Module (`src/alienclaw/`) | LOC | Class | Rationale |
|---|---|---|---|
| `genome/` (alphabet, checksum, codec, operators, types, validation) | 925 | **KEEP + SELLABLE** | Portable, checksummed, deterministic genome codec. The crown jewel; every tuner imports it. |
| `evolution/` (generation, population, selection, storage, stats, online_fitness, bridge_runner, live_evo) | 4503 | **KEEP** | Production-quality Python GA (selection/crossover/mutation/elitism/plateau). The TS graph/reflective variants are legacy — keep the Python path. |
| `diagnostics/` (Bayesian optimizer, plateau_detector, fitness_ceiling, sensitivity_audit, instrumentation) | 3002 | **KEEP** | Tuning diagnostics are reusable by the repurpose tuners. Some product-coupled probes can be trimmed. |
| `tools/` (file_read/write, http_get, url_fetch, web_search, search_text, compute, extract_json, `_ssrf_guard`, `_boundary`, limits, registry) | 1113 | **KEEP + SELLABLE** | Mature sandboxed tool suite with SSRF guard + filesystem boundary jail. Reusable security infra well beyond this repo. |
| `net/hardened-fetch.ts` (SSRF guard) | 368 | **KEEP + SELLABLE** | Standalone SSRF-aware fetch. The single most directly sellable asset. |
| `fitness/` (conformance, function, types) | 285 | **DROP (metric) / KEEP (shell)** | `function.py`'s self-referential metric is the fatal flaw — retire it. Keep the graded-conformance scaffolding/types as the plug point for per-domain adapters. |
| `msb/` (martian-executor, openclaw-tool-resolver, tool-adapters) | 1482 | **DROP (mostly)** | Martian-sandbox execution is tied to the dead abstraction. The prototype-safety hardening (PKT-1416) is worth preserving wherever the resolver pattern is reused. |
| `telemetry/` (reader, writer) | 390 | **KEEP (reader) / DROP (rest)** | `telemetry-reader` streaming aggregation is a reusable util; the writer is product-coupled. |
| `registry/` (genome-codec.ts, genome-operators.ts, martian-registry, ms-loader, seed-installer) | 1083 | **SPLIT** | genome-codec/operators (TS mirror) = KEEP/consolidate; martian-registry, ms-loader, seed-installer = DROP. |
| `agents/` (BossBot/AdvisorBot/CreatorBot TS wrappers) | 831 | **DROP** | The dead three-agent product surface. |
| `governance/` (state machines, goal-loop, task-manager, summon-adapter, leaderboard-sync, Hermes/OpenClaw host adapters) | 6032 | **DROP (archive)** | Largest module and the heart of the dead product. Archive as a git tag/bundle; do not carry forward. |
| `brains/` (MartianBrain registry/decoder/parser) | 636 | **DROP** | Martian abstraction, product-specific. |
| `martians/` (registry, parser, substitution, validator) | 1125 | **DROP** | Product abstraction. NOTE: `substitution.ts` still carries a live `__proto__` prototype-pollution defect (tracked as PKT-1255b) — if any of this is reused, fix first. |
| `comms/` (AgentChannel, UserChannel) | 216 | **DROP** | Product plumbing. |
| `bridge/` (python↔TS bridge server) | 445 | **DROP (retire)** | Only needed for the TS+Python product split. The repurpose tuners are pure-Python. |
| `cli/` (`evolve`, `submit`, `show`, `runs`, `leaderboard`) | 1145 | **DROP (archive)** | Product CLI. The tuners ship their own `run_ga.py`; no need to carry this. |
| `api/` (Express + MySQL leaderboard, deployed at api.alienclaw.net) | 2246 | **DROP (defer) / repurpose later** | Public genome sharing is deferred (roadmap Phase 4). Keep the deployment alive but out of repurpose scope; eventual reuse = campaign-genome registry. |
| `config/` (loader, defaults) | 70 | **DROP (fold)** | Product config; trivial, fold what the tuners need. |
| `wiring/` (hierarchy-bootstrap, host-select) | 497 | **DROP** | Product bootstrap. |
| `prompts/` (SOUL.md) | 0 | **DROP** | Dead-product agent prompts. |

**Non-`src` surfaces**

| Item | Class | Rationale |
|---|---|---|
| `mangle_tuner/`, `ouija_tuner/`, `pho3nix_tuner/` | **KEEP (the repurpose)** | The new product. Route to their destination projects (§3, §5). |
| `seed/agents/` (BossBot/AdvisorBot/CreatorBot workspace files) | **DROP** | Dead product. |
| `installer/`, `install.sh`, `install-hermes.sh` | **DROP** | Install the dead OpenClaw/Hermes agents. |
| `assets/chrome-extension/` | **DROP** | Legacy browser-side tool-config capture for the dead product. |
| `site/` | **DROP** | Already retired (deploy refuses without `ALIENCLAW_DEPLOY_LEGACY_SITE=1`). |
| `docs/specs/GENOME_SPEC.md` | **KEEP** | Canonical spec for the surviving codec. |
| `docs/specs/` (LEADERBOARD_API, MARTIANBRAIN, SUBAGENT, SPECIALIST, SUMMON_BRIDGE) | **DROP (archive)** | Specs for the dead product surfaces. |
| `docs/fitness-graded-conformance.md`, `docs/MATHEMATICAL_FOUNDATIONS.md`, `docs/evolution-loop.md` | **KEEP** | Describe surviving mechanics. |

---

## 2. SELLABLE components — who pays, and how

"Sellable" here is deliberately honest. The GA and leaderboard are in crowded, mature markets with *no
edge* (per the roadmap's own research). The genuinely distinctive, packageable assets are the security
tooling and the portable-genome codec. None of these is a large direct-revenue product on its own; the
realistic value is OSS credibility → consulting leads, plus internal reuse that avoids rebuild cost.

| Component | Who would pay / benefit | How to ship | Honest assessment |
|---|---|---|---|
| **SSRF guard + hardened fetch** (`net/hardened-fetch.ts`, `tools/_ssrf_guard.py`) | AI-agent builders, bug-bounty/pentest tooling authors, anyone giving an LLM an HTTP tool | npm `@v3x/hardened-fetch` + PyPI `ssrf-guard`; OSS release + a "SSRF-proofing agent tools" blog post | **Strongest.** Real, isolated, dual-language, already battle-tested against `jail-hostile-genomes`. OSS → consulting funnel is credible. |
| **Filesystem boundary jail** (`tools/_boundary.py`: `assert_inside_boundary`, `assert_no_symlink`) | Same audience — safe file tools for agents | Bundle with the hardened-fetch package as "agent tool sandbox" | Pairs naturally with the SSRF guard; symlink-aware write jail is the differentiator. |
| **Portable checksummed genome codec** (`genome/`) | Teams needing reproducible, shareable, verifiable config artifacts (autotuning, fuzzing campaigns) | PyPI lib + the existing `GENOME_SPEC.md` as public spec; a blog post on "deterministic config artifacts" | Distinctive engineering, but the *market* is thin without a domain. Best as an OSS portfolio/credibility piece, not a paid product. |
| **Graded-conformance fitness framework** (`fitness/` scaffolding, `docs/fitness-graded-conformance.md`) | Builders of agent/LLM eval harnesses | Blog post / OSS snippet | Niche. Content value, not revenue. |
| **GA tuner core** (`evolution/`) | Config/hyperparameter tuning | OSS only | Crowded/mature (CoTune, Bayesian autotuning, AFL++). No edge → do not try to sell; keep for internal reuse. |
| **Leaderboard API** (`api/`) | — | — | Generic Express+MySQL CRUD; not distinctive. Not sellable; repurpose internally or retire. |

**Recommendation:** package the security tooling (SSRF guard + boundary jail) as one small dual-language
OSS library under the V3X org, with a blog post. That is the only component where "who would pay" has a
real answer (via consulting), and it is the lowest-effort extraction.

---

## 3. KEEP components — destination project

| Component | Destination | Notes |
|---|---|---|
| `genome/` codec + `GENOME_SPEC.md` | **alienclaw (repurposed engine)** | Stays as the shared artifact format every tuner imports. Also extracted as the PyPI lib (§2). |
| `evolution/` Python GA, `genome/operators.py`, `evolution/selection.py` | **alienclaw (repurposed engine)** | The reuse spine of all three tuners; only the fitness module changes per domain. |
| `diagnostics/` (Bayesian opt, plateau, sensitivity) | **alienclaw (repurposed engine)** | Tuning instrumentation for the GA runs. |
| `mangle_tuner/` | **necromancer** (mangle H.265 fuzzer) — "Pine Point" fuzz-tuning line | Phase 1 ✅ GATE PASS. Attach to necromancer's `mangle` campaign/scheduler config. |
| `ouija_tuner/` | **necromancer** (ouija prompt-injection fuzzer) — "Pine Point" | Phase 2 ✅ GATE PASS (injection-ASR 1.0 vs 0.25/0.00). Clean `mutate=` seam, no necromancer edit. |
| `pho3nix_tuner/` | **Pho3nix** (P1, recon profile tuner) | Phase 3 scaffold only; blocked on param-varied rig history (see §8 D2/D3). |
| `tools/_ssrf_guard.py`, `net/hardened-fetch.ts`, `tools/_boundary.py` | **Pho3nix** (+ OSS lib) | Hardened HTTP + file sandbox for the hunting software; also the extractable OSS package. |
| `tools/` hardened HTTP suite (`http_get`, `url_fetch`, `web_search`, `search_text`) | **Pho3nix** | Reusable request tooling for recon plumbing. |
| `tooltime_bounds.py` pattern (min/max/direction metadata) | **ToolTime** | The numeric-bounds layer `tool.yaml` lacks today — extend the ToolTime schema with it. |
| `telemetry/telemetry-reader` streaming aggregation | **alienclaw (engine)** | Reusable util for reading large run logs; keep the reader, drop the writer. |

---

## 4. Secret scan results

| Finding | Location | Severity | Status |
|---|---|---|---|
| Live MySQL production password (Hostinger `api.alienclaw.net` leaderboard DB), embedded in `ALIENCLAW_DB_URL` | `.env.hostinger` **line 3** (`mysql://u881291242_api:<REDACTED>@127.0.0.1/u881291242_leaderboard`) | Secret at rest | **NOT tracked** by git — `.gitignore:127` excludes `.env.hostinger`. Confirmed via `git check-ignore`. |
| Tracked source secrets | — | — | **None found.** `git grep` over tracked files came back empty. |
| `.env.example` | repo root | — | Placeholder values only; safe. |

**Notes / corrections:**
- The password is on **line 3** of `.env.hostinger` (inside the DB URL), not line 4 as the briefing stated;
  line 4 is `ALIENCLAW_API_PORT`. Recorded for accuracy.
- The credential is a real at-rest secret on disk but is correctly gitignored, so it is not in repo history.
- **Recommended action (plan, not yet done):** since the leaderboard/`api/` is being deferred/dropped,
  rotate the Hostinger DB password when the deployment's fate is decided, and keep the only copy out of the
  working tree (e.g. a secrets manager or `~/archive/.../secrets/`, mode 600, matching the v3x-auth key
  precedent). Do **not** copy the live value into any tracked file, including this plan.

---

## 5. Reusable code — where it moves

### → Pho3nix (P1, `~/dev/pho3nix`)
- `net/hardened-fetch.ts` + `tools/_ssrf_guard.py` — SSRF-aware fetch for recon tooling.
- `tools/_boundary.py` — symlink-aware filesystem write jail.
- `tools/http_get.py`, `url_fetch.py`, `web_search.py`, `search_text.py` — hardened request suite.
- `pho3nix_tuner/` — offline recon-profile tuner (once unblocked; §8).

### → "Pine Point" / necromancer fuzz-tuning (`mangle_tuner` + `ouija_tuner`)
- `mangle_tuner/` — GA over mangle campaign config (strategy/alpha/beta/exploration_floor/concurrency/
  timeout/mutator-weights/seeds), fitness = unique crashes / cpu-seconds.
- `ouija_tuner/` — GA over injection carrier/framing/repeats/temperature, fitness = leak-ASR vs a local
  Ollama model.
- Both depend on the shared spine: `genome/` codec + `evolution/` GA + `genome/operators.py`.

### → ToolTime
- `pho3nix_tuner/tooltime_bounds.py` — the `min`/`max`/`direction` metadata the current `tool.yaml`
  (name/type/default/enum only) is missing. Fold into the ToolTime `tool.yaml` schema so gene spaces can be
  authored from the catalog instead of by hand.

### Stays in alienclaw (repurposed engine, shared by all tuners)
- `genome/`, `evolution/` (Python GA), `diagnostics/`, `telemetry/telemetry-reader`.

---

## 6. Untracked file disposition

| File | What it is | Disposition |
|---|---|---|
| `probe-r013-tmp.mjs` | Standalone PKT-1294 RSS repro (streaming `aggregateOnlineFitness`). PKT-1294 already shipped (#620) and the perf bound landed (`e70c485c`). | **DELETE** — throwaway; the work it probed is merged. |
| `.ac-probe-1104/probe-ldr.mjs` | Live MySQL `ON DUPLICATE KEY UPDATE` semantics probe for a leaderboard fitness-capture defect (ac1469). Runs against a local test DB. | **DELETE** (whole `.ac-probe-1104/` dir) — leaderboard/`api/` is deferred/dropped; investigation-only. |
| `test/api/ac1469probe/ac1469-live-db.test.ts` | Self-labelled "PROBE (not shipped)"; needs a live `PROBE_DB_URL` MariaDB. | **DELETE** (whole `ac1469probe/` dir) — not a CI test; leaderboard deferred. |
| `test/diagnostics/test_instrumentation_non_finite.py` | Real regression guard for the PKT-1415 non-finite coercion fix in `instrumentation.py`. | **COMMIT** with its source fix (§7). Guards a KEEP component. |
| `test/fitness/test_pkt087_extract_json_empty_extracted.py` | Real regression test for the PKT-087 `extract_json` empty-extraction correctness fix. | **COMMIT** with its source fix (§7). Caveat: `test/fitness/` is **not in CI scope** — consider relocating to `test/tools/` so it actually runs. |
| `test/martians/zzprobe-pkt1471.test.ts` | Throwaway `__proto__` prototype-pollution probe against `martians/parser.ts` + `substitution.ts`. | **DELETE** — `martians/` is DROP; finding already captured as PKT-1255b in project memory. |
| `test/martians/zzprobe2-pkt1471.test.ts` | Same family (mapping-value `__proto__`). | **DELETE** — as above. |
| `test/martians/zzprobe3-pkt1471.test.ts` | Same family (`__proto__` supplies required slots). | **DELETE** — as above. |
| `test/msb/pkt1416-fileA-openclaw-tool-resolver-prototype-safe.test.ts` | Real File-A test for the PKT-1416 prototype-safe `TOOL_MAP` fix. | **COMMIT** with its source fix (§7), *if* the resolver pattern is carried forward; otherwise archive with the fix. |

**Not in git status but present and noted:** `.coverage`, `.hypothesis/`, `.pytest_cache/`, `.ruff_cache/`
are tool droppings (`.coverage` is gitignored at `.gitignore:128`); leave as-is / ignore. `abc` is a **Unix
domain socket** (`srwxr-xr-x`), not a directory — almost certainly a stray socket from a tool/server; safe
to remove when nothing is bound to it, but it is not a repo artifact.

---

## 7. Modified (uncommitted) file disposition

All four are small, tested correctness/security hardening fixes to components we KEEP or SELL. They
predate the repurpose teardown and should be preserved *into* the salvaged code, not discarded.

| File | Change | Affects | Disposition |
|---|---|---|---|
| `src/alienclaw/diagnostics/instrumentation.py` | PKT-1415: coerce non-finite `correctness`/`fitness` (NaN/±Inf → 0.0) in the recorders. | KEEP (diagnostics) | **COMMIT** with `test/diagnostics/test_instrumentation_non_finite.py`. |
| `src/alienclaw/tools/extract_json.py` | PKT-087: `correctness = 1.0 if extracted else 0.5` — parity with `web_search`/`search_text`; a zero-extraction run no longer scores a perfect 1.0. | KEEP + SELLABLE (tool suite) | **COMMIT** with `test/fitness/test_pkt087_extract_json_empty_extracted.py` (relocate test into CI scope). |
| `src/alienclaw/tools/file_write.py` | Symlink-guard hardening: `assert_no_symlink(write_root / path_str)` on the **unresolved** path before boundary check. | KEEP + SELLABLE (boundary jail) | **COMMIT.** `assert_no_symlink` is confirmed present in `_boundary.py:109`; `test/tools/test_file_boundary.py` is tracked — verify it covers this guard, add a case if not. |
| `src/alienclaw/msb/openclaw-tool-resolver.ts` | PKT-1416: `TOOL_MAP` → `Object.create(null)` so unknown tool names can't resolve inherited `Object.prototype` members as callable `ToolFn`s (which falsely passed the truthiness guard and recorded SUCCESS). | DROP-leaning (`msb/`), but a real security fix | **COMMIT** with `test/msb/pkt1416-fileA-...test.ts` if the resolver survives; otherwise fold the fix into whatever resolver pattern is carried forward. |

**Execution note:** these are on a dirty `main`. `main` is branch-protected (3 required checks:
TypeScript typecheck / Unit tests / Python lint+test+genome coverage — verify via
`gh api repos/bugsyhewitt/AlienClaw/branches/main/protection`). Follow the branch + PR convention: land
the four fixes + their tests as one small "hardening" PR **before** the repurpose teardown, so the
salvaged modules carry the fixes. Run `ruff check src/alienclaw/{genome,brains,evolution}/` is *not* the
relevant scope here; these touch `tools`/`diagnostics`/`msb` — rely on the committed CI config.

---

## 8. Open decisions (from `HANDOFF-2026-11-19.md`)

These block Phase 3 (Pho3nix tuner) and need Bugsy's input before execution.

### D1 — octarig
Bugsy asked "would octarig be useful for this?" at the end of the last session. **No `octarig` exists
anywhere in `~/dev/` or the PAI config.** The question was never answered.
→ **Decision needed:** clarify what `octarig` is before any work depends on it. Do not guess.

### D2 — Nuclei gene space (the Phase 3 target question)
Should Phase 3 retarget **nuclei** instead of nmap/gobuster/sqlmap? The xil-1 rig actually runs
nuclei/wafw00f/testssl/arjun — zero nmap/gobuster/sqlmap rows — so the current gene schema optimizes
tools the rig never uses. Nuclei looked viable at first (91.9% success, 101 distinct entries, applicable
`timeout`/`concurrency`/`rate-limit` rebuild params) but is a **dead end as logged today**: those params
are buried in an `additional_args` string blob with *zero variation* across all 160 runs, so the GA has no
counterfactuals and a rebuild would emit duplicate flags.
→ **Recommendation (from handoff):** yes, nuclei is the right target — but **gate on a Pho3nix schema
change first**. Required: (a) Pho3nix logs `rate-limit`/`concurrency`/`timeout` as **top-level param keys**
(not in `additional_args`), and (b) expand `inspect_history.TARGET_TOOLS` + `genome_schema.py` to
`NUC00001`. Do not rework the gene schema until the data format is confirmed. Pho3nix change is out of
scope for the repurpose repo itself.

### D3 — sentry history
Sentry (`100.79.87.69`) was never checked. It may hold nmap/gobuster runs, or nuclei runs with real param
variation, which would unblock Phase 3 without a Pho3nix schema change.
→ **Recommendation:** a 2-minute check before committing to the nuclei refactor —
```
rsync -av sentry:~/.pho3nix_data/history/run_history.json pho3nix_tuner/data/run_history.sentry.json
python pho3nix_tuner/inspect_history.py pho3nix_tuner/data/run_history.sentry.json
```
(`pho3nix_tuner/data/` is gitignored at `.gitignore:154` — imports never get committed.)

**Phase 3 unblock summary:** the STOP gate (`run_ga.py --dry-run`, confirmed working) flips to GO
automatically once the imported history has ≥ 20 target-tool rows, present timestamps, and ≥ 2 distinct
param signatures per context. Two paths: wait for organic variation, or instrument the rig with a
deliberate A/B exploration mode (the handoff recommends the latter as faster/richer). Phase 4 (leaderboard
/ public genome sharing) is unstarted and not blocked by anything in this repo.

---

## 9. Suggested execution order (once approved)

1. **Preserve the fixes** — land the §7 hardening PR (4 fixes + 3 keeper tests, one relocated into CI scope).
2. **Clean the tree** — delete the §6 throwaway probes (`probe-r013-tmp.mjs`, `.ac-probe-1104/`,
   `ac1469probe/`, `zzprobe*`). Remove the stray `abc` socket if unbound.
3. **Rotate + relocate the secret** — decide the `api/` deployment's fate; rotate the Hostinger password;
   keep the only copy out of the working tree.
4. **Extract the SELLABLE** — split SSRF guard + boundary jail into a dual-language OSS lib under V3X.
5. **Route KEEP code** — move the hardened HTTP/sandbox tooling into Pho3nix; the tuners into
   necromancer/Pho3nix; the bounds metadata into ToolTime.
6. **Archive the DROP surface** — tag/bundle `governance/`, `agents/`, `brains/`, `martians/`, `comms/`,
   `cli/`, installer, chrome-extension, and the dead specs before deletion (git tag + bundle to `~/archive`).
7. **Resolve D1/D2/D3** — answer octarig; gate the nuclei schema change; check sentry history — then run the
   Phase 3 GA for real.

*No step above has been executed. This file is the plan.*
