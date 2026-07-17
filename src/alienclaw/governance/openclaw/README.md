# AlienClaw for OpenClaw — Governance Shim

OpenClaw-host implementation of the `HostAdapter` seam
(`../common/host-adapter.ts`). This is the **live** host.

## Files
- `openclaw-host.ts` — `OpenClawHostAdapter implements HostAdapter`, plus `PiAiLlmGateway`. A thin composition layer that **delegates** to the existing OpenClaw integration rather than moving it:
  - `wireToolAdapters()` → the live `msb/tool-adapters.ts::wireToolAdapters()` registry.
  - `toolResolver()` → `msb/openclaw-tool-resolver.ts::OpenClawToolResolver` (parity/testing view).
  - `llm()` → `PiAiLlmGateway`, wrapping `getModel(ALIENCLAW_PROVIDER, AGENT_MODELS[agent]) + completeSimple`. **Single source of truth:** `agents/bossbot.ts` and `agents/advisorbot.ts` route their LLM calls through `selectHost().llm().complete(...)`, so the provider is host-selected.
  - `registerCli()` → `cli/register.run.ts::registerRunCommand`.
  - `installProfile()` → `~/.openclaw` paths.

Selected by default (`ALIENCLAW_HOST` unset or `openclaw`).

## Note
The OpenClaw tool/provider integration still largely lives in `common/`, `msb/`,
and `agents/`; this adapter composes it behind the interface without a bulk file
move (near-zero blast radius). Splitting `web_search` out of the shared adapter
file is a follow-up once a Hermes `web_search` exists. Nothing below the Martian
summon boundary belongs here (see the interchangeability invariant in
`host-adapter.ts`).
