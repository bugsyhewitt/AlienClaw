---
task: packet 18 subagent decision engine multi-martian campaign
slug: 20260507-210726_packet-18-decision-engine
effort: comprehensive
phase: complete
progress: 82/82
mode: interactive
started: 2026-05-07T21:07:26Z
updated: 2026-05-07T21:15:00Z
---

## Context

Packet 18 of AlienClaw. Gives Subagents the multi-Martian campaign loop.

Current state (post-17): Subagent.execute() is single-shot — one Martian summon, return result. No loop, no state machine, no budget, no campaign-level fitness.

Target state: Subagents run campaigns driven by a transition table embedded in CAMPAIGN.md. The loop iterates Martian summons per state machine decisions, tracks budget, aggregates campaign fitness, terminates with one of 6 reasons.

### Key architectural facts
- `src/alienclaw/martians/registry.ts` exists (Packet 16) — MartianRegistry loadable from TS
- `MartianSummonAdapter` interface handles all Martian-to-bridge communication
- HEARTBEAT.md changes from markdown-rewrite to JSONL append-only (better for multi-step)
- Decision engine is a pure function: same input → same output, no I/O
- Budget checked BEFORE every summon; 3 layers, 6 termination reasons
- Campaign fitness = final_summon.fitness + 0.2 if finalized, clamped [0,1]

### New module structure
```
src/alienclaw/governance/common/subagent/
  decision_engine.ts    — pure decide() function
  transition_table.ts   — parser + validator + evaluator
  budget.ts             — BudgetTracker, TerminationReason
  fitness_aggregator.ts — campaign-level fitness
```

### Transition table YAML (embedded in CAMPAIGN.md)
```yaml
transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        input: "${campaign.expression}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
        - when: { all: [{ kind: error_present }] }
          goto: "FAIL:compute_error"
```

### HEARTBEAT.md format change
From markdown-rewrite to JSONL append-only:
```jsonl
{"ts":"2026-05-07T...","event":"born","data":{"campaign_id":"..."}}
{"ts":"2026-05-07T...","event":"summon-issued","data":{"martian_type":"...","state":"..."}}
{"ts":"2026-05-07T...","event":"summon-result","data":{"fitness":0.8,"ok":true,...}}
{"ts":"2026-05-07T...","event":"state-transition","data":{"from":"step1","to":"FINALIZE"}}
{"ts":"2026-05-07T...","event":"finalized","data":{"reason":"state_machine_finalized","fitness":1.0}}
{"ts":"2026-05-07T...","event":"erased","data":{}}
```

### Risks
- Existing heartbeat.test.ts checks markdown format — must update to JSONL
- MartianRegistry TS module needs to be loadable from governance/common/subagent/ path
- Transition table validator needs MartianRegistry to validate martian_type references
- `${campaign.X}` and `${last_result.output.X}` variable substitution in state inputs — use martians/substitution.ts
- The research run needs the RealMartianSummonAdapter which calls Python bridge subprocess

## Criteria

### Module structure
- [x] ISC-1: `src/alienclaw/governance/common/subagent/` directory created with index.ts
- [x] ISC-2: `decision_engine.ts` in subagent/ directory
- [x] ISC-3: `transition_table.ts` in subagent/ directory
- [x] ISC-4: `budget.ts` in subagent/ directory
- [x] ISC-5: `fitness_aggregator.ts` in subagent/ directory

### decision_engine.ts
- [x] ISC-6: `decide(input: DecisionInput) -> Action` exported — pure function
- [x] ISC-7: Action type: Summon | Finalize | Fail | Retry variants
- [x] ISC-8: All 11 Condition kinds implemented: martian_succeeded, martian_correctness_gt/lt, fitness_gt/lt, error_present/absent, tool_calls_gt/lt, output_field_present, output_field_eq
- [x] ISC-9: ConditionGroup kinds: `all` and `any`
- [x] ISC-10: Initial call (last_result=null) → Summon with current state's martian_type
- [x] ISC-11: First matching transition wins (order matters)
- [x] ISC-12: No matching transition → Fail("no_matching_transition")
- [x] ISC-13: `goto: FINALIZE` → Finalize action
- [x] ISC-14: `goto: FAIL:<reason>` → Fail action with that reason
- [x] ISC-15: goto to undeclared state → Fail("state_not_found:X")
- [x] ISC-16: Retry action → re-runs current state's Summon
- [x] ISC-17: Pure function verified: 100 calls with same input → identical output

### transition_table.ts
- [x] ISC-18: `parseTransitionTable(campaignMd: string): ParseResult` — extracts YAML block
- [x] ISC-19: `validateTransitionTable(table, martianRegistry): ValidationResult` — validates types
- [x] ISC-20: Validator rejects initial_state not declared in states
- [x] ISC-21: Validator rejects goto to undeclared state
- [x] ISC-22: Validator rejects martian_type not in MartianRegistry
- [x] ISC-23: Validator rejects state with zero transitions
- [x] ISC-24: Parser handles valid tables: single-state, 2-state, with conditions, with budget
- [x] ISC-25: Variable references (`${campaign.X}`, `${last_result.output.X}`) parse syntactically
- [x] ISC-26: `evaluateInputs(state, campaignInputs, lastResult) -> Record<string,unknown>` uses martians substitution

