# P14-02 Inventory

**Packet:** P14-02 Evolve the Graph (Subagent Layer + Topology)
**Branch:** packet/02-evolve-the-graph
**Base:** packet/01-reflective-fitness (Packet 01 not yet merged to main)

## §3 Current State — Reconciled Against Repo

- **Governance (TOP):** BossBot, AdvisorBot, CreatorBot — confirmed in `src/alienclaw/agents/`.
  All three have no genome. CreatorBot has `spawnSubagent()` as the static construction path.
- **Subagents (MIDDLE):** Confirmed via `src/alienclaw/governance/common/subagent.ts` and
  `src/alienclaw/agents/creatorbot.ts#spawnSubagent`. Called "Subagents" per AGENTS.md wall.
  No genome at this layer prior to this packet.
- **Martians (BOTTOM):** Confirmed in `src/alienclaw/governance/` — ephemeral, 256-char Base62,
  zero LLM. Unchanged by this packet.
- **Communication graph:** Enforced at runtime in `src/alienclaw/wiring/hierarchy-bootstrap.ts`
  and `src/alienclaw/comms/agent-channel.ts`. Hard invariant, confirmed.
- **Storage:** MySQL. Two existing migrations: 001_leaderboard.sql, 002_reflective_evolution.sql.
- **Packet 01 engine:** Present at `src/alienclaw/evolution/reflective/`. Importable.

## Naming Note

The packet document uses "Specialist" throughout. AGENTS.md wall explicitly forbids this term —
canonical term is "Subagent". All implementation uses "Subagent*" naming:
- `SubagentGenome` (not SpecialistGenome)
- `SubagentAdapter` (not SpecialistAdapter)
- `re_subagent_genome` (not re_specialist_genome)
- `re_topology_subagent` (not re_topology_specialist)

## §4 Target State — Implementation Location

- `src/alienclaw/evolution/graph/` — new module
- `migrations/003_graph_evolution.sql` — 4 tables + artifact_kind columns
- `test/evolution/graph/` — adversarial suite + e2e tests

## Decisions Made

- Branched from `packet/01-reflective-fitness` (P01 not yet merged to main)
- All "Specialist" → "Subagent" per AGENTS.md wall
- Engine validate hook is generic (in reflective/engine.ts EngineConfig)
- SubagentAdapter and TopologyAdapter are stubs — real Martian runtime integration is a
  separate concern; stubs are sufficient for the test suite to be meaningful
- Shadow report uses mock data (no real LLM budget burned for shadow run)
- The graph barrel (`index.ts`) re-exports `assembly.isValidPartition` as `isValidPartitionLite`
  and `assembly.ExecutionTrace` as `AssemblyExecutionTrace` to resolve name collisions with
  `graph-validator.isValidPartition` and `types.ExecutionTrace`. Tests import from the concrete
  modules, so this aliasing affects only the barrel surface.
