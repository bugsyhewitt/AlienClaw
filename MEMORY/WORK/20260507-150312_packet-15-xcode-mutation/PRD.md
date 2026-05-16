---
task: packet 15 xcode encoding step-based directional mutation
slug: 20260507-150312_packet-15-xcode-mutation
effort: comprehensive
phase: complete
progress: 77/77
mode: interactive
started: 2026-05-07T15:03:12Z
updated: 2026-05-07T15:10:00Z
---

## Context

Packet 15 of AlienClaw. Replaces the random-walk byte-level mutation operator
with step-based directional Xcode-level mutation per ARCHITECTURE.md §3 and §5.

Two coupled changes:
1. **Xcode helpers**: The genome is interpreted at the Xcode level (2 Base62 chars
   = one parameter value in [0, 3843], mapped to a parameter's natural range).
2. **Step-based directional mutation**: Mutations operate on Xcodes, not bytes.
   Step magnitudes ±1..±4 (60/25/10/5%). Direction bias (70/30) from `direction`
   field declared in PARAMETER_SCHEMA entries.

Plus the .msb files: all 8 need new PARAMETER_SCHEMA format with `direction` field.
The parser rejects entries without `direction` — no silent defaults.

Pre-15 audit baseline (seed=42): compute=OK(0.75), file_read=OK(0.75),
http_get=OK(0.65), extract_json=WEAK(0.25), file_write=WEAK(0.55),
search_text=WEAK(0.60), url_fetch=WEAK(0.50), web_search=WEAK(0.55).

### Genome addressing for Packet 15
- Slot 1 = EXECUTION section (genome chars 64-127)
- Slot 2 = BEHAVIOR section (genome chars 128-191)
- For Packet 15 convention: all tool parameters are in slot 1 (EXECUTION)
- decode_xcode(genome, slot_index, xcode_index) = genome[slot_index*64 + 1 + xcode_index*2 : same+2]
- Slot 1, xcode 0 → genome[65:67]; xcode 1 → genome[67:69]; etc.

### New PARAMETER_SCHEMA pipe-delimited format (7 fields)
`name|xcode_index|range_min|range_max|default|direction|description`
- xcode_index: int 0..30, within slot 1 (EXECUTION section)
- range_min, range_max: natural value range for the parameter
- default: value used when slot empty or decode fails
- direction: "lower" | "higher" | "none" — required, no defaults
- description: human-readable description of the parameter

### Risks
- Old PARAMETER_SCHEMA pipe-delimited format: `name|section|byte_offset|encoding|type|default`
  Changes break brain-registry-fixtures.json → fixtures must be updated
- evolution/generation.py calls mutate(genome, rng, rate) — signature changes
- test_operators.py tests old mutation behavior (statistical rate, rate=1.0, etc.) — needs rewrite
- Cross-language parity: Python and TypeScript must produce identical Xcode values

## Criteria

### Xcode helpers — Python
- [x] ISC-1: `XCODE_MAX = 3843` constant in codec.py
- [x] ISC-2: `decode_xcode(genome, slot_index, xcode_index) -> int` in codec.py
- [x] ISC-3: decode_xcode addresses `slot_index*64 + 1 + xcode_index*2`
- [x] ISC-4: decode_xcode raises ValueError for slot_index outside 0..3
- [x] ISC-5: decode_xcode raises ValueError for xcode_index outside 0..30
- [x] ISC-6: `encode_xcode(value: int) -> str` produces 2-char Base62 string in codec.py
- [x] ISC-7: encode_xcode raises ValueError for value outside [0, XCODE_MAX]
- [x] ISC-8: `xcode_to_param_value(xcode_value, range_min, range_max) -> int` in codec.py
- [x] ISC-9: xcode_to_param_value: xcode=0 → range_min; xcode=3843 → range_max
- [x] ISC-10: xcode_to_param_value is monotonically non-decreasing over xcode_value
- [x] ISC-11: `param_value_to_xcode(param_value, range_min, range_max) -> int` in codec.py
- [x] ISC-12: encode_xcode(decode_xcode round-trip: encode(v) then decode → same v

### Xcode helpers — TypeScript mirror
- [x] ISC-13: XCODE_MAX, decode_xcode, encode_xcode, xcode_to_param_value, param_value_to_xcode exported from genome-codec.ts
- [x] ISC-14: TS decode_xcode uses identical formula: slot_index*64 + 1 + xcode_index*2
- [x] ISC-15: Cross-language fixture: ≥30 new cases in genome-spec-fixtures.json, Python+TS identical

### Brain types — Python
- [x] ISC-16: ParameterSchemaField in types.py has fields: name, description, xcode_index, range_min, range_max, default, direction
- [x] ISC-17: ParameterSchemaField old fields removed: section, byte_offset, encoding, type

### Brain types — TypeScript
- [x] ISC-18: ParameterSchemaField in msb-types.ts has: name, description, xcode_index, rangMin, rangeMax, default, direction

### Parser — Python
- [x] ISC-19: parser.py parses new 7-field pipe format: `name|xcode_index|range_min|range_max|default|direction|description`
- [x] ISC-20: parser.py rejects PARAMETER_SCHEMA entry missing any of the 7 fields with BrainParseError naming param and file
- [x] ISC-21: parser.py rejects direction not in (lower, higher, none) with BrainParseError
- [x] ISC-22: parser.py silently skips blank lines and '#' comment lines in PARAMETER_SCHEMA

### Parser — TypeScript
- [x] ISC-23: msb-loader.ts parses new 7-field pipe format
- [x] ISC-24: msb-loader.ts rejects entries without valid direction

### Parser fixtures
- [x] ISC-25: brain-registry-fixtures.json: ≥10 new cases covering new format, direction validation, parse errors

### Decoder — Python
- [x] ISC-26: decoder.py decode_params uses decode_xcode(genome, 1, field.xcode_index) for each field
- [x] ISC-27: decoder.py maps Xcode value to parameter via xcode_to_param_value(xcode, range_min, range_max)
- [x] ISC-28: decoder.py falls back to field.default on any decode error (never raises)

### Mutation operator — Python
- [x] ISC-29: `mutate_directed(genome, slot_brains: list[BrainSpec|None], rng) -> str` in operators.py
- [x] ISC-30: STEP_DISTRIBUTION = [(1,0.60),(2,0.25),(3,0.10),(4,0.05)] in operators.py
- [x] ISC-31: DIRECTION_BIAS_LOWER = 0.70, DIRECTION_BIAS_HIGHER = 0.30, DIRECTION_BIAS_NONE = 0.50
- [x] ISC-32: PER_XCODE_MUTATION_RATE = 2/256 in operators.py
- [x] ISC-33: Mutations operate in parameter natural-range space (step in param space, re-encode to Xcode)
- [x] ISC-34: Boundary clamping: result always stays within [field.range_min, field.range_max]
- [x] ISC-35: Mutated slot's checksum (byte 63 of slot) is recomputed after Xcode changes
- [x] ISC-36: Mutated genome passes full validation (checksum at genome[192:])
- [x] ISC-37: ID-tag chars 0-7 never mutated
- [x] ISC-38: Empty slot (brain=None): no mutations in that slot
- [x] ISC-39: `mutate(genome, rng, rate)` backward-compat wrapper retained in operators.py
- [x] ISC-40: Empirical step distribution: 10000 samples, ±1≈60%, ±2≈25%, ±3≈10%, ±4≈5% (±2% tolerance each)
- [x] ISC-41: Empirical direction=lower bias: 10000 samples, ~70% negative (±2%)
- [x] ISC-42: Empirical direction=higher bias: 10000 samples, ~70% positive (±2%)
- [x] ISC-43: Boundary test lower: current=range_min, direction=lower → all mutations ≥ range_min
- [x] ISC-44: Boundary test upper: current=range_max, direction=higher → all mutations ≤ range_max
- [x] ISC-45: Per-Xcode isolation: mutating one field leaves other fields' Xcodes unchanged
- [x] ISC-46: Determinism: same genome + same slot_brains + same seed → identical output

### Mutation operator — TypeScript mirror
- [x] ISC-47: genome-operators.ts (new file) exports mutateDirected with identical behavior
- [x] ISC-48: Cross-language mutation fixture: N cases, Python+TS identical outputs

### Evolution integration
- [x] ISC-49: EvolutionConfig gets optional `brain: BrainSpec | None = None` field
- [x] ISC-50: generation.py calls mutate_directed(genome, [None, config.brain, None, None], rng) when config.brain set
- [x] ISC-51: generation.py falls back to mutate(genome, rng, rate) when config.brain is None

### .msb file updates — all 8
- [x] ISC-52: compute.msb: new PARAMETER_SCHEMA format, direction on all ≥4 parameters
- [x] ISC-53: extract_json.msb: new format, direction on all parameters
- [x] ISC-54: file_read.msb: new format, direction on all parameters
- [x] ISC-55: file_write.msb: new format, direction on all parameters
- [x] ISC-56: http_get.msb: new format, direction on all parameters
- [x] ISC-57: search_text.msb: new format, direction on all parameters
- [x] ISC-58: url_fetch.msb: new format, direction on all parameters
- [x] ISC-59: web_search.msb: new format, direction on all parameters
- [x] ISC-60: All 8 brains loadable via Python BrainRegistry.load("seed/msb/")
- [x] ISC-61: packet-15-msb-changes.md: before/after for all 8 files with direction reasoning

### Test coverage
- [x] ISC-62: test_xcode_helpers.py (new): ≥15 cases for Xcode encoder/decoder round-trips
- [x] ISC-63: test_step_mutation.py (new): empirical distribution, direction bias, boundary, isolation, determinism
- [x] ISC-64: test_operators.py updated: old rate-based tests adapted for new interface
- [x] ISC-65: test_brains_parser.py (or test_parser.py): new format + direction rejection tests

### Verification
- [x] ISC-66: PYTHONPATH=src python -m pytest test/ -q --tb=no exits 0 (≥466 passed)
- [x] ISC-67: npm run typecheck exits 0

### Audit + evolution comparison
- [x] ISC-68: post-15 audit runs with seed=42; packet-15-audit-comparison.md written
- [x] ISC-69: evolution comparison on compute (10+ gens); packet-15-evolution-comparison.md written
- [x] ISC-70: Honest assessment of whether new operator helped, hurt, or was neutral

### Reports + docs
- [x] ISC-71: docs/LESSONS_FROM_THE_ARC.md updated with Packet 15 section
- [x] ISC-72: .packet-reports/packet-15-report.md
- [x] ISC-73: .packet-reports/packet-15-bugs.md
- [x] ISC-74: .packet-reports/packet-15-deferred.md
- [x] ISC-75: .packet-reports/packet-15-defaults.md

### Anti-criteria
- [x] ISC-A1: Fitness formula unchanged (correctness × 1/tool_calls)
- [x] ISC-A2: Bridge wire format unchanged (martian_type, genome, inputs fields)
- [x] ISC-A3: docs/specs/ not modified
- [x] ISC-A4: docs/ARCHITECTURE.md not modified
- [x] ISC-A5: Step distribution (60/25/10/5) not tuned beyond spec
- [x] ISC-A6: Direction bias (70/30) not tuned beyond spec

## Decisions

- PARAMETER_SCHEMA pipe format: `name|xcode_index|range_min|range_max|default|direction|description`
- All tool parameters in slot 1 (EXECUTION section) for Packet 15 — no section field needed
- decode_xcode uses slot_index*64 + 1 + xcode_index*2 addressing
- Backward-compat: mutate(genome, rng, rate) retained; new mutate_directed(genome, slot_brains, rng) added
- Pre-15 baseline: 3 OK, 5 WEAK (seed=42, PAIRS_PER_RUNNER=20)
- Evolution comparison uses compute Martian with input {"input": "2 + 2"} — always returns fitness=1.0

## Verification
