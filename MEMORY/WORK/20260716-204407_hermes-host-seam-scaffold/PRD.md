---
task: Extract host-abstraction seam and scaffold Hermes host
slug: 20260716-204407_hermes-host-seam-scaffold
effort: advanced
phase: complete
progress: 16/16
mode: interactive
iteration: 5
started: 2026-07-16T20:44:07-04:00
updated: 2026-07-16T22:00:00-04:00
---

## Context

User is building a separate Hermes-Agent-based AlienClaw (github.com/NousResearch/hermes-agent) that works identically to the OpenClaw version, with Martians interchangeable between hosts. Chosen scope: extract the host-abstraction seam + scaffold `governance/hermes/` (architecture-first; no live Hermes wiring). Design: 2 Explore + 2 Plan agents + hand-verification; approved plan at `Plans/hazy-tickling-quail.md`. Decision: keep governance in TypeScript, port to Hermes via a thin `HostAdapter` (don't rewrite in Python) — the shared JSON-bridge + logical-tool boundary is what guarantees interchangeability.

## Criteria

- [x] ISC-1: HostAdapter interface created (governance/common/host-adapter.ts), excludes summon
- [x] ISC-2: Interface exported from governance/common/index.ts
- [x] ISC-3: OpenClawHostAdapter (live, delegating) + PiAiLlmGateway created
- [x] ISC-4: HermesToolResolver stub created, freezes 8-name tool contract
- [x] ISC-5: HermesLlmGateway stub created (throws not-wired)
- [x] ISC-6: HermesHostAdapter created, fails fast on boot capabilities
- [x] ISC-7: host-select.ts selects adapter by ALIENCLAW_HOST (default openclaw)
- [x] ISC-8: hierarchy-bootstrap.ts routes tool wiring through selectHost()
- [x] ISC-9: alienclaw.mjs passthrough target host-selectable
- [x] ISC-10: governance/{openclaw,hermes}/README.md refreshed with contracts
- [x] ISC-11: seed/agents-hermes/ variant created (3 agents; AGENTS.md → Hermes delegation)
- [x] ISC-12: install-hermes.sh skeleton (dry-run, uninstall, --from-openclaw)
- [x] ISC-13: host-adapter.test.ts covers parity + fail-fast + contract + selection
- [x] ISC-14: tsc clean
- [x] ISC-15: full vitest green (existing behavior unchanged, default openclaw)
- [x] ISC-16: cross-language conformance + comm-graph ===7 still pass

Anti-criteria:
- [x] ISC-A1: No comm-graph edges added (===7 holds)
- [x] ISC-A2: constants.ts roster untouched
- [x] ISC-A3: summon-adapter / real-summon-adapter untouched (interchangeability invariant)
- [x] ISC-A4: No production Python substrate changed
- [x] ISC-A5: Wall-check clean (Subagent/Martian, no capital-S Specialist)

## Decisions

- Thin composition (delegation), not a bulk file move — near-zero blast radius; OpenClawHostAdapter delegates to existing wireToolAdapters/OpenClawToolResolver/registerRunCommand/pi-ai.
- Hermes capabilities fail fast on boot (wireToolAdapters throws) so selecting Hermes never silently runs OpenClaw's tool layer — matches the scaffold verification.
- Reused the existing `ToolResolver` interface and cross-language fixture-runner conformance harness rather than inventing new ones.
- Seed AGENTS.md rewritten (not copied): Hermes routing is the `delegation` config section, not OpenClaw AGENTS.md entries; the "BossBot consults AdvisorBot often" hard rule preserved there.

## Verification

- tsc --noEmit clean; full vitest green (default ALIENCLAW_HOST=openclaw preserves behavior).
- New host-adapter.test.ts: 15 cases (OpenClaw parity, Hermes fail-fast, frozen 8-name contract, ALIENCLAW_HOST selection) — all pass.
- Conformance: ts-fixture-runner (genome/brains) + martian-fixture-runner + comm-graph ===7 → 175 passed.
- install-hermes.sh: bash -n clean; --dry-run inert (creates nothing), provisions from seed/agents-hermes/ when run.
- Deferred (next phase): real Hermes tool registration (tools/registry.py), provider wiring (hermes model), agents/ → host.llm(), full installer provisioning + hermes claw migrate, HEARTBEAT→cron.