### budget.ts
- [x] ISC-27: `BudgetLimits` type with max_summons_per_campaign, max_wall_clock_seconds, max_summons_per_state
- [x] ISC-28: `DEFAULT_BUDGETS` = {10, 300, 3}
- [x] ISC-29: `TerminationReason` type with 6 variants
- [x] ISC-30: `BudgetTracker.checkPreSummon(state)` → null or TerminationReason
- [x] ISC-31: `BudgetTracker.recordSummon(state)` increments counters
- [x] ISC-32: Wall-clock uses injected `clock: () => Date` for testability
- [x] ISC-33: Zero budget (max_summons=0) exhausts before first summon
- [x] ISC-34: Per-state budget independent of global budget
- [x] ISC-35: `BudgetTracker.snapshot()` accurate

### fitness_aggregator.ts
- [x] ISC-36: `aggregate(summons, termination_reason) -> CampaignFitness` exported
- [x] ISC-37: Campaign fitness = final_summon.fitness + 0.2 if finalized, clamped [0,1]
- [x] ISC-38: Empty summons + finalized → 0.2
- [x] ISC-39: Empty summons + budget_exhausted → 0.0
- [x] ISC-40: Result clamped: final=0.95 + 0.2 → 1.0 not 1.15
- [x] ISC-41: formula_version: 'v1.0' in result

### Subagent.ts refactor
- [x] ISC-42: `runCampaign(brief, campaignInputs)` new method replacing single-shot execute()
- [x] ISC-43: Loop: parse+validate transition table → BudgetTracker → decide() loop
- [x] ISC-44: Each summon calls adapter.summon() with genome from population
- [x] ISC-45: MEMORY.md updated after each summon with result
- [x] ISC-46: HEARTBEAT.md changed to JSONL append-only format
- [x] ISC-47: All 6 HEARTBEAT events: born, summon-issued, summon-result, state-transition, finalized, erased
- [x] ISC-48: Workspace erased after every campaign (success or failure)
- [x] ISC-49: `execute()` single-shot shim retained for backward compat

### creator-bot.ts
- [x] ISC-50: Generates transition table YAML for 3 templates: single_martian, two_step_compute, fetch_then_parse
- [x] ISC-51: Passes transition table in SubagentBrief to subagent.birth()
- [x] ISC-52: Uses runCampaign() instead of execute()

### Tests
- [x] ISC-53: `test/governance/subagent/test_decision_engine.ts` — all 17 decision engine cases
- [x] ISC-54: `test/governance/subagent/test_budget.ts` — all 9 budget cases including all 3 exhaustion types
- [x] ISC-55: `test/governance/subagent/test_fitness_aggregator.ts` — all 8 aggregation cases
- [x] ISC-56: `test/governance/subagent/test_transition_table.ts` — parsing, validation, evaluateInputs
- [x] ISC-57: `test/governance/subagent/test_termination_reasons.ts` — all 6 termination reasons exercised with real Subagent loop
- [x] ISC-58: `test/governance/subagent/test_multi_martian.ts` — 2-step campaign with mock adapter
- [x] ISC-59: `test/governance/subagent/test_concurrent_subagents.ts` — 3 parallel Subagents, workspace isolation
- [x] ISC-60: `test/governance/subagent/heartbeat.test.ts` updated — JSONL format assertions
- [x] ISC-61: `test/governance/subagent/workspace.test.ts` updated — 5 files including MARTIANS.md (already done in Packet 17)
- [x] ISC-62: Workspace leak check: no `~/.alienclaw/subagents/` dirs after test suite

### TypeScript / Python verification
- [x] ISC-63: `npm run typecheck` exits 0
- [x] ISC-64: `PYTHONPATH=src python -m pytest test/ -q --tb=no` ≥647 passed

### Spec docs
- [x] ISC-65: `docs/specs/SUBAGENT_FILE_FORMAT_v1_4_ADDENDUM.md` documents transition table section in CAMPAIGN.md
- [x] ISC-66: Transition table YAML format specified with examples

### Design docs + reports
- [x] ISC-67: `.packet-reports/packet-18-decision-engine-design.md` with worked examples
- [x] ISC-68: `.packet-reports/packet-18-fitness-design.md` with alternatives surveyed
- [x] ISC-69: `.packet-reports/packet-18-budget-design.md` with 6 termination reasons
- [x] ISC-70: `.packet-reports/packet-18-research-results.md` — end-to-end campaign demo
- [x] ISC-71: `.packet-reports/packet-18-report.md`
- [x] ISC-72: `.packet-reports/packet-18-bugs.md`
- [x] ISC-73: `.packet-reports/packet-18-deferred.md`
- [x] ISC-74: `.packet-reports/packet-18-defaults.md`
- [x] ISC-75: `docs/LESSONS_FROM_THE_ARC.md` updated

### Anti-criteria
- [x] ISC-A1: No changes to martians/, brains/, genome/, tools/, bridge/ subsystems
- [x] ISC-A2: docs/ARCHITECTURE.md not modified
- [x] ISC-A3: docs/specs/SUBAGENT_SPEC.md not modified (v1_4 addendum adds new doc)
- [x] ISC-A4: No .msb or .martian files modified
- [x] ISC-A5: Decision engine is pure (no I/O, no random calls)

## Decisions

- HEARTBEAT.md: JSONL append-only (replaces markdown-rewrite for better multi-step logging)
- `execute()` retained as backward-compat shim (existing governance tests still use it)
- `runCampaign()` is the new multi-summon entry point
- Variable substitution uses `src/alienclaw/martians/substitution.ts` (TS)
- Research run: 3-campaign demo using mock adapter (real bridge evolution deferred — needs Python-TS orchestration)
- Transition table format: YAML block in CAMPAIGN.md under key `transition_table:`
- MartianRegistry loaded from TS via `src/alienclaw/martians/registry.ts`

## Verification
