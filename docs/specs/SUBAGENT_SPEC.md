# Subagent Spec

**Status:** Canonical (post-Packet-17). Supersedes `SPECIALIST_SPEC.md`.
**Version:** 2.0

## Purpose

A Subagent is an ephemeral, campaign-scoped orchestrator. CreatorBot spawns one Subagent per campaign role. The Subagent's job is to summon Martians and accumulate results until the campaign succeeds or budget is exhausted.

Subagents do NOT call tools directly. They summon Martians (which internally compose tools). The Martian layer handles tool-level execution; the Subagent layer handles Martian-level orchestration.

## Lifecycle

```
born → summonMartian() × N → finalize() → erase()
```

1. **Born**: CreatorBot calls `birth(brief)`. Creates 5-file workspace.
2. **Running**: Subagent summons Martians via `execute()` (or future multi-summon API).
3. **Finalized**: Subagent updates HEARTBEAT.md with final status.
4. **Erased**: Subagent deletes workspace directory entirely.

The workspace MUST be erased after every campaign, whether successful or failed. No workspace leaks.

## Workspace structure

Located at `~/.alienclaw/subagents/<campaign_id>/`.

Five files:

| File | Mutability | Purpose |
|------|------------|---------|
| `SOUL.md` | Immutable | Subagent's identity, rules, and allowed Martian types |
| `CAMPAIGN.md` | Immutable | Campaign objective, scope, success criteria |
| `MARTIANS.md` | Immutable | Authorised Martian types for this campaign |
| `MEMORY.md` | Append-only | Working notes and summon results, accumulates across Martian calls |
| `HEARTBEAT.md` | Rewritten on each update | Current status snapshot |

## Decision engine (deferred)

The Subagent's decision logic (which Martian to summon next, when to finalize, when to fail) is currently driven by simple single-shot execution in `Subagent.execute()`.

A state-machine decision engine with Martian-level transition tables is planned for Packet 18. The decision engine will operate at the Martian-type abstraction: states = Martian types, transitions = Martian execution outcomes.

## Budget enforcement

Max summons per campaign, max wall-clock time, and per-state retry limits are planned alongside the decision engine in Packet 18.

## Constraints (v1)

- Deterministic: no LLM backing in v1. Subagent behavior is fully deterministic given inputs.
- Single-shot: current implementation issues one Martian summon per campaign. Multi-summon campaigns land with the decision engine.
- Subagent's own genome: far future. Subagents do not yet have evolution-capable genomes.

## Deferred

- Decision engine with Martian-level transition tables (Packet 18)
- Budget enforcement at Martian-level granularity (Packet 18)
- Multi-Martian sequential campaigns (Packet 18)
- Subagent-level evolution (far future, 512-char genome per ROADMAP)
- Partial-Martian execution recovery (Packet 18)
