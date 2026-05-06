# Packet 8.5 — Tool-Runner Sensitivity Audit Report

**Date:** 2026-05-06 00:37 UTC  
**Seed:** 42  
**Runners audited:** 8  
**Pairs per runner:** 10  

---

## Executive summary

- **BLIND** (sensitivity ≤ 0.2): 8 runners — compute, extract_json, file_read, file_write, http_get, search_text, url_fetch, web_search
- **WEAK**  (sensitivity 0.2–0.6): 0 runners — none
- **OK**    (sensitivity > 0.6): 0 runners — none

**Genome ever passed to runner:** NO — genome discarded after validation in all cases

---

## Summary table

| Runner | Output sensitivity | Correctness sensitivity | tool_calls sensitivity | Fitness sensitivity | Classification |
| --- | --- | --- | --- | --- | --- |
| `compute` | 0.00 | 0.00 | 0.00 | 0.00 | **BLIND** |
| `extract_json` | 0.00 | 0.00 | 0.00 | 0.00 | **BLIND** |
| `file_read` | 0.00 | 0.00 | 0.00 | 0.00 | **BLIND** |
| `file_write` | 0.00 | 0.00 | 0.00 | 0.00 | **BLIND** |
| `http_get` | 0.00 | 0.00 | 0.00 | 0.00 | **BLIND** |
| `search_text` | 0.00 | 0.00 | 0.00 | 0.00 | **BLIND** |
| `url_fetch` | 0.00 | 0.00 | 0.00 | 0.00 | **BLIND** |
| `web_search` | 0.00 | 0.00 | 0.00 | 0.00 | **BLIND** |

---

## Per-runner detail

### `compute` — BLIND

- Pairs tested: 10
- Output sensitivity: 0.00 (0/10 pairs produced different output)
- Correctness sensitivity: 0.00 (0/10 pairs)
- tool_calls sensitivity: 0.00 (0/10 pairs)
- Fitness sensitivity: 0.00 (0/10 pairs)
- Genome passed to runner: **NO**
- Sample genome A (first 32 chars): `COMPUT01G1AlienClaw1d1HDjft5Q1DV...`
- Sample genome B (first 32 chars): `COMPUT01oQ6lQkfCPawCSBFDpftYQ1DV...`
- Sample output A: `{"input": "7 + 35", "operation": "eval", "result": 42, "resultType": "int"}`
- Sample output B: `{"input": "7 + 35", "operation": "eval", "result": 42, "resultType": "int"}`
- Outputs identical: True

### `extract_json` — BLIND

- Pairs tested: 10
- Output sensitivity: 0.00 (0/10 pairs produced different output)
- Correctness sensitivity: 0.00 (0/10 pairs)
- tool_calls sensitivity: 0.00 (0/10 pairs)
- Fitness sensitivity: 0.00 (0/10 pairs)
- Genome passed to runner: **NO**
- Sample genome A (first 32 chars): `EXTRAC01G1AlienClaw1eFrQMHgkPmTM...`
- Sample genome B (first 32 chars): `EXTRAC01d1GUiBDmsS81eFrQMHpkpQvM...`
- Sample output A: `{"path": "name", "value": "Alice", "type": "str"}`
- Sample output B: `{"path": "name", "value": "Alice", "type": "str"}`
- Outputs identical: True

### `file_read` — BLIND

- Pairs tested: 10
- Output sensitivity: 0.00 (0/10 pairs produced different output)
- Correctness sensitivity: 0.00 (0/10 pairs)
- tool_calls sensitivity: 0.00 (0/10 pairs)
- Fitness sensitivity: 0.00 (0/10 pairs)
- Genome passed to runner: **NO**
- Sample genome A (first 32 chars): `FILERE01G1AlienClaw1mi1U5pzzStxT...`
- Sample genome B (first 32 chars): `FILERE0105flianilaU1m84U5piZStxr...`
- Sample output A: `{"path": "/tmp/alienclaw-diag-glcel0q7/test_read.txt", "content": "hello from fi`
- Sample output B: `{"path": "/tmp/alienclaw-diag-glcel0q7/test_read.txt", "content": "hello from fi`
- Outputs identical: True

