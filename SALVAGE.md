# AlienClaw — Salvage Report

**Date:** 2026-11-20  
**Repo:** `bugsyhewitt/AlienClaw` @ `main` `2d1cace3`  
**Working tree:** dirty (4 modified, 9 untracked — disposition in §6–7)  
**Decision record:** `PLAN.md` (Opus-authored, same date)

---

## 1. Component Inventory

### Source modules (`src/alienclaw/`)

| Module | LOC | Verdict |
|--------|-----|---------|
| `genome/` (alphabet, checksum, codec, operators, types, validation) | 925 | **KEEP + SELLABLE** |
| `evolution/` (Python GA: generation, population, selection, storage, stats, online_fitness, bridge_runner, live_evo) | 4503 | **KEEP** |
| `diagnostics/` (Bayesian optimizer, plateau_detector, fitness_ceiling, sensitivity_audit, instrumentation) | 3002 | **KEEP** |
| `tools/` (_ssrf_guard, _boundary, http_get, url_fetch, extract_json, file_read/write, search_text, compute, web_search, registry, limits) | 1113 | **KEEP + SELLABLE** |
| `net/hardened-fetch.ts` (SSRF-aware fetch) | 368 | **KEEP + SELLABLE** |
| `fitness/` (conformance shell, graded types) | 285 | **DROP metric / KEEP shell** — `function.py` self-referential fitness retired; conformance scaffolding stays as per-domain adapter plug |
| `telemetry/` (reader, writer) | 390 | **KEEP reader / DROP rest** |
| `registry/` (genome-codec.ts, genome-operators.ts, martian-registry, ms-loader, seed-installer) | 1083 | **SPLIT** — genome-codec/operators TS mirrors: KEEP; martian-registry/ms-loader/seed-installer: DROP |
| `msb/` (martian-executor, openclaw-tool-resolver, tool-adapters) | 1482 | **DROP (mostly)** — PKT-1416 prototype-safety fix worth preserving wherever resolver pattern survives |
| `governance/` (goal-loop, task-manager, summon-adapter, state machines, Hermes/OpenClaw adapters) | 6032 | **DROP → archive** |
| `agents/` (BossBot/AdvisorBot/CreatorBot TS wrappers) | 831 | **DROP** |
| `brains/` (MartianBrain registry/decoder/parser) | 636 | **DROP** |
| `martians/` (registry, parser, substitution, validator) | 1125 | **DROP** — `substitution.ts` carries live PKT-1255b `__proto__` prototype-pollution defect; fix before any reuse |
| `bridge/` (Python↔TS bridge server) | 445 | **DROP** — tuners are pure-Python |
| `comms/` (AgentChannel, UserChannel) | 216 | **DROP** |
| `cli/` (evolve, submit, show, runs, leaderboard) | 1145 | **DROP → archive** |
| `api/` (Express + MySQL leaderboard, deployed at api.alienclaw.net) | 2246 | **DEFER** — Phase 4 public genome sharing; keep deployment alive, out of teardown scope |
| `config/`, `wiring/`, `prompts/`, `constants.ts`, `utils.ts` | ~600 | **DROP** — fold what tuners need |

### Non-source surfaces

| Item | Verdict |
|------|---------|
| `mangle_tuner/` (Phase 1 ✅ GATE PASS) | **KEEP — route to necromancer** |
| `ouija_tuner/` (Phase 2 ✅ GATE PASS, injection-ASR 1.0) | **KEEP — route to necromancer** |
| `pho3nix_tuner/` (Phase 3 scaffold, GA blocked on data) | **KEEP — route to Pho3nix** |
| `docs/specs/GENOME_SPEC.md`, `MATHEMATICAL_FOUNDATIONS.md`, `evolution-loop.md`, `fitness-graded-conformance.md` | **KEEP** |
| `docs/specs/` (LEADERBOARD_API, MARTIANBRAIN, SUBAGENT, SPECIALIST, SUMMON_BRIDGE) | **DROP → archive** |
| `docs/LESSONS_FROM_THE_ARC.md`, `docs/locked-decisions.md` | **KEEP (institutional memory)** |
| `seed/agents/` (BossBot/AdvisorBot/CreatorBot workspace files) | **DROP** |
| `installer/`, `install.sh`, `install-hermes.sh` | **DROP** |
| `assets/chrome-extension/` | **DROP** |
| `site/` | **DROP** (already retired; deploy refuses without env override) |
| `perf/` | **REVIEW** before drop |
| `VISION.md`, `ROADMAP.md`, `ROADMAP-E2-live-fitness.md` | **KEEP (orient future phases)** |

