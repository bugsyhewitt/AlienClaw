# Governance Engine — AlienClaw Agent Layer

This is the core governance engine for AlienClaw — the state-machine agent layer that manages campaigns, Martian execution, and the fitness-driven genome registry.

## Overview

The governance engine implements the six AlienClaw rules through a state-machine loop (`GovernanceLoop`) that coordinates BossBot, AdvisorBot, and CreatorBot, and manages the Martian execution registry.

## Key Components

| File | Purpose |
|------|---------|
| `governance/governance-loop.ts` | State machine + campaign dispatch |
| `governance/completion-handler.ts` | AdvisorBot review + user signoff |
| `governance/escalation-handler.ts` | Strike ladder and failure escalation |
| `governance/goal-manager.ts` | Atomic goals.json persistence |
| `registry/martian-registry.ts` | Async Martian registry bootstrap |
| `registry/registry.ts` | Sync singleton registry (hot path) |
| `registry/ms-loader.ts` | .ms genome file parser |
| `registry/genome-codec.ts` | Base62 parse/validate/assemble, FNV checksum |
| `msb/martian-executor.ts` | Martian execution engine |
| `msb/msb-loader.ts` | .msb parser + per-process cache |
| `agents/bossbot.ts` | Executive — drafts schemes |
| `agents/advisorbot.ts` | Strategist — advisory per task |
| `agents/creatorbot.ts` | Builder — writes Martian .ms files |

## Architecture

The governance engine is the shipping agent layer of AlienClaw. It is not a plugin or extension — it is invoked by OpenClaw agents through their `AGENTS.md` routing configuration.

## See Also

- `alienclaw-HANDOFF-v0.9.md` at the repo root for the original design doc.