### `file_write` — BLIND

- Pairs tested: 10
- Output sensitivity: 0.00 (0/10 pairs produced different output)
- Correctness sensitivity: 0.00 (0/10 pairs)
- tool_calls sensitivity: 0.00 (0/10 pairs)
- Fitness sensitivity: 0.00 (0/10 pairs)
- Genome passed to runner: **NO**
- Sample genome A (first 32 chars): `FILEWR01G1AlienClaw1DhDsRo9IxrTR...`
- Sample genome B (first 32 chars): `FILEWR01T1ASieFFloMwrhDsXfXIxrTR...`
- Sample output A: `{"path": "/tmp/alienclaw-diag-glcel0q7/test_write.txt", "bytes_written": 16}`
- Sample output B: `{"path": "/tmp/alienclaw-diag-glcel0q7/test_write.txt", "bytes_written": 16}`
- Outputs identical: True

### `http_get` — BLIND

- Pairs tested: 10
- Output sensitivity: 0.00 (0/10 pairs produced different output)
- Correctness sensitivity: 0.00 (0/10 pairs)
- tool_calls sensitivity: 0.00 (0/10 pairs)
- Fitness sensitivity: 0.00 (0/10 pairs)
- Genome passed to runner: **NO**
- Sample genome A (first 32 chars): `HTTPGE01G1AlienClaw15a6QUYFUfoYD...`
- Sample genome B (first 32 chars): `HTTPGE01j1bNi0cClab3Oa6vUYVKf0YD...`
- Sample output A: `{"url": "http://127.0.0.1:46629/test", "status_code": 200, "body": "{\"result\":`
- Sample output B: `{"url": "http://127.0.0.1:46629/test", "status_code": 200, "body": "{\"result\":`
- Outputs identical: True

### `search_text` — BLIND

- Pairs tested: 10
- Output sensitivity: 0.00 (0/10 pairs produced different output)
- Correctness sensitivity: 0.00 (0/10 pairs)
- tool_calls sensitivity: 0.00 (0/10 pairs)
- Fitness sensitivity: 0.00 (0/10 pairs)
- Genome passed to runner: **NO**
- Sample genome A (first 32 chars): `SEARCH01G1AlienClaw1Hng2raooHmck...`
- Sample genome B (first 32 chars): `SEARCH01tmBoieuCZbw1HyAHaaooHmrk...`
- Sample output A: `{"pattern": "fox", "match_count": 1, "matches": [{"line": 1, "text": "the quick `
- Sample output B: `{"pattern": "fox", "match_count": 1, "matches": [{"line": 1, "text": "the quick `
- Outputs identical: True

### `url_fetch` — BLIND

- Pairs tested: 10
- Output sensitivity: 0.00 (0/10 pairs produced different output)
- Correctness sensitivity: 0.00 (0/10 pairs)
- tool_calls sensitivity: 0.00 (0/10 pairs)
- Fitness sensitivity: 0.00 (0/10 pairs)
- Genome passed to runner: **NO**
- Sample genome A (first 32 chars): `URLFET01G1AlienClaw1SOEmGbiCPggI...`
- Sample genome B (first 32 chars): `URLFET01E1MlyznCfxL12Olm6SWUCYiI...`
- Sample output A: `{"url": "http://127.0.0.1:46629/test", "method": "GET", "status_code": 200, "con`
- Sample output B: `{"url": "http://127.0.0.1:46629/test", "method": "GET", "status_code": 200, "con`
- Outputs identical: True

### `web_search` — BLIND