---

## 2. SELLABLE — Who Pays, How

| Component | Who would pay / benefit | How to ship | Honest assessment |
|-----------|------------------------|-------------|-------------------|
| **SSRF guard + hardened fetch** (`net/hardened-fetch.ts`, `tools/_ssrf_guard.py`) | AI-agent builders, pentest tooling authors, anyone giving an LLM an HTTP tool | npm `@v3x/hardened-fetch` + PyPI `ssrf-guard`; OSS + "SSRF-proofing agent tools" blog post | **Strongest.** Dual-language, battle-tested against `jail-hostile-genomes`, real gap in the market. OSS → consulting funnel is credible. |
| **Filesystem boundary jail** (`tools/_boundary.py`) | Same audience — safe file tools for agents | Bundle with the SSRF guard as "agent tool sandbox" | Pairs naturally; symlink-aware write jail is the differentiator. |
| **Portable checksummed genome codec** (`genome/`) | Teams needing reproducible, shareable config artifacts (fuzzing campaigns, autotuning) | PyPI lib + existing `GENOME_SPEC.md` as public spec; blog post on "deterministic config artifacts" | Distinctive engineering, thin market without a domain. OSS credibility play, not direct revenue. |
| **Graded-conformance fitness framework** (`fitness/` scaffolding, `docs/fitness-graded-conformance.md`) | Agent/LLM eval harness builders | Blog post / OSS snippet | Niche. Content value only. |
| **GA tuner core** (`evolution/`) | Config/hyperparameter tuning | OSS only | Crowded (CoTune, Bayesian autotuning, AFL++). No edge — keep for internal use, do not pitch. |
| **Leaderboard API** (`api/`) | — | — | Generic Express+MySQL CRUD. Not distinctive; repurpose internally or retire. |

**Recommendation:** extract the SSRF guard + boundary jail as one small dual-language OSS lib under the V3X org. It is the only component where "who pays" has a real (consulting) answer and the extraction cost is low.

---

## 3. KEEP — Destination Project

| Component | Destination | Notes |
|-----------|-------------|-------|
| `genome/` codec + `GENOME_SPEC.md` | **alienclaw (repurposed engine)** | Shared artifact format for all tuners; also extract as PyPI lib |
| `evolution/` Python GA, `genome/operators.py`, `evolution/selection.py` | **alienclaw (repurposed engine)** | GA spine; only fitness module changes per domain |
| `diagnostics/` (Bayesian, plateau, sensitivity, instrumentation) | **alienclaw (repurposed engine)** | Tuning diagnostics reused by all three tuners |
| `telemetry/telemetry-reader.ts` | **alienclaw (engine)** | Streaming aggregation util for large run logs |
| `mangle_tuner/` | **necromancer** (mangle H.265 fuzzer) | Phase 1 ✅ GATE PASS |
| `ouija_tuner/` | **necromancer** (ouija prompt-injection fuzzer) | Phase 2 ✅ GATE PASS |
| `pho3nix_tuner/` | **Pho3nix** (P1, recon profile tuner) | Phase 3 scaffold; blocked on param-varied rig history (see §8) |
| `tools/_ssrf_guard.py`, `net/hardened-fetch.ts`, `tools/_boundary.py` | **Pho3nix** + OSS lib | SSRF + filesystem sandbox for hunting software |
| `tools/http_get.py`, `url_fetch.py`, `web_search.py`, `search_text.py` | **Pho3nix** | Hardened request suite for recon plumbing |
| `pho3nix_tuner/tooltime_bounds.py` (bounds metadata pattern) | **ToolTime** | Extend `tool.yaml` schema with `min`/`max`/`direction` fields so gene spaces author from the catalog |
| `docs/specs/GENOME_SPEC.md` | **alienclaw** | Canonical codec spec |
| `docs/MATHEMATICAL_FOUNDATIONS.md`, `docs/evolution-loop.md`, `docs/fitness-graded-conformance.md` | **alienclaw** | Survive the teardown |

---

## 4. Secret Scan

