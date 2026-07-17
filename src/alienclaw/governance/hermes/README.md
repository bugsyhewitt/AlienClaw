# AlienClaw for Hermes — Governance Shim

Hermes-host implementation of the `HostAdapter` seam
(`../common/host-adapter.ts`). Governance itself stays in `common/`; only the
four host-specific capabilities live here.

## Files
- `hermes-host.ts` — `HermesHostAdapter implements HostAdapter`. **Scaffold:** capability calls fail fast with "Hermes host not yet wired — …". `installProfile()` returns real `~/.hermes` paths.
- `hermes-tool-resolver.ts` — `HermesToolResolver implements ToolResolver`, mirroring `msb/openclaw-tool-resolver.ts`. Freezes the 8-name logical tool contract; host-agnostic tools delegate to the shared adapter registry, `web_search` throws pending Hermes wiring.
- `hermes-llm-gateway.ts` — `HermesLlmGateway implements LlmGateway`. Stub.

Selected via `ALIENCLAW_HOST=hermes` (`wiring/host-select.ts`); default is `openclaw`.

## Wiring checklist (deferred live-integration phase)
1. **Tools** — register host-bound tools against Hermes' tool registry (`tools/registry.py` → `toolsets.py` → `model_tools.py`); make `HermesHostAdapter.wireToolAdapters()` register Hermes-native + shared adapters instead of throwing.
2. **LLM** — implement `HermesLlmGateway.complete()` against the Hermes provider layer (`hermes model` / Nous Portal / OpenRouter; `model.*` in `~/.hermes/config.yaml`).
3. **CLI** — decide where AlienClaw verbs (`run`/`evolve`/`submit`) register on Hermes (`hermes_cli/`).
4. **Install** — finish `install-hermes.sh` provisioning + `hermes config set` delegation wiring; optionally support `--from-openclaw` via `hermes claw migrate`.
5. **Bridge** — point `ALIENCLAW_PYTHON_BIN` at the Hermes `uv` venv python (`real-summon-adapter.ts` already reads this env; no code change).

## Interchangeability invariant
Nothing below the Martian summon boundary belongs here. Genome codec, registry,
fitness, evolution and the `RealMartianSummonAdapter → python3 -m alienclaw.bridge`
path are shared with OpenClaw — that shared path is what keeps a Martian
interchangeable between hosts. Do not add a `summonAdapter()` to `HostAdapter`.
