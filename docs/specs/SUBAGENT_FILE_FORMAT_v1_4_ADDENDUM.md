---
spec: SUBAGENT_FILE_FORMAT_v1_4_ADDENDUM
version: "1.4"
status: implementation-notes
supersedes: SUBAGENT_FILE_FORMAT_v1_3_ADDENDUM
implements: multi-Martian campaign loop (Packet 18)
last-updated: 2026-05-07
---

# Subagent File Format Addendum v1.4

Adds multi-Martian campaign loop machinery. Supersedes v1.3.

---

## CAMPAIGN.md — transition table section (new in v1.4)

CAMPAIGN.md now includes a `transition_table:` YAML section:

```yaml
transition_table:
  initial_state: <state_name>
  states:
    <state_name>:
      martian_type: <martian_type_from_registry>
      inputs:
        <key>: "<value_or_template>"
      transitions:
        - when: { all: [{ kind: <condition_kind>, [n: <number>], [field: <string>] }] }
          goto: <state_name | FINALIZE | FAIL:<reason>>
```

### Input templates

- `${campaign.X}` — top-level campaign input field X
- `${last_result.output.X}` — output field X from the previous Martian summon

### Condition kinds

| Kind | Description |
|---|---|
| martian_succeeded | No error AND fitness > 0 |
| martian_correctness_gt(n) | correctness > n |
| martian_correctness_lt(n) | correctness < n |
| fitness_gt(n) | fitness > n |
| fitness_lt(n) | fitness < n |
| error_present | error is not null |
| error_absent | error is null |
| tool_calls_gt(n) | tool_calls > n |
| tool_calls_lt(n) | tool_calls < n |
| output_field_present(field) | output has field |
| output_field_eq(field, value) | output[field] == value |

### Transition evaluation

- Transitions evaluated in declared order; first match wins
- `FINALIZE` → campaign ends with completion bonus (+0.2)
- `FAIL:<reason>` → campaign ends with no bonus
- `goto: <same_state>` → Retry (counts toward per-state budget)

---

## HEARTBEAT.md — JSONL format (changed in v1.4)

HEARTBEAT.md is now append-only JSONL (changed from markdown rewrite in v1.3).
Each line: `{"ts":"<ISO>","event":"<name>","data":{...}}`

Events: born, summon-issued, summon-result, state-transition, budget-exhausted, finalized, heartbeat, erased.

---

## Budget overrides in SubagentBrief

```typescript
budgetOverrides?: {
  max_summons_per_campaign?: number;
  max_wall_clock_seconds?: number;
  max_summons_per_state?: number;
}
```

Defaults: {10, 300, 3}. Negative or zero values not allowed.

---

## Campaign fitness formula (v1.0)

`fitness = clip(final_summon.fitness + 0.2 if finalized, 0, 1)`
