# Packet 01 — Repo Inventory (P14-01 Phase 0)

Conducted before any code changes. Reconciles §3/§4 of the packet against the actual repo.

## Repo location
`~/dev/alienclaw/` on Alfred (WSL2). GitHub: `github.com/bugsyhewitt/AlienClaw`.

## Key paths (actual vs expected)

| Expected (§3/§4) | Actual | Notes |
|---|---|---|
| Evolution loop | `src/alienclaw/governance/common/creator-bot.ts` (TS) + `src/alienclaw/evolution/` (Python) | Hybrid: Python handles population/selection; TS handles governance/Subagent dispatch |
| Genome type | `src/alienclaw/registry/genome-codec.ts` (TS), `src/alienclaw/genome/` (Python) | 256-char Base62, 4 sections × 64 chars |
| Fitness function | **`src/alienclaw/fitness/function.py`** — formula `correctness × 1/(1+0.1×max(0,tool_calls−slot_count))` | This is the target for §7 hardening |
| Correctness source | `src/alienclaw/governance/common/subagent.ts:571` — `run_metadata?.correctness ?? 1.0` | Correctness is caller-injected via run_metadata; defaults to 1.0 if ok |
| MySQL access layer | `src/alienclaw/api/storage.ts` (community API) | `mysql2/promise` via `ALIENCLAW_DB_URL`. Connection pool. |
| Migration tool | Raw SQL in `migrations/` dir. CI applies via `mysql` CLI. | No ORM migration tool. |
| Test runner | `npx vitest run` (TS) + `PYTHONPATH=src pytest` (Python) | pnpm not installed system-wide; `~/.local/bin/pnpm` works |
| Feature flags | **None existed.** | Created `REFLECTIVE_EVOLUTION` env var: off/shadow/on |
| Evolution namespace (TS) | `src/alienclaw/evolution/` — **Python only, no TS** | Created `src/alienclaw/evolution/reflective/` (new TS module) |

## Fitness formula — located ✅

`src/alienclaw/fitness/function.py`:
```python
def evaluate(inputs: FitnessInputs) -> FitnessResult:
    correctness = max(0.0, min(1.0, inputs.correctness))
    excess = max(0, inputs.tool_calls - inputs.slot_count)
    efficiency = 1.0 / (1.0 + _ALPHA * excess)
    fitness = correctness * efficiency
```

`correctness` is NOT computed in the Martian executor. It is:
- Passed via `run_metadata.correctness` from the caller (Subagent/Martian evaluation harness)
- Defaults to `1.0` if `ok=true` and correctness not explicitly provided (see `subagent.ts:572`)
- This is the single most important thing for §7: the "correctness" entering the engine can default to 1.0 for any successful tool call, which is gameable.

## Evolution storage (existing)

The Python evolution layer uses **filesystem storage** (`~/.alienclaw/populations/`), not MySQL. Population entries are stored as JSON files in a `entries/` subdirectory, not in the MySQL DB. The MySQL DB is only used for the community leaderboard API.

The reflective evolution engine introduces its own MySQL tables (`re_*`) as specified in §6.7.

## Architecture — actual vs packet assumptions

- **Three layers confirmed:** BossBot → Subagents → Martians. AGENTS.md is authoritative.
- **Martians**: zero LLM, confirmed in `martian-executor.ts` (no LLM calls in execution path)
- **"Specialist" → "Subagent"**: renamed. The packet uses "Specialist" in §3 (legacy term); actual code uses "Subagent".
- **Correctness source audit**: the correctness term defaults to 1.0 on success, making it trivially gameable. §7 (confidence penalty, held-out valset, oracle priority chain) is essential.

## Feature flag (new)

`REFLECTIVE_EVOLUTION` env var. Created at `src/alienclaw/evolution/reflective/feature-flag.ts`.
- `off` (default): byte-identical to current behavior, nothing written to new tables
- `shadow`: both loops run, reflective loop persists but does not promote
- `on`: reflective loop drives promotion

## MySQL schema collision check

New `re_*` tables do not collide with existing `leaderboard_entries` or `installs` tables. Safe to apply before enabling the flag.

## Module location

`src/alienclaw/evolution/reflective/` — new TypeScript module. Does not conflict with existing `src/alienclaw/evolution/` Python module (different namespace, different language).

## Escalation assessment

No Phase 0 escalation needed:
- Correctness computation LOCATED ✅ — `src/alienclaw/fitness/function.py`
- MySQL tables are AlienClaw-only ✅ — no shared infra collision
- No locked decision violations ✅

## Test baseline (pre-packet)

- TypeScript: 436 passed, 34 skipped (MySQL, no local DB URL)
- Python (all suites): 625 passed
