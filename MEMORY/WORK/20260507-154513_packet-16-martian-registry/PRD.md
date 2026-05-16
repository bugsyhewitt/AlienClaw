---
task: packet 16 martian first-class type registry 8 compositions
slug: 20260507-154513_packet-16-martian-registry
effort: comprehensive
phase: complete
progress: 91/91
mode: interactive
started: 2026-05-07T15:45:13Z
updated: 2026-05-07T15:55:00Z
---

## Context

Packet 16 of AlienClaw. Makes Martians real as first-class code objects.

Before: `martian_type` in bridge/API = tool name; each tool was treated
as a single-slot Martian. After: a `MartianSpec` is a composition of up
to 4 tools with explicit slot-to-slot input wiring.

### Key design decisions
- **Slot↔genome-section mapping**: Martian slot 0 → genome EXECUTION (section 1), Martian slot 1 → genome BEHAVIOR (section 2). At most 2 tools per composition in Packet 16 (only 2 mutable parameter sections available).
- **16 Martian types**: 8 single-slot (`compute_alone` etc.) + 8 real compositions. Registry also aliases bare tool names ("compute" → "compute_alone") for backward-compat.
- **Substitution**: `${slot[N].output.field}` and `${campaign.field}`. Top-level field access only. Non-string values auto-serialized to JSON string.
- **Aggregate correctness**: min across slots (weakest-link). Total tool_calls = sum across slots.
- **Slot failure**: Martian fails entirely; slots N+1..3 don't execute.
- **Wire protocol unchanged**: `martian_type`, `genome`, `inputs` fields unchanged.
- **decoder.py updated**: `decode_params(brain, genome, slot_index=1)` — default slot_index=1 (EXECUTION) for backward compat; bridge passes `slot_index = martian_slot_index + 1`.

### Tool output fields (for composition wiring)
- compute: `result`, `input`, `resultType`, `operation`, ...
- search_text: `pattern`, `match_count`, `matches`
- http_get: `url`, `status_code`, `body`, `body_length`, `content_type`, `body_preview`
- extract_json: `value`, `type`, `path`
- file_read: `content`, `lines_read`, `total_lines`, `path`
- file_write: `path`, `bytes_written`, `repeat_count`
- url_fetch: `url`, `status_code`, `content`, `content_length`, `content_type`, `content_preview`
- web_search: `query`, `results`, `result_count`, `pages_fetched`

### Pre-16 audit baseline (seed=42)
All 8 tools: OK. compute=1.00, file_read=1.00, url_fetch=1.00, http_get=0.95, search_text=0.95, file_write=0.80, web_search=0.85, extract_json=0.70.

### .martian YAML format
```yaml
martian_type: fetch_then_parse
description: "One-sentence description"
use_cases:
  - "Use case 1"
slots:
  - slot_index: 0
    tool_name: http_get
    inputs_from: null
  - slot_index: 1
    tool_name: extract_json
    inputs_from:
      fields:
        json: "${slot[0].output.body}"
        path: "${campaign.extract_path}"
```

### Risks
- PyYAML safe_load required (not full load — security)
- bridge fixture (test/fixtures/bridge-fixture.json) uses "compute" as martian_type — aliasing handles this
- decoder.py adding slot_index param must default to 1 (backward compat)
- Two slots max per Martian; validator rejects slot_index > 1

## Criteria

### martians/ Python module — types
- [ ] ISC-1: `src/alienclaw/martians/__init__.py` exists
- [ ] ISC-2: `TOOL_ID_TABLE: dict[str, int]` in types.py with all 8 tools assigned 1-8 alphabetically
- [ ] ISC-3: `EMPTY_SLOT_ID = 0` in types.py
- [ ] ISC-4: `InputWiring`, `SlotDeclaration`, `MartianSpec` dataclasses in types.py
- [ ] ISC-5: MartianSpec.slots is a list of SlotDeclaration

### martians/ Python module — substitution
- [ ] ISC-6: `src/alienclaw/martians/substitution.py` exists
- [ ] ISC-7: `substitute(template, slot_outputs, campaign_inputs)` is a pure function
- [ ] ISC-8: `${slot[N].output.field}` syntax resolved from slot_outputs[N][field]
- [ ] ISC-9: `${campaign.field}` syntax resolved from campaign_inputs[field]
- [ ] ISC-10: Non-string values auto-serialized to JSON string (json.dumps)
- [ ] ISC-11: Missing field raises ValueError naming the missing field
- [ ] ISC-12: Forward reference `${slot[2].output.field}` when only slot 0 outputs available → ValueError
- [ ] ISC-13: `test/fixtures/martian-substitution-fixtures.json` ≥20 cases

