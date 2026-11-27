# staging/: liftable salvage packages

AlienClaw's original agent product (BossBot / AdvisorBot / CreatorBot, Martians, brains, bridge)
is being retired. What survives is staged here as **copies** of in-tree code. Each package can be
lifted into its future home (a package index, Pho3nix, necromancer, ToolTime, an OSS repo) on
Bugsy's go. Nothing in this folder has been moved, published or installed anywhere. The in-tree
sources stay where they are until teardown pass 2.

| Package | What it is | Destination (proposed) | Depends on |
|---|---|---|---|
| `agent-tool-sandbox/python/` | `agent_tool_sandbox`: SSRF guard with connection pinning, plus a filesystem boundary jail | OSS lib (`agent-tool-sandbox`) | stdlib |
| `agent-tool-sandbox/ts/` | `@v3x/hardened-fetch`: SSRF-hardened fetch with connection pinning | OSS lib (`@v3x/…`) | node built-ins |
| `agent-tool-sandbox/vectors/` | Shared SSRF vector corpus used by both languages' tests | ships with the OSS lib | — |
| `ga-engine/` | `alienclaw_ga`: genome codec, evolution, diagnostics (the GA engine with no DROP imports) | stays the AlienClaw engine | numpy/scipy (diagnostics) |
| `genome-ts/` | `@alienclaw/genome-codec`: the TS mirror of the codec | stays with the engine | node built-ins |
| `necromancer-tuners/` | mangle and ouija campaign tuners | necromancer | `alienclaw-ga` |
| `pho3nix-tuner/` | offline recon-profile tuner (its data gate is closed today) | Pho3nix | `alienclaw-ga` |
| `pho3nix-recon-http/` | http_get / url_fetch / web_search / search_text | Pho3nix | `agent-tool-sandbox` |
| `tooltime-bounds/` | proposal: parameter bounds in ToolTime's tool.yaml, with a validator | ToolTime | pyyaml |
| `tools/` | DROP manifest generator and drift checker | stays here | stdlib (+pyyaml) |
| `teardown-pass2/` | patches and dry run for retiring the DROP surface; **not applied** | — | — |

## Conventions

- **Provenance.** Every package has a `PROVENANCE.json` listing, for each file derived from a
  source, the source path and its git blob sha. It marks the copy `verbatim` or `adapted` and
  lists the divergences. New files go in `new_files`. Sources that live on an unmerged PR carry a
  `source_ref`.
- **Drift.** `python3 staging/tools/check_drift.py` fails when a source changed after staging.
  Re-port the fix into the copy, then refresh `source_blob`.
- **Names.** Package names are unique (`agent_tool_sandbox`, `alienclaw_ga`, …), so nothing
  shadows `alienclaw` on `PYTHONPATH`.
- **Tests.** Tests are network-free: DNS, HTTP, Ollama and the fuzzer are mocked; loopback
  listeners only. Most packages have a `parity-in-tree` test that compares the copy with the
  in-tree original and skips cleanly once the original is gone.
- **CI.** Root `npx vitest run` also collects the staged TS tests. The staged Python suites are
  not in CI yet. `staging/ci-staging.patch` adds a non-required "Staged packages" job that runs
  `run-all-tests.sh`. Apply it with a workflow-scoped token; this session's token can't edit
  workflows. Use `ci-staging-after-pass2.patch` if `teardown-pass2/ci-pass2.patch` lands first.

## Running

```bash
bash staging/run-all-tests.sh                # every suite + drift check (heavy-lock aware on Alfred)
bash staging/run-all-tests.sh ga-engine      # one package
python3 staging/tools/check_drift.py --json  # drift only
```

## Known limits (see `docs/salvage/`)

- The sandbox libraries are **not yet fit to publish**. `docs/salvage/SANDBOX-SECURITY-REVIEW.md`
  and `PINNING-SECURITY-REVIEW.md` list the remaining blockers, and
  `OSS-LIB-EXTRACTION-PLAN.md` lists the gates.
- The pinning API exists only in the staged libraries; the in-tree tools still re-resolve at
  connect time.
- The Python and TS block-lists differ by design today; `agent-tool-sandbox/vectors/DIFFERENCES.md`
  holds the strictest-wins proposal for Bugsy.
- Tuner GATE PASS evidence is weaker than first recorded; see `docs/salvage/TUNER-EVIDENCE-AUDIT.md`.