- Pairs tested: 10
- Output sensitivity: 0.00 (0/10 pairs produced different output)
- Correctness sensitivity: 0.00 (0/10 pairs)
- tool_calls sensitivity: 0.00 (0/10 pairs)
- Fitness sensitivity: 0.00 (0/10 pairs)
- Genome passed to runner: **NO**
- Sample genome A (first 32 chars): `WEBSEA01G1AlienClaw1l0WLloSb2MIi...`
- Sample genome B (first 32 chars): `WEBSEA01GGAli28xFrhul0WQlJtC2MeY...`
- Sample output A: `{"query": "alienclaw genome evolution", "results": []}`
- Sample output B: `{"query": "alienclaw genome evolution", "results": []}`
- Outputs identical: True

---

## Findings

### MUST FIX #1 — Genome discarded after validation (all runners)

**Source:** `src/alienclaw/bridge/server.py` line ~110
```python
runner = RUNNER_REGISTRY[martian_type]
run_result = runner(req['inputs'])  # genome not passed
```

The genome is validated (`validate_genome(genome)`) and then discarded.
No runner receives the genome string. No decoded behavioral parameters
are extracted. The runner signature is `run(inputs: dict) -> RunResult`.

**Effect:** Every genome that passes checksum validation achieves identical
fitness for identical inputs. Tournament selection has no signal to act on.
Evolution is purely neutral drift.

**Classification:** MUST FIX — blocks Packet 10.
**Fix size:** Large (>20 lines). Requires Packet 8.6.

### MUST FIX #2 — BrainSpec has no machine-readable parameter_schema

**Source:** `src/alienclaw/brains/types.py`

`BrainSpec.genome_sections` is `GenomeSectionDocs` — three prose strings
describing what genome bytes MEAN (e.g. 'Char 0 = retry attempt encoding').
There is no structured `parameter_schema` with typed field definitions.
No decoder can be written from prose; there is nothing to decode.

The brain MSB files DO document the encoding (e.g., `compute.msb` says
`EXECUTION: Char 0 = retry attempt encoding (charCode-48 mod 5 + 1 = maxAttempts)`).
This is the right information — it just needs to be machine-readable.

**Classification:** MUST FIX — prerequisite for Fix #1.
**Fix size:** Large (>20 lines). Requires Packet 8.6.

### MUST FIX #3 — Binary correctness (1.0 success / 0.0 failure)

**Source:** `src/alienclaw/bridge/runners/types.py`
```python
@dataclass
class RunResult:
    ok: bool
    correctness: float = 1.0  # all runners: either 1.0 or 0.0
    tool_calls: int = 1       # all runners: always 1
```

All 8 runners return `correctness=1.0` on success and `0.0` on failure.
Correctness is binary. For stable inputs (e.g., `compute: '2+2'`), it is
always 1.0. This is a second reason fitness cannot vary across genomes.

**Classification:** MUST FIX — even after Fix #1 and #2, fitness remains
binary without graded correctness.
**Fix size:** Medium (varies per runner). Requires Packet 8.6.

### MUST FIX #4 — tool_calls always 1 (efficiency constant)

Every runner hard-codes `tool_calls=1` (the RunResult default).
Efficiency = `1 / max(1, tool_calls)` = 1.0 always.
The efficiency component of the fitness formula is a no-op in v1.0.

**Classification:** MUST FIX — after Fixes #1-3, this is the remaining
constant in the fitness formula.
**Fix size:** Medium. Some runners could retry on failure (honoring genome-
encoded maxAttempts) and count each attempt as a tool call.
Requires Packet 8.6.

---

## Root-cause hypothesis (confirmed by audit)

Packet 8's neutral evolution was caused by four independent issues, each
of which alone would produce neutral evolution, and which compound:

1. Genome discarded after validation → runners receive no genome data
2. No parameter_schema → no decoder could extract behavioral parameters
3. Binary correctness → fitness insensitive to output quality
4. tool_calls=1 constant → efficiency never varies

The genome is architecturally correct (validates, mutates, crosses over,
stores successfully). The gap is at the genome→behavior boundary.
Fix #1 is the structural prerequisite; Fixes #2-4 complete the signal.

---

## Reproduction

```bash
PYTHONPATH=src python3 -m alienclaw.diagnostics audit --seed 42
```

All findings are deterministic from the seed above.
