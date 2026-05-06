# Packet 8.8 — Per-Runner Design: tool_calls + Correctness

## Design Principles

For directed evolution, fitness must vary between genomes. The formula is
`correctness × (1 / max(1, tool_calls))`. search_text already achieves this
via max_results (genome param) = tool_calls directly.

For all other runners the same pattern: add a genome param that **directly
equals tool_calls**. The runner does N iterations of its core operation.
N=1 → fitness=1.0. N=5 → fitness=0.2. Selection finds N=1 in ≤5 generations.

Correctness stays 1.0 (binary) for runners where any success is complete
success. Graded correctness added only where partial completion is natural.

---

### file_write

**Current behavior:**
- repeat_count (BEHAVIOR[1], mod5_plus1, 1-5): writes content N times concatenated
- Always returns tool_calls=1 (single write call)
- correctness: 1.0 success / 0.0 fail

**Variable tool_calls — fix:**
- No new param needed. repeat_count (1-5) already encodes iteration count.
- Change: set tool_calls=repeat_count instead of tool_calls=1
- Each repetition = one write tool_call. Honest: Martian writes content N times.

**Graded correctness:** Binary (write succeeds or fails). Keep 1.0.

**Audit test input changes:** None needed — current input exercises repeat_count.

**Expected sensitivity post-fix:**
- tool_calls_sensitivity: ≈0.6-0.8 (repeat_count varies 1-5 across genome pairs)
- fitness_sensitivity: ≈0.6-0.8 (same driver)
- correctness_sensitivity: 0.0 (binary, always 1.0)

**MSB change:** None.

---

### file_read

**Current behavior:**
- max_lines (BEHAVIOR[1], mod10_plus1, 1-10): truncates to N lines from 20-line test file
- skip_lines (BEHAVIOR[2], mod10_plus1, 1-10): skips first N-1 lines
- Returns tool_calls=1 always
- correctness: 1.0 always

**Variable tool_calls — new param:**
- `chunk_count|BEHAVIOR|3|mod5_plus1|int|1` (1-5)
- Runner reads file in chunk_count sequential passes (each pass reads a subset of lines)
- tool_calls = chunk_count
- Honest: chunked reading is standard for large files

**Graded correctness:**
- lines_returned = actual lines in output (after skip_lines + max_lines truncation)
- total_lines = full line count of file
- correctness = min(1.0, lines_returned / total_lines)
- With test file of 20 lines and max_lines ∈ [1..10] → correctness ∈ [0.05..0.50]
- This makes correctness vary with genome (max_lines is genome-decoded)

**Audit test input changes:** Same 20-line file — already sufficient.

**Expected sensitivity post-fix:**
- tool_calls_sensitivity: ≈0.6-0.8 (chunk_count 1-5)
- correctness_sensitivity: ≈0.6-0.8 (max_lines 1-10 from 20-line file → 0.05-0.50)
- fitness_sensitivity: ≈0.8-0.95 (both drivers compound)

**MSB change:** Add `chunk_count|BEHAVIOR|3|mod5_plus1|int|1`

---

### compute

**Current behavior:**
- max_attempts (EXECUTION[0], mod5_plus1, 1-5): retry loop on eval failure
- precision_digits (BEHAVIOR[1], mod5_plus1, 1-5): rounding precision
- output_format (BEHAVIOR[2], mod10_plus1, 1-10): output structure
- With test input "7 / 3" (always succeeds): tool_calls=1 always (first attempt succeeds)
- correctness: 1.0 on success, 0.0 on failure

**Variable tool_calls — new param:**
- `validation_count|BEHAVIOR|3|mod5_plus1|int|1` (1-5)
- Runner evaluates expression validation_count total times (not just on failure)
- Each evaluation = one tool_call. tool_calls = validation_count.
- Returns result of first evaluation; subsequent evaluations are validation passes.
- Honest: numerical verification by re-computing is standard practice.

**Graded correctness:** Binary — deterministic eval always gives identical results.
All validation passes agree → correctness=1.0.

**Audit test input changes:** Same input "7 / 3" — always succeeds.

**Expected sensitivity post-fix:**
- tool_calls_sensitivity: ≈0.6-0.8 (validation_count 1-5)
- fitness_sensitivity: ≈0.6-0.8 (same driver)
- correctness_sensitivity: 0.0 (deterministic eval → always 1.0)

**MSB change:** Add `validation_count|BEHAVIOR|3|mod5_plus1|int|1`

---

### extract_json

**Current behavior:**
- result_format (BEHAVIOR[1], mod3_plus1, 1-3): output structure (value, +type, +path)
- Always returns tool_calls=1
- correctness: 1.0 if path found, 0.0 if not

**Variable tool_calls — new param:**
- `extraction_passes|BEHAVIOR|2|mod5_plus1|int|1` (1-5)
- Runner re-parses and re-extracts the path extraction_passes times
- tool_calls = extraction_passes
- Honest: idempotent multi-pass extraction simulates Martian verifying its JSON reads

