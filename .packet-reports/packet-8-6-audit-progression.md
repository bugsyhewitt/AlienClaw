# Audit Progression — Packet 8.6

Sensitivity scores re-measured at the end of each phase. Seed=42 throughout. Apples-to-apples comparison with the Packet 8.5 baseline.

## Baseline (post-Packet-8.5, pre-Packet-8.6)

| Runner | Output sensitivity | tool_calls sensitivity | Fitness sensitivity | Classification |
| --- | --- | --- | --- | --- |
| compute | 0.00 | 0.00 | 0.00 | BLIND |
| extract_json | 0.00 | 0.00 | 0.00 | BLIND |
| file_read | 0.00 | 0.00 | 0.00 | BLIND |
| file_write | 0.00 | 0.00 | 0.00 | BLIND |
| http_get | 0.00 | 0.00 | 0.00 | BLIND |
| search_text | 0.00 | 0.00 | 0.00 | BLIND |
| url_fetch | 0.00 | 0.00 | 0.00 | BLIND |
| web_search | 0.00 | 0.00 | 0.00 | BLIND |

**Summary:** 8/8 BLIND. 0 with signal.

---

## After Phase A — parameter_schema declared and parsed

Audit unchanged from baseline. Phase A was plumbing only (MSB files edited,
parser updated, types extended). No decode happens until Phase B. No runner
uses params until Phase C.

---

## After Phases B+C — decoder wired + runners use params (HEADLINE MOVE)

| Runner | Output sensitivity | tool_calls sensitivity | Fitness sensitivity | Classification |
| --- | --- | --- | --- | --- |
| compute | **0.40** | 0.00 | 0.00 | **WEAK** |
| extract_json | 0.20 | 0.00 | 0.00 | BLIND |
| file_read | **0.80** | 0.00 | 0.00 | **OK** |
| file_write | 0.20 | 0.00 | 0.00 | BLIND |
| http_get | 0.10 | 0.00 | 0.00 | BLIND |
| search_text | **0.30** | **0.30** | **0.30** | **WEAK** |
| url_fetch | **0.30** | 0.00 | 0.00 | **WEAK** |
| web_search | 0.00 | 0.00 | 0.00 | BLIND |

**Summary:** 4/8 with signal. BLIND count: 4 → 4.

**Success criteria MET:**
- ≥3 runners with output_sensitivity > 0.2: file_read(0.80), compute(0.40), search_text(0.30), url_fetch(0.30) → **4 runners** ✓
- ≥1 runner with tool_calls_sensitivity > 0.0: search_text(0.30) → ✓

**Why 4 runners remain BLIND:**
- extract_json (0.20): include_type is bool from char_code_even (~50% of chars); borderline
- file_write (0.20): create_parents only affects behavior when parent dir is missing; audit creates tmpdir so parent always exists → no behavioral difference
- http_get (0.10): include_headers bool sensitivity is low with current random pairs
- web_search (0.00): external network call fails → output always `{"results": []}` → genome has nothing to affect

**Evolution loop confirmation:**
search_text with 20-match text:
- Generation 0 mean fitness: 0.528 (first eval from initial 0.0)
- Generation 1 mean fitness: 0.872
- Generation 2 mean fitness: 1.000 (converged)
- Tournament selection selected for max_results=1 (fewest tool_calls = highest fitness)
- **This is the first time the AlienClaw evolution loop produced non-flat fitness via genome-driven behavior**