| Finding | File | Line | Severity | Status |
|---------|------|------|----------|--------|
| Live MySQL production password embedded in `ALIENCLAW_DB_URL` for `api.alienclaw.net` Hostinger leaderboard DB | `.env.hostinger` | **3** | Secret at rest | **NOT tracked** — `.gitignore` excludes `.env.hostinger` (confirmed `git check-ignore`). Not in repo history. |
| Tracked source secrets | — | — | — | **None found.** `git grep` over tracked TS/Python/JSON/YAML/shell files came back empty. |
| `.env.example` | repo root | — | — | Placeholder values only; safe. |

**Action (plan, not done):** when the `api/` deployment fate is decided, rotate the Hostinger DB password and store the only copy out of the working tree (e.g. `~/archive/.../secrets/`, mode 600, following the v3x-auth RS256 key precedent). Do **not** copy the value into any tracked file.

---

## 5. Reusable Code — Where It Moves

### → Pho3nix (`~/dev/pho3nix`)
- `net/hardened-fetch.ts` + `tools/_ssrf_guard.py` — SSRF-aware HTTP fetch
- `tools/_boundary.py` — symlink-aware filesystem write jail
- `tools/http_get.py`, `url_fetch.py`, `web_search.py`, `search_text.py` — hardened request suite
- `pho3nix_tuner/` — offline recon-profile tuner (once unblocked by D2/D3)

### → "Pine Point" / necromancer fuzz-tuning
- `mangle_tuner/` — GA over mangle campaign config (strategy/alpha/beta/exploration_floor/concurrency/timeout/mutator-weights/seeds), fitness = unique crashes / cpu-seconds
- `ouija_tuner/` — GA over injection carrier/framing/repeats/temperature, fitness = leak-ASR vs local Ollama
- Both depend on shared spine: `genome/` codec + `evolution/` Python GA

### → ToolTime
- `pho3nix_tuner/tooltime_bounds.py` pattern — `min`/`max`/`direction` parameter metadata the current `tool.yaml` schema lacks; fold into ToolTime so gene spaces can be authored from the catalog

### Stays in alienclaw (engine, shared by all tuners)
- `genome/`, `evolution/` (Python GA), `diagnostics/`, `telemetry/telemetry-reader`

---

## 6. Untracked File Disposition

