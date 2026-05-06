# MINI-PACKET-8-6 — Genome → Behavior Wiring

**Triggered by:** Packet 8.5 audit (4 MUST FIX items, all structural)  
**Gates:** Packet 10 (leaderboard). Do not ship Packet 10 until this lands.  
**Effort:** Advanced (~8-12 hours)

---

## What the audit found

All 4 MUST FIX items from the sensitivity audit (packet-08-5-audit-report.md)
reduce to one structural gap: **the genome is validated but never decoded into
behavioral parameters that runners use**. The chain is broken at every link:

| Gap | Location | Effect |
| --- | --- | --- |
| Genome discarded after validation | `bridge/server.py:110` | No runner receives genome data |
| No machine-readable parameter_schema | `brains/types.py:BrainSpec` | No decoder can exist |
| Binary correctness (1.0 / 0.0) | `bridge/runners/types.py:RunResult` | Fitness insensitive to output quality |
| tool_calls always 1 | `bridge/runners/types.py:RunResult` | Efficiency never varies |

---

## Goal

After this packet, a change in genome EXECUTION section byte 0 (which the
`compute.msb` brain documents as `maxAttempts = charCode-48 mod 5 + 1`)
must produce a measurable difference in runner behavior — different retry
count, or different output on failure-then-retry inputs. The sensitivity
audit (re-run after this packet) must show at least one runner with
sensitivity > 0.2 for at least one genome parameter.

---

## Required work (four phases)

### Phase A — Add parameter_schema to BrainSpec

The brain MSB files already document genome encoding in prose. This phase
makes that encoding machine-readable.

**Option A1 (preferred):** Add a structured `parameter_schema` field to `BrainSpec`.
Each field in `parameter_schema` specifies:
- `name`: parameter name (e.g., `max_attempts`)
- `section`: `EXECUTION` | `BEHAVIOR` (not IDENTITY or CHECKSUM)
- `byte_offset`: which byte within the section (0-63)
- `encoding`: how to decode that byte (e.g., `"charCode-48 mod 5 + 1"` → int in [1,6])
- `type`: `int` | `float` | `bool` | `enum`
- `default`: value to use if decoding fails

Both Python `BrainSpec` and TypeScript `MartianBrain` types need updating.
Both `brains/parser.py` and `msb/msb-loader.ts` need to parse the new section.
Cross-language fixture must be extended to cover parameter_schema parsing.

**Option A2 (fallback):** Parse the existing GENOME SECTIONS prose into a
structured representation using a mini-parser. More fragile, but avoids editing
the 8 MSB files.

### Phase B — Write the genome parameter decoder

`src/alienclaw/brains/decoder.py`:
```python
def decode_params(brain: BrainSpec, genome: str) -> dict[str, Any]:
    """Extract behavioral parameters from a genome string per the brain's schema."""
    params = {}
    for field in brain.parameter_schema:
        section_start = SECTION_OFFSETS[field.section]
        byte = genome[section_start + field.byte_offset]
        params[field.name] = _apply_encoding(byte, field.encoding, field.default)
    return params
```

Mirror this decoder in TypeScript for the TS governance layer.

### Phase C — Pass decoded params to runners

`src/alienclaw/bridge/server.py`:
```python
decoded = decode_params(brain, genome)           # NEW
runner = RUNNER_REGISTRY[martian_type]
run_result = runner(req["inputs"], decoded)      # decoded params added
```

Update all 8 runner signatures:
```python
def run(inputs: dict, params: dict) -> RunResult:
```

Each runner must read at least ONE param from `params` and use it to vary
behavior. Examples:
- `compute`: use `params.get("max_attempts", 1)` to retry failed expressions
- `extract_json`: use `params.get("strict_mode", True)` to control type validation
- `http_get`: use `params.get("follow_redirects", True)` and `params.get("timeout_factor", 1.0)`
- `search_text`: use `params.get("max_results", 100)` to limit output
- `file_read`: use `params.get("max_bytes", 1048576)` for size limit
- `file_write`: use `params.get("create_parents", True)` for mkdir behavior

### Phase D — Graded correctness + real tool_calls counting

Replace binary `correctness=1.0 / 0.0` with graded scores where behavior
naturally varies:
- `compute`: multi-step arithmetic gets `correctness = 1.0 / step_count`
- `http_get`: `correctness = 1.0 if status==200 else 0.8 if status<500 else 0.0`
- `search_text`: `correctness = min(1.0, match_count / expected_min_matches)` where `expected_min_matches` comes from genome params

Replace `tool_calls=1` with real accounting for retry attempts:
```python
for attempt in range(max_attempts):
    result = try_run(...)
    tool_calls += 1
    if result.ok:
        break
return RunResult(tool_calls=tool_calls, ...)
```

### Validation

Re-run the sensitivity audit (Packet 8.5 tool):
```bash
PYTHONPATH=src python3 -m alienclaw.diagnostics audit --seed 42
```

Success criterion: at least 3 runners show output_sensitivity > 0.2.
At least 1 runner shows tool_calls_sensitivity > 0.0.

---

## Constraints

- The 8 MSB files may be edited to add `parameter_schema:` sections. This
  is the clean path.
- The fitness formula stays locked: `correctness × 1/max(1, tool_calls)`.
- The genome format stays locked: 256 chars, 4 sections × 64, Base62.
- Cross-language fixture discipline applies: any new decode/runner behavior
  must be exercised by shared fixtures in both Python and TypeScript.
- Instrumentation in `src/alienclaw/diagnostics/` must still work after
  this packet (tests confirm this).

---

## Estimate

~8-12 hours. Plan before executing — the cross-language propagation makes
it easy to introduce silent divergences.
