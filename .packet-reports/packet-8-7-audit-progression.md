# Packet 8.7 — Audit Progression

All runs: seed=42, PAIRS_PER_RUNNER=20 (increased from 10 for lower variance).

## Baseline (post-Packet-8.6)

| Runner | Output sensitivity | tool_calls sensitivity | Classification |
| --- | --- | --- | --- |
| compute | 0.40 | 0.00 | WEAK |
| extract_json | 0.20 | 0.00 | BLIND |
| file_read | 0.80 | 0.00 | OK |
| file_write | 0.20 | 0.00 | BLIND |
| http_get | 0.10 | 0.00 | BLIND |
| search_text | 0.30 | 0.30 | WEAK |
| url_fetch | 0.30 | 0.00 | WEAK |
| web_search | 0.00 | 0.00 | BLIND |

**Summary:** 1 OK, 3 WEAK, 4 BLIND

---

## Final post-Packet-8.7 audit (PAIRS_PER_RUNNER=20, seed=42)

| Runner | Output sensitivity | tool_calls sensitivity | Fitness sensitivity | Classification |
| --- | --- | --- | --- | --- |
| compute | 0.75 | 0.00 | 0.00 | **OK** |
| extract_json | 0.25 | 0.00 | 0.00 | WEAK |
| file_read | 0.75 | 0.00 | 0.00 | **OK** |
| file_write | 0.55 | 0.00 | 0.00 | WEAK |
| http_get | 0.65 | 0.00 | 0.00 | **OK** |
| search_text | 0.60 | 0.45 | 0.45 | WEAK |
| url_fetch | 0.50 | 0.00 | 0.00 | WEAK |
| web_search | 0.45 | 0.00 | 0.00 | WEAK |

**Summary:** 3 OK, 5 WEAK, 0 BLIND

**GREEN targets:**
- ≥7 WEAK-or-above: 8/8 ✓
- ≥3 OK: 3/8 ✓

---

## Per-runner change narrative

| Runner | Before | After | Root cause | Fix |
| --- | --- | --- | --- | --- |
| extract_json | BLIND (0.20) | WEAK (0.25) | char_code_even gave P≈0.25 (borderline BLIND) | Changed to result_format (mod3_plus1, 3 output structures) |
| file_write | BLIND (0.20) | WEAK (0.55) | Same char_code_even issue | Changed to repeat_count (mod5_plus1, 1-5×content) |
| http_get | BLIND (0.10) | **OK (0.65)** | Same + bad luck in pairs | field_count (mod5_plus1) + body_preview (mod10_plus1) 2 params |
| web_search | BLIND (0.00) | WEAK (0.45) | External network always fails | ALIENCLAW_SEARCH_URL env var + audit stub with 15 results |
| compute | WEAK (0.40) | **OK (0.75)** | Single param at P=0.40 | output_format (mod10_plus1, 10 distinct structures) 2nd param |
| file_read | OK (0.80)→ | **OK (0.75)** | (stable) | skip_lines (mod10_plus1) 2nd param for robustness |
| search_text | WEAK (0.30) | WEAK (0.60) + 0.45 tool_calls | (2 params added in 8.6) | context_lines (mod10_plus1) mapping 1-10 → 0-9 lines |
| url_fetch | WEAK (0.30) | WEAK (0.50) | char_code_even → changed to field_count | field_count + content_preview (10-line stub body) |

---

## Note: fitness variation vs output variation

The 3 OK runners (compute, file_read, http_get) and most WEAK runners show OUTPUT sensitivity — their genome affects what data is returned. However, evolution loop FITNESS requires either correctness or tool_calls to vary.

Currently only search_text shows fitness_sensitivity > 0 (via tool_calls varying with max_results). The evolution loop has been validated on search_text (0.0 → 0.528 → 0.872 → 1.0 in 3 generations).

Wiring genome params to tool_calls for the other runners is deferred to Packet 8.8 as a "SHOULD FIX" — the current signal is sufficient for the leaderboard's first iteration.
