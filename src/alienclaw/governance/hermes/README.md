# AlienClaw for Hermes — Governance Shim

Hermes-host implementation of the `HostAdapter` seam
(`../common/host-adapter.ts`). Governance itself stays in `common/`; only the
four host-specific capabilities live here.

## Files
- `hermes-host.ts` — `HermesHostAdapter implements HostAdapter`. **Functional:** `wireToolAdapters()` registers the shared host-agnostic tools, `llm()` resolves a pi-ai provider, `registerCli()` mounts AlienClaw's `run` verb, `installProfile()` returns real `~/.hermes/profiles` paths.
- `hermes-tool-resolver.ts` — `HermesToolResolver implements ToolResolver`, mirroring `msb/openclaw-tool-resolver.ts`. Freezes the 8-name logical tool contract; host-agnostic tools resolve through the shared adapter registry; `web_search` (host-bound) returns a "pending Hermes tool-layer wiring" stub.
- `hermes-llm-gateway.ts` — `HermesLlmGateway implements LlmGateway`. Resolves provider/model from `ALIENCLAW_HERMES_PROVIDER`/`ALIENCLAW_HERMES_MODEL` (else shared defaults) and calls the shared `piAiComplete`.

Selected via `ALIENCLAW_HOST=hermes` (`wiring/host-select.ts`); default is `openclaw`.

## Wiring checklist
Done (this increment): shared tool wiring · LLM provider via pi-ai (env-overridable) · CLI `run` verb.

Deferred (needs a live Hermes — see `docs/hermes-phase2-spec.md`):
1. **web_search** — register the host-bound tool against Hermes' tool registry (`tools/registry.py` → `toolsets.py` → `model_tools.py`).
2. **Provider from config** — read the active profile's `~/.hermes/profiles/<name>/config.yaml` (`model.default/provider/base_url`) instead of the env override; OAuth-only providers (nous/openai-codex/xai) are out of scope.
3. **Install** — real profile provisioning via `hermes profile create <name> --description` + `hermes profile use bossbot` (Hermes has no `delegation` section; routing is by profile description); optional `--from-openclaw` via `hermes claw migrate` (flattens the 3-agent topology — re-apply the split after).
4. **Bridge** — point `ALIENCLAW_PYTHON_BIN` at the Hermes `uv` venv python (`real-summon-adapter.ts` already reads this env; no code change).

## Interchangeability invariant
Nothing below the Martian summon boundary belongs here. Genome codec, registry,
fitness, evolution and the `RealMartianSummonAdapter → python3 -m alienclaw.bridge`
path are shared with OpenClaw — that shared path is what keeps a Martian
interchangeable between hosts. Do not add a `summonAdapter()` to `HostAdapter`.