**Graded correctness:** Keep binary (1.0 found / 0.0 not found).
Test input `{"name": "Alice", "score": 99}` + path="name" always succeeds.

**Audit test input changes:** Same input — always succeeds.

**Expected sensitivity post-fix:**
- tool_calls_sensitivity: ≈0.6-0.8 (extraction_passes 1-5)
- fitness_sensitivity: ≈0.6-0.8 (same driver)
- correctness_sensitivity: 0.0 (binary)

**MSB change:** Add `extraction_passes|BEHAVIOR|2|mod5_plus1|int|1`

---

### http_get

**Current behavior:**
- field_count (BEHAVIOR[1], mod5_plus1, 1-5): output fields
- body_preview (BEHAVIOR[2], mod10_plus1, 1-10): preview lines
- Returns tool_calls=1 always
- correctness: 1.0 on 2xx, 0.0 on error

**Variable tool_calls — new param:**
- `request_count|BEHAVIOR|3|mod5_plus1|int|1` (1-5)
- Runner makes request_count sequential GET requests to the same URL
- tool_calls = request_count. Returns result of last request.
- Honest: re-fetching for reliability/freshness is standard.

**Graded correctness:** Binary (stub always returns 200 → 1.0).
Future: status-code grading when stub supports 4xx/5xx paths.

**Audit test input changes:** Stub `/test` endpoint returns 200 — already sufficient.

**Expected sensitivity post-fix:**
- tool_calls_sensitivity: ≈0.6-0.8 (request_count 1-5)
- fitness_sensitivity: ≈0.6-0.8 (same driver)

**MSB change:** Add `request_count|BEHAVIOR|3|mod5_plus1|int|1`

---

### url_fetch

**Current behavior:**
- field_count (BEHAVIOR[1], mod5_plus1, 1-5): output fields
- content_preview (BEHAVIOR[2], mod10_plus1, 1-10): preview lines
- Returns tool_calls=1 always
- correctness: 1.0 on success, 0.0 on error

**Variable tool_calls — new param:**
- `request_count|BEHAVIOR|3|mod5_plus1|int|1` (1-5)
- Runner makes request_count sequential requests. tool_calls = request_count.
- Same design as http_get. Honest: retry/reliability pattern.

**Graded correctness:** Binary (stub always 200).

**Audit test input changes:** Same stub endpoint — sufficient.

**Expected sensitivity post-fix:**
- tool_calls_sensitivity: ≈0.6-0.8
- fitness_sensitivity: ≈0.6-0.8

**MSB change:** Add `request_count|BEHAVIOR|3|mod5_plus1|int|1`

---

### web_search

**Current behavior:**
- max_results (BEHAVIOR[1], mod10_plus1, 1-10): limits results returned
- Returns tool_calls=1 always
- correctness: 1.0 if results, 0.5 if empty

**Variable tool_calls — new param:**
- `page_count|BEHAVIOR|2|mod3_plus1|int|1` (1-3)
- Runner fetches page_count pages of results (sequential requests, each with offset)
- tool_calls = page_count
- Honest: paginated search is standard (fetch page 1, then page 2, etc.)

**Graded correctness:**
- total_results = sum of results across all pages
- correctness = min(1.0, total_results / (max_results * page_count))
- With stub returning 15 results and max_results=5: correctness=1.0 (15 ≥ 5×3=15)
- Effectively binary for stub-constrained audit; real engine produces gradient.

**Audit test input changes:**
- Stub serves 15 results — sufficient to fill up to page_count=3.
- Stub URL already set via ALIENCLAW_SEARCH_URL in audit.

**Expected sensitivity post-fix:**
- tool_calls_sensitivity: ≈0.5-0.7 (page_count 1-3, smaller range)
- fitness_sensitivity: ≈0.5-0.7

**MSB change:** Add `page_count|BEHAVIOR|2|mod3_plus1|int|1`

---

## Summary Table

| Runner | New param | Encoding | Range | tool_calls=... | Correctness change |
| --- | --- | --- | --- | --- | --- |
| file_write | (none) | — | — | repeat_count | None (binary) |
| file_read | chunk_count @ BEHAVIOR[3] | mod5_plus1 | 1-5 | chunk_count | Graded: lines/total |
| compute | validation_count @ BEHAVIOR[3] | mod5_plus1 | 1-5 | validation_count | None (binary) |
| extract_json | extraction_passes @ BEHAVIOR[2] | mod5_plus1 | 1-5 | extraction_passes | None (binary) |
| http_get | request_count @ BEHAVIOR[3] | mod5_plus1 | 1-5 | request_count | None (binary) |
| url_fetch | request_count @ BEHAVIOR[3] | mod5_plus1 | 1-5 | request_count | None (binary) |
| web_search | page_count @ BEHAVIOR[2] | mod3_plus1 | 1-3 | page_count | Graded: results/expected |
