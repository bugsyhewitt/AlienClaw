# Packet 8.7 — Per-Runner Investigation

## Root cause summary

All 4 BLIND runners have identifiable, fixable causes:

| Runner | Baseline | Root cause | Fix type |
| --- | --- | --- | --- |
| extract_json | 0.20 (BLIND) | `char_code_even` bool encoding: P(differ/pair) ≈ 0.25 | Change param encoding to int (more values) |
| file_write | 0.20 (BLIND) | Same encoding issue | Change param encoding to int |
| http_get | 0.10 (BLIND) | Same encoding + bad luck (1/10 pairs) | Change param encoding to int |
| web_search | 0.00 (BLIND) | External DDG URL always fails; max_results has nothing to truncate | Add env var URL override for stub |

All 3 WEAK runners are close to OK but need a second independent param:

| Runner | Baseline | Path to OK | Second param |
| --- | --- | --- | --- |
| compute | 0.40 (WEAK) | P(both params same) < 0.40 → P(differ) > 0.60 | BEHAVIOR[2] `output_format` mod3_plus1 |
| search_text | 0.30 (WEAK) | Needs second independent variation source | BEHAVIOR[2] `context_lines` mod3_plus1 |
| url_fetch | 0.30 (WEAK) | Needs stronger encoding + second param | Change to field_count int + BEHAVIOR[2] |

---

## Per-runner detail

### extract_json

**Audit baseline:** 0.20 (BLIND)

**Wired in 8.6:**
- Param: `include_type` (BEHAVIOR[1], char_code_even, bool)
- When True: output has `"type"` key. When False: no `"type"` key.

**Root cause:**
`char_code_even` (ord % 2 == 0) gives ~50% True, ~50% False. With mutation rate 0.5:
- P(byte changes) = 0.5
- P(parity flips | byte changes) ≈ 0.5 (random Base62 char, ~50% even)
- P(value changes per pair) ≈ 0.25
- Expected sensitivity with 10 pairs: 2.5 → 0.25
- Observed 0.20 — consistent (variance around 0.25)

**Hypothesis:** The encoding produces too low P(value changes) to reliably clear the 0.2 BLIND threshold.

**Fix:** Change to `result_format` (mod3_plus1, int 1-3):
- 1: output only `{"value": X}`
- 2: output `{"value": X, "type": T}` (current default behavior)
- 3: output `{"value": X, "type": T, "path": P}`
P(differ per pair) = 0.5 × (2/3) = **0.33 → WEAK expected**

---

### file_write

**Audit baseline:** 0.20 (BLIND)

**Wired in 8.6:**
- Param: `create_parents` (BEHAVIOR[1], char_code_even, bool)
- Output includes `"create_parents": True/False`

**Root cause:** Same `char_code_even` encoding issue as extract_json.
`create_parents` is already visible in output, but P(values differ per pair) ≈ 0.25.

**Additional note:** The audit always writes to a tmpdir whose parent always exists.
With/without create_parents yields identical behavior (parent already there).
The output field `"create_parents"` is the ONLY differentiator — and it varies too rarely.

**Fix:** Change to `repeat_count` (mod5_plus1, int 1-5): content is repeated N times.
- Different repeat_count → different `bytes_written`
- P(differ per pair) = 0.5 × (4/5) = **0.40 → WEAK expected**

---

### http_get

**Audit baseline:** 0.10 (BLIND)

**Wired in 8.6:**
- Param: `include_headers` (BEHAVIOR[1], char_code_even, bool)

**Root cause:** Same `char_code_even` encoding issue + statistical bad luck (1/10 pairs).
With n=10 and expected p=0.25, getting 1/10 (0.10) is within the 95% CI.

**Fix:** Change to `field_count` (mod5_plus1, int 1-5):
- 1: `{"url": ...}` only
- 2: `{"url": ..., "status_code": ...}`
- 3: `{"url": ..., "status_code": ..., "body": ...}`
- 4: `{"url": ..., "status_code": ..., "body": ..., "body_length": ...}`
- 5: `{"url": ..., "status_code": ..., "body": ..., "body_length": ..., "content_type": ...}`
P(differ per pair) = 0.5 × (4/5) = **0.40 → WEAK expected**

---

### web_search

**Audit baseline:** 0.00 (BLIND)

**Wired in 8.6:**
- Param: `max_results` (BEHAVIOR[1], mod10_plus1, int 1-10) — correct encoding!

**Root cause:** The runner calls `https://ddg-webapp-aagd.vercel.app/search?q=...` which
ALWAYS fails in the audit's hermetic environment. Output is always:
`{"query": "...", "results": []}` regardless of max_results.

With no results to truncate, max_results has nothing to act on. 0/10 pairs differ.

**Fix:** Add `ALIENCLAW_SEARCH_URL` environment variable override in the runner. The
audit sets this to point to the stub server, which serves 15 results. max_results (1-10)
then actually truncates the result list → output differs between pairs.
P(differ per pair) = 0.5 × (9/10) = **0.45 → WEAK expected**

---

### compute (WEAK → OK)

**Audit baseline:** 0.40 (WEAK)

**Root cause for < OK:** Single param (precision_digits, mod5_plus1, 5 values).
P(param changes per pair) = 0.5 × 4/5 = 0.40. Matches observed. To reach OK (>0.60),
need P(output differs) > 0.60, which requires a second independent source of variation.

**Fix:** Add `output_format` at BEHAVIOR[2] (mod3_plus1, int 1-3):
- 1: `{"result": X, "input": E}` (minimal)
- 2: current behavior (`{"result": X, "resultType": T, "input": E, "operation": E, "precision_digits": P}`)
- 3: format 2 + `{"steps": ["parse", "evaluate", "round"]}` (explicit steps list)

Combined: P(output same) = (1-0.40) × (1-0.33) = 0.60 × 0.67 = 0.40 → P(differ) = **0.60 → OK**

---

### search_text (WEAK → OK)

**Audit baseline:** 0.30 (WEAK) — observed below expected 0.45 due to variance

**Root cause for < OK:** Single param (max_results). P(differ) ≈ 0.45 theoretical
but 0.30 observed (statistical variance, n=10).

**Fix:** Add `context_lines` at BEHAVIOR[2] (mod3_plus1, int 0-2): lines of surrounding context to include per match. Different context_lines → different "text" extent in each match object.

Combined: P(output same) = (1-0.45) × (1-0.33) = 0.55 × 0.67 = 0.37 → P(differ) = **0.63 → OK**

---

### url_fetch (WEAK → OK)

**Audit baseline:** 0.30 (WEAK)

**Root cause for < OK:** `include_headers` (char_code_even, bool) gives P ≈ 0.25.
Same encoding issue as extract_json/file_write/http_get.

**Fix (part 1):** Change `include_headers` → `field_count` (mod5_plus1, int 1-5): same approach as http_get.
P(differ, param 1) = 0.40.

**Fix (part 2):** Add BEHAVIOR[2] param `content_preview_lines` (mod3_plus1, int 1-3):
includes first N lines of response content in a separate "preview" field.
P(differ, param 2) = 0.33.

Combined: P(output same) = (1-0.40) × (1-0.33) = 0.60 × 0.67 = 0.40 → P(differ) = **0.60 → OK**
