# Hermes Host — Phase 2 Implementation Spec (live wiring)

Grounds the remaining Hermes integration in the **real** hermes-agent API
(github.com/NousResearch/hermes-agent, verified against source + official docs at
main, 2026-07-16). Phase 1 (PR #267) shipped the `HostAdapter` seam; increment 1
(PR #268) routed the agents through `host.llm()`; increment 2 (PR #274) made the
host functional (tools/CLI/LLM). This spec covers what remains.

> **Live Hermes available (2026-07-17):** a real hermes-agent **v0.15.2** is
> installed on the dev machine (pipx; source readable) — the "needs a live Hermes"
> gate on items 4/6/7/8/9 is **lifted**; they are buildable + testable now.
> **Item 4 (provider-from-config) is DONE and validated** against v0.15.2's real
> `hermes config set model` serialization: `HermesLlmGateway` reads the agent's
> profile `config.yaml` top-level `model: <provider>/<model>` scalar (split on the
> first `/`, per Hermes' `model_normalize.py`), uses it when the provider is
> pi-ai-supported, else falls back to env override / shared defaults.
>
> **Item 8 (web_search dispatch) is DONE and end-to-end-validated** against live
> v0.15.2: `HermesToolResolver` spawns the Hermes venv python
> (`ALIENCLAW_HERMES_PYTHON`) → `model_tools.handle_function_call('web_search',
> args)` (runs headlessly; session params default None) → parses the JSON string,
> raising Hermes' `{"error": …}` as a tool error. Confirmed against the real error
> path ("Web tools are not configured"). A **successful** search needs an operator
> to configure a Hermes web backend (`web.backend` + key, or `pip install ddgs`) —
> not AlienClaw's concern.
>
> **Items 6/7 (installer profile provisioning) are DONE and validated** end-to-end
> against live v0.15.2: `install-hermes.sh` creates the 3 agents as real Hermes
> profiles via `hermes profile create --no-alias --description "<role>"` (no
> `~/.local/bin` wrapper — `--no-alias`/`-y` flags verified against `hermes profile
> --help`), overlays AlienClaw's SOUL.md, runs `hermes profile use bossbot`, is
> idempotent (skips existing), and uninstalls via `hermes profile delete -y`. Ran
> against a throwaway `HERMES_HOME` — zero real state touched.
>
> **Item 9 (`--from-openclaw`) is DONE and validated.** `install-hermes.sh --from-openclaw`
> runs `hermes claw migrate --source <~/.openclaw> --preset full --yes` (flags
> verified vs `hermes claw migrate --help`; secrets excluded — no `--migrate-secrets`)
> BEFORE provisioning, so the 3-profile split is re-applied on top of the flattened
> import. Validated via the migrate `--dry-run` against a throwaway `~/.openclaw` →
> throwaway `HERMES_HOME` (it correctly parses source/target/preset and applies its
> "OpenClaw is running" safety guard); a full real migrate is intentionally blocked
> while OpenClaw runs. **Phase 2 is COMPLETE** — every spec item is built and
> validated against the live hermes-agent v0.15.2.

> **Correction landed with this doc:** the Phase-1 scaffold shipped a few
> **hallucinated Hermes APIs** — `delegation.peers.<name>.frequency`,
> `agent.default`, "MOA as agent routing", and a `~/.hermes/agents/` layout. None
> exist in Hermes. They were written from an early summary, not verified source,
> and are corrected in this PR. The real facts are below.

## Verified Hermes facts (the ones that reshape the plan)

- **Multi-agent unit = the profile**, not an `agents/` dir. A profile is its own
  Hermes home under `~/.hermes/profiles/<name>/` (own `config.yaml`, `.env`,
  `SOUL.md`, skills, state). Created with `hermes profile create <name>
  [--description "<role>"] [--clone-from <p>]`; activated with `hermes profile use
  <name>`; description persisted in `<profile_dir>/profile.yaml`.
- **No `delegation` config section and no typed consult-frequency key.** Config
  sections are `model` / `terminal` / `agent` / `auxiliary` / `updates` /
  `providers`. Multi-agent routing is done by an orchestrator reading each
  profile's **description**. "BossBot consults AdvisorBot often" therefore stays
  **behavioral prose** in `SOUL.md` (rule 2) on both hosts — nothing in Hermes
  config enforces it. Typed named-profile delegation (`agent_profiles`) is
  **unmerged upstream** (issue #9459 closed, PR #15785 open) — deferred.
- **Provider config**: `model.default` / `model.provider` / `model.base_url` in
  `config.yaml`; secrets (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` +
  `OPENROUTER_BASE_URL`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, …) in `.env`.
  Precedence CLI > config.yaml > .env > defaults. OAuth-only providers (nous
  device-code, openai-codex, xai-oauth) store creds in `auth.json` — a naive TS
  `.env`-key read cannot resolve those.
- **CLI**: `hermes` builds argparse subparsers in-core. Passthrough to drive an
  agent: `hermes -p <profile> chat` / `hermes -z "<prompt>"` (no `--system` flag).
- **`hermes claw migrate`** (real): imports from `~/.openclaw` etc.; **flattens the
  3-agent topology into one profile** — re-apply the split afterward.

## Work items

**Corrected in this PR (static, no live Hermes):**
- **1. `installProfile()`** → `agentsDir` points at `~/.hermes/profiles/` (was `agents/`).
- **2. De-hallucinate** `seed/agents-hermes/*/AGENTS.md`, the seed README, and the
  installer TODO block: profiles + descriptions + prose, no fake config keys.

**Next increment (static, testable with fixtures — flips the fail-fast stubs to functional):**
- **3. `HermesHostAdapter.registerCli()`** — stop throwing; `program` is AlienClaw's
  OWN commander (via `cli/register.run.ts`), host-independent → reuse
  `registerRunCommand`. (Whether the `hermes` binary can host a third-party verb is
  unconfirmed — do not assert impossibility; AlienClaw keeps its own CLI regardless.)
- **4. `HermesLlmGateway.complete()`** — read the agent's profile `config.yaml`/`.env`
  for `model.{provider,default,base_url}` + provider key, map the Hermes provider id
  to a pi-ai provider, then `getModel + completeSimple + extractText` (mirror
  `PiAiLlmGateway`). **Constrain to `.env`-key providers**; OAuth-only providers are
  out of scope (documented limitation). Unit-testable against fixture config/.env.
- **5. `HermesHostAdapter.wireToolAdapters()`** — stop throwing; call the shared
  `wireToolAdapters()` so `url_fetch`/`file_read`/`file_write` (host-agnostic) resolve;
  `web_search` stays the host-bound stub. Unblocks `HermesToolResolver`'s shared branch.

**Blocked on a live Hermes install/source:**
- **6. Provision profiles** in `install-hermes.sh` via `hermes profile create --description`
  + `hermes profile use` (replace the raw file copy) — needs the non-interactive
  contract / idempotency verified on a live binary.
- **7. Preflight install + pin** — real one-liner is `pip install hermes-agent` /
  `uv pip install hermes-agent` (the `curl … /install.sh` host is
  `hermes-agent.nousresearch.com`, **not** a repo `scripts/install.sh`). `hermes
  setup` subcommands exist; `--non-interactive`/`--quick` flags are **unconfirmed**.
- **8. `web_search`** → Hermes tool registry dispatch. The exact public module path
  and headless call/return shape are unconfirmed against source.
- **9. `--from-openclaw`** → `hermes claw migrate` + re-apply the 3-profile topology.

## Risks
- Pin an exact hermes-agent commit for the integration branch; unpinned, every
  signature above can drift.
- The TS LLM gateway reproduces Hermes provider resolution rather than calling its
  Python `resolve_runtime_provider()` — can drift for OAuth/credential-pool providers.
  Constrain scope and document.
- `web_search` via a Hermes-venv Python subprocess couples the TS tool path to the
  Hermes interpreter being discoverable (same fragility as the summon bridge).
- No Hermes mechanism enforces the AdvisorBot-consult rule — prose only.
