---
spec: SUMMON_BRIDGE_SPEC_v1_1_ADDENDUM
version: "1.1-addendum"
status: locked
last-updated: 2026-05-06
base-spec: SUMMON_BRIDGE_SPEC.md (v1.0, locked)
---

# Summon Bridge Spec — v1.1 Addendum

## Purpose

This addendum documents the `summon-from-population` request kind added in
Packet 8. It is a backwards-compatible addition to SUMMON_BRIDGE_SPEC v1.0.

The original `summon` request kind (v1.0) is unchanged and continues to work.
Servers that receive a `summon-from-population` request and do not recognize
it MUST return a `MALFORMED_REQUEST` error (existing behavior for unknown kinds).

---

## New request kind: `summon-from-population`

When a TypeScript Specialist sets `fromPopulation: true`, the
`RealMartianSummonAdapter` sends `kind="summon-from-population"` in the bridge
request envelope. The `genome` field is OMITTED — the Python bridge selects
one via tournament selection from the local population.

### Request envelope

```json
{
  "bridge_version": "1.0",
  "request_id": "<UUID v4>",
  "request": {
    "kind": "summon-from-population",
    "martian_type": "<canonical tool name>",
    "inputs": { "<arbitrary structured inputs>" },
    "timeout_ms": 60000
  }
}
```

Note: `genome` is NOT present when `kind="summon-from-population"`.

### Field constraints

| Field | Type | Constraint |
| --- | --- | --- |
| `request.kind` | string | MUST be `"summon-from-population"` |
| `request.martian_type` | string | MUST match a registered brain name |
| `request.inputs` | object | MAY be empty `{}` |
| `request.timeout_ms` | integer | MUST be in `[1, 600000]` |

### Server behavior

When the server receives `kind="summon-from-population"`:

1. Load the population for `martian_type` from `~/.alienclaw/populations/`
2. If no population exists, create one with default `EvolutionConfig`
3. Select a genome via tournament selection (`tournament_k=3` default)
4. Run the Martian with the selected genome and `inputs`
5. Feed the resulting fitness back into the population via `population.add()`
6. Return the success/error response, with `genome_used` added to the response

### Response envelope — success

Same as v1.0 success, with one additional field:

```json
{
  "bridge_version": "1.0",
  "request_id": "<echoed>",
  "response": {
    "ok": true,
    "output": { "<structured per martian_type>" },
    "genome_used": "<256-char Base62 genome that was selected>",
    "fitness": 0.75,
    "run_metadata": { ... }
  }
}
```

### Response envelope — error

Same as v1.0 error, with `genome_used` in `details` if available:

```json
{
  "bridge_version": "1.0",
  "request_id": "<echoed>",
  "response": {
    "ok": false,
    "error": {
      "code": "TOOL_RUNNER_FAILED",
      "message": "...",
      "details": { "genome_used": "<genome that was selected>", "output_partial": null }
    },
    "fitness": 0.0,
    "run_metadata": { "tool_calls": 0, "wall_clock_ms": 1 }
  }
}
```

---

## Why a separate request kind (not a flag)

The `genome` field is required for v1.0 `summon` requests and must be a valid
256-char Base62 string. Making it optional would break v1.0 validation. A
separate kind keeps validation clean: `summon` always requires `genome`,
`summon-from-population` never includes it.

---

## Population API stability guarantee

The population layer's public API is stable for Packet 10 (leaderboard sync):
- `Population.sample(rng)` → `PopulationEntry`
- `Population.add(genome, fitness, generation, parent_ids, run_metadata)` → `PopulationEntry`
- `Population.top(n)` → `list[PopulationEntry]`
- `Population.snapshot()` → `dict`

Packet 10's leaderboard sync calls `Population.top(n)` to get genomes to upload
and calls `Population.add()` to merge downloaded high-fitness genomes from the
network. Neither depends on bridge internals.

---

## What is NOT in this addendum

- Streaming fitness reports (still deferred)
- Batch genome evaluation (one call per genome; batch deferred)
- Population version negotiation (not needed for v1.0 local-only storage)
- Cross-operator genome transfer protocol (Packet 10)