| File | What it is | Action |
|------|-----------|--------|
| `probe-r013-tmp.mjs` | Standalone PKT-1294 RSS repro. PKT-1294 already shipped (#620), perf bound merged. | **DELETE** |
| `.ac-probe-1104/probe-ldr.mjs` | Live MySQL `ON DUPLICATE KEY UPDATE` semantics probe (ac1469 leaderboard defect). Leaderboard is deferred. | **DELETE** entire `.ac-probe-1104/` dir |
| `test/api/ac1469probe/ac1469-live-db.test.ts` | "PROBE (not shipped)" self-labelled; needs live `PROBE_DB_URL`. Not a CI test. | **DELETE** entire `ac1469probe/` dir |
| `test/diagnostics/test_instrumentation_non_finite.py` | Real regression guard for the PKT-1415 non-finite coercion fix in `instrumentation.py` | **COMMIT** with its source fix (§7) |
| `test/fitness/test_pkt087_extract_json_empty_extracted.py` | Real regression test for PKT-087 `extract_json` empty-extraction fix | **COMMIT** with its source fix; note `test/fitness/` is not in CI scope — relocate to `test/tools/` |
| `test/martians/zzprobe-pkt1471.test.ts` | Throwaway `__proto__` probe for `martians/parser.ts`+`substitution.ts` | **DELETE** — `martians/` is DROP; finding captured as PKT-1255b |
| `test/martians/zzprobe2-pkt1471.test.ts` | Same family (mapping-value `__proto__`) | **DELETE** |
| `test/martians/zzprobe3-pkt1471.test.ts` | Same family (`__proto__` supplies required slots) | **DELETE** |
| `test/msb/pkt1416-fileA-openclaw-tool-resolver-prototype-safe.test.ts` | Real File-A test for PKT-1416 prototype-safe `TOOL_MAP` | **COMMIT** with its source fix if resolver survives; otherwise archive with the fix |

**Also noted:** `abc` at repo root is a **Unix domain socket** (`srwxr-xr-x`), not a directory — stray socket from a tool/server process. Safe to remove when nothing is bound to it; not a repo artifact.

---

## 7. Modified (Uncommitted) File Disposition

All four are small, tested correctness/security hardening fixes to KEEP or SELLABLE components. Land as one "hardening" PR before any repurpose teardown so salvaged modules carry the fixes.

| File | Change (packet) | Verdict |
|------|----------------|---------|
| `src/alienclaw/diagnostics/instrumentation.py` | PKT-1415: coerce NaN/±Inf `correctness`/`fitness` → 0.0 in recorders | **COMMIT** with `test/diagnostics/test_instrumentation_non_finite.py` |
| `src/alienclaw/tools/extract_json.py` | PKT-087: `correctness = 1.0 if extracted else 0.5` — zero-extraction no longer scores 1.0, parity with `web_search`/`search_text` | **COMMIT** with `test/fitness/test_pkt087_extract_json_empty_extracted.py` (relocate test into CI scope) |
| `src/alienclaw/tools/file_write.py` | Symlink-guard: `assert_no_symlink()` on unresolved path before boundary check | **COMMIT** — `assert_no_symlink` confirmed in `_boundary.py:109`; verify `test/tools/test_file_boundary.py` covers this guard |
| `src/alienclaw/msb/openclaw-tool-resolver.ts` | PKT-1416: `TOOL_MAP → Object.create(null)` so `Object.prototype` members can't resolve as callable tools | **COMMIT** with `test/msb/pkt1416-fileA-...test.ts` |

**Branch-protection note:** `main` has 3 required CI checks (TypeScript typecheck / Unit tests / Python lint+test+genome coverage). These fixes need a branch + PR, not a direct push.

---

## 8. Open Decisions (from `HANDOFF-2026-11-19.md`)

**D1 — octarig:** Bugsy asked "would octarig be useful?" at end of last session. No `octarig` found anywhere in `~/dev/` or PAI config. The question was not answered.  
→ **Clarify what octarig is before any work depends on it.**

**D2 — Nuclei gene space:** Phase 3 currently targets nmap/gobuster/sqlmap; xil-1 runs nuclei/wafw00f/testssl/arjun (zero target-tool rows). Nuclei looks viable (91.9% success, 101 entries, applicable rebuild params) but all 160 runs have `rate-limit`/`timeout` buried in `additional_args` with zero variation — the GA has no counterfactuals.  
→ **Gate on a Pho3nix schema change first** (log rate-limit/concurrency/timeout as top-level param keys); then expand `inspect_history.TARGET_TOOLS` and `genome_schema.py` to `NUC00001`.

**D3 — sentry history:** Sentry (`100.79.87.69`) was not checked. May have nmap/gobuster runs or nuclei runs with real param variation.  
→ **2-minute check before committing to the nuclei refactor:**
```
rsync -av sentry:~/.pho3nix_data/history/run_history.json pho3nix_tuner/data/run_history.sentry.json
python pho3nix_tuner/inspect_history.py pho3nix_tuner/data/run_history.sentry.json
```
(`pho3nix_tuner/data/` is gitignored — data never commits.)

**Phase 3 unblock:** the `--dry-run` STOP gate flips to GO automatically once the history has ≥ 20 target-tool rows, timestamps, and ≥ 2 distinct param signatures per context.

---

## 9. Suggested Execution Order

1. **Preserve the fixes** — land the §7 hardening PR (4 fixes + 3 keeper tests, `test/fitness/` test relocated into CI scope)
2. **Clean the tree** — delete the §6 throwaway probes; remove stray `abc` socket if unbound
3. **Rotate + relocate the secret** — decide `api/` fate; rotate Hostinger DB password; keep copy off working tree
4. **Extract the SELLABLE** — split SSRF guard + boundary jail into dual-language OSS lib under V3X
5. **Route KEEP code** — hardened HTTP/sandbox tooling → Pho3nix; tuners → necromancer/Pho3nix; bounds metadata → ToolTime
6. **Archive the DROP surface** — git tag + bundle `governance/`, `agents/`, `brains/`, `martians/`, `comms/`, `cli/`, installer, chrome-extension, dead specs → `~/archive/`
7. **Resolve D1/D2/D3** — answer octarig; check sentry history; gate nuclei schema change; then run Phase 3 GA for real
