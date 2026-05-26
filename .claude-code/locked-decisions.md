# Locked Architectural Decisions

These are settled. Do not relitigate without explicit Bugsy approval.

## Hierarchy
Council (BossBot + AdvisorBot) → CreatorBot → Subagents (deterministic, no genome) → Martians (4-tool compositions, 256-char genome, 4 slots × 64 chars).

## Fitness formula
`correctness × 1 / (1 + 0.1 × max(0, tool_calls - slot_count))` — α=0.1 hardcoded. Locked Packet 28.

## Selection & evolution
Tournament selection on scalar fitness. Per-Martian-type populations N=100. Step-based directional mutation, per-Xcode rate 0.0078, direction bias 70/30.

## Trust model (leaderboard)
Pull-only. Inert data. File-mediated submission. Names `^[A-Z]{8}$`. Hardened fetch. All five enforced in code.

## API storage
MySQL-only server-side. No fallback. Fail-fast on missing/unreachable DB. Operator install is database-free (files only). Locked Packet 31.6 design.

## Submission verification
Trust-the-number for v1. Server-side re-verification deferred.

## Subagent genome layer
Far-future. Current Subagents are deterministic. Not near-term.

## Location
Working tree at `~/dev/alienclaw/`. NOT under V3X. Brand wall absolute.