### martians/ Python module — parser
- [ ] ISC-14: `src/alienclaw/martians/parser.py` parses YAML .martian files with yaml.safe_load
- [ ] ISC-15: Parser produces MartianSpec from valid .martian YAML
- [ ] ISC-16: Parser raises MartianParseError on YAML syntax errors
- [ ] ISC-17: Parser raises MartianParseError on missing required fields (martian_type, slots)

### martians/ Python module — validator
- [ ] ISC-18: `src/alienclaw/martians/validator.py` validates MartianSpec against brain registry
- [ ] ISC-19: Validator rejects duplicate slot_index values
- [ ] ISC-20: Validator rejects non-contiguous slot_indices (gap between declared slots)
- [ ] ISC-21: Validator rejects slot_index > 1 (only 2 genome sections available)
- [ ] ISC-22: Validator rejects reference to tool not in brain registry
- [ ] ISC-23: Validator rejects `${slot[N].output.*}` where N >= current slot_index (forward reference)
- [ ] ISC-24: Validator returns ValidationResult with errors list; never raises
- [ ] ISC-25: Zero-slot Martian rejected

### martians/ Python module — registry
- [ ] ISC-26: `MartianRegistry.load(seed_martians_dir, brain_registry)` loads all 16 .martian files
- [ ] ISC-27: Registry hard-fails on any parse or validation error (no silent skip)
- [ ] ISC-28: Registry registers bare tool aliases ("compute" → compute_alone spec)
- [ ] ISC-29: `registry.get("compute_alone")` returns correct MartianSpec
- [ ] ISC-30: `registry.get("compute")` returns same spec as "compute_alone" (alias)
- [ ] ISC-31: `registry.all()` returns all 16 distinct Martian types (not duplicated by aliases)
- [ ] ISC-32: `registry.has("fetch_then_parse")` returns True after loading

### martians/ Python tests
- [ ] ISC-33: `test/martians/test_substitution.py`: every substitution form, every error path
- [ ] ISC-34: `test/martians/test_parser.py`: valid .martian parse, YAML errors, missing fields
- [ ] ISC-35: `test/martians/test_validator.py`: all validation error cases
- [ ] ISC-36: `test/martians/test_registry.py`: load, get, alias, hard-fail behavior
- [ ] ISC-37: `test/fixtures/martian-registry-fixtures.json` ≥20 cases

### TypeScript mirrors
- [ ] ISC-38: `src/alienclaw/martians/types.ts` mirrors Python types
- [ ] ISC-39: `src/alienclaw/martians/substitution.ts` mirrors Python substitution logic
- [ ] ISC-40: `src/alienclaw/martians/parser.ts` mirrors Python parser
- [ ] ISC-41: `src/alienclaw/martians/validator.ts` mirrors Python validator
- [ ] ISC-42: `src/alienclaw/martians/registry.ts` mirrors Python registry
- [ ] ISC-43: TS substitution fixture runner handles martian-substitution-fixtures.json cases
- [ ] ISC-44: npm run typecheck passes after TS mirror additions

### 16 .martian files
- [ ] ISC-45: `seed/martians/compute_alone.martian` — slot 0: compute
- [ ] ISC-46: `seed/martians/extract_json_alone.martian` — slot 0: extract_json
- [ ] ISC-47: `seed/martians/file_read_alone.martian` — slot 0: file_read
- [ ] ISC-48: `seed/martians/file_write_alone.martian` — slot 0: file_write
- [ ] ISC-49: `seed/martians/http_get_alone.martian` — slot 0: http_get
- [ ] ISC-50: `seed/martians/search_text_alone.martian` — slot 0: search_text
- [ ] ISC-51: `seed/martians/url_fetch_alone.martian` — slot 0: url_fetch
- [ ] ISC-52: `seed/martians/web_search_alone.martian` — slot 0: web_search
- [ ] ISC-53: `seed/martians/fetch_then_parse.martian` — http_get → extract_json
- [ ] ISC-54: `seed/martians/read_then_extract.martian` — file_read → extract_json
- [ ] ISC-55: `seed/martians/compute_then_validate.martian` — compute → extract_json
- [ ] ISC-56: `seed/martians/search_then_count.martian` — search_text → compute
- [ ] ISC-57: `seed/martians/fetch_then_extract.martian` — url_fetch → extract_json
- [ ] ISC-58: `seed/martians/write_then_verify.martian` — file_write → file_read
- [ ] ISC-59: `seed/martians/compute_then_write.martian` — compute → file_write
- [ ] ISC-60: `seed/martians/search_then_fetch.martian` — search_text → http_get
- [ ] ISC-61: All 16 .martian files load without error via MartianRegistry.load()

