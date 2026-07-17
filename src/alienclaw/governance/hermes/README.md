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
Done:
- shared tool wiring · CLI `run` verb.
- **LLM provider** resolved from the agent's Hermes profile `config.yaml` top-level `model:` scalar (`<provider>/<model>`, pi-ai-supported providers), env-overridable, else shared defaults — validated against hermes-agent v0.15.2's real `hermes config set model` serialization.
- **web_search** dispatches to Hermes' tool layer: spawns the Hermes venv python (`ALIENCLAW_HERMES_PYTHON`) → `model_tools.handle_function_call('web_search', args)` → parse the JSON string, raising Hermes' `{"error": …}` as a tool error. End-to-end-validated against live v0.15.2 (error path). A **successful** search needs Hermes to have a web backend configured (`web.backend` + key, or the `ddgs` package) — an operator prerequisite.

Deferred (see `docs/hermes-phase2-spec.md`):
1. **Provider resolution boundary** — the config read does NOT replicate Hermes' `provider: auto` resolution, per-role/auxiliary models, `base_url` precedence, or OAuth-only providers (nous/openai-codex/xai; creds in `auth.json`). It reads only the explicit `model:` scalar.
2. **`--from-openclaw` import** — optional path via `hermes claw migrate` (flattens the 3-agent topology into one profile — re-apply the split after). Still a TODO in `install-hermes.sh`.
3. **Bridge** — point `ALIENCLAW_PYTHON_BIN` at the Hermes venv python (`real-summon-adapter.ts` already reads this env; no code change).

`install-hermes.sh` now provisions the 3 agents as real Hermes profiles
(`hermes profile create --no-alias --description` + SOUL.md overlay +
`hermes profile use bossbot`), idempotently, with `--uninstall` via
`hermes profile delete -y`. Validated end-to-end against live v0.15.2 in a
throwaway `HERMES_HOME` (no `~/.local/bin` pollution, thanks to `--no-alias`).

## Interchangeability invariant
Nothing below the Martian summon boundary belongs here. Genome codec, registry,
fitness, evolution and the `RealMartianSummonAdapter → python3 -m alienclaw.bridge`
path are shared with OpenClaw — that shared path is what keeps a Martian
interchangeable between hosts. Do not add a `summonAdapter()` to `HostAdapter`.