### decoder.py update
- [ ] ISC-62: `decode_params(brain, genome, slot_index=1)` signature updated
- [ ] ISC-63: All existing callers still work (default slot_index=1 is backward compat)
- [ ] ISC-64: decode_params with slot_index=2 reads from BEHAVIOR section (bytes 128-191)

### Bridge restructure
- [ ] ISC-65: bridge/server.py `handle()` loads MartianRegistry + BrainRegistry at startup
- [ ] ISC-66: Bridge maps Martian slot_index → genome section: genome_section = slot_index + 1
- [ ] ISC-67: Bridge walks slots in order, applies input wiring via substitution
- [ ] ISC-68: Bridge aggregates correctness = min(slot correctnesses); total_calls = sum(slot tool_calls)
- [ ] ISC-69: Slot failure → Martian fails entirely; fitness=0; error includes slot number
- [ ] ISC-70: Wire protocol unchanged: request fields (martian_type, genome, inputs, timeout_ms, kind)
- [ ] ISC-71: Single-slot Martian produces identical fitness to pre-16 single-tool summon
- [ ] ISC-72: `test/bridge/test_martian_dispatch.py` — multi-slot end-to-end test

### API, storage, diagnostics
- [ ] ISC-73: `api/validation.py` validates martian_type against MartianRegistry
- [ ] ISC-74: `evolution/storage.py` unchanged (already uses per-martian_type layout)
- [ ] ISC-75: Evolution migration script: `python3 -m alienclaw.evolution migrate-pre-packet-16` renames `<tool>` → `<tool>_alone` population dirs
- [ ] ISC-76: Migration is idempotent (run twice = same result)
- [ ] ISC-77: `diagnostics/sensitivity_audit.py` audits Martian types from registry (single-slot only for speed)

### Test suite
- [ ] ISC-78: `PYTHONPATH=src python -m pytest test/ -q --tb=no` exits 0, ≥559 passed
- [ ] ISC-79: `npm run typecheck` exits 0

### Audit + evolution validation
- [ ] ISC-80: post-16 audit (seed=42) for 8 single-slot Martians produces same numbers as pre-16
- [ ] ISC-81: post-16 audit run against all 8 single-slot Martian types (not the 8 compositions yet)
- [ ] ISC-82: Evolution run on `compute_alone` (10 gen, pop=8) → fitness improves from 0
- [ ] ISC-83: `packet-16-audit-comparison.md` written with honest pre/post comparison

### Reports
- [ ] ISC-84: `.packet-reports/packet-16-tool-id-table.md`
- [ ] ISC-85: `.packet-reports/packet-16-martian-designs.md` (all 16 Martians)
- [ ] ISC-86: `.packet-reports/packet-16-audit-comparison.md`
- [ ] ISC-87: `.packet-reports/packet-16-evolution-results.md`
- [ ] ISC-88: `.packet-reports/packet-16-report.md`
- [ ] ISC-89: `.packet-reports/packet-16-bugs.md`
- [ ] ISC-90: `.packet-reports/packet-16-deferred.md`
- [ ] ISC-91: `docs/LESSONS_FROM_THE_ARC.md` updated

### Anti-criteria
- [ ] ISC-A1: Fitness formula unchanged (correctness × 1/tool_calls)
- [ ] ISC-A2: Bridge wire format unchanged (same JSON fields)
- [ ] ISC-A3: No modifications to existing .msb files
- [ ] ISC-A4: No modifications to mutation operator
- [ ] ISC-A5: docs/ARCHITECTURE.md not modified

## Decisions

- Martian slot N → genome section N+1: slot 0 = EXECUTION, slot 1 = BEHAVIOR
- Max 2 slots per composition (only 2 mutable genome sections with params)
- Bare tool name aliases registered for backward compat (bridge fixtures work unchanged)
- Substitution: top-level field access only; non-string auto-JSON-serialized
- decode_params default slot_index=1 for backward compat

## Verification
