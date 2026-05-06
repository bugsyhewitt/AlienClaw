# Packet 8.7 Report — Per-Runner Sensitivity Remediation

**Started from:** commit bb569d28 (packet-8-6 reports)  
**Completed:** 2026-05-06  
**Commits in packet:** 3

---

## Primary deliverable

GREEN verdict achieved: 0 BLIND, 3 OK, 5 WEAK.

| Runner | Before 8.7 | After 8.7 |
| --- | --- | --- |
| compute | WEAK (0.40) | **OK (0.75)** |
| extract_json | BLIND (0.20) | WEAK (0.25) |
| file_read | OK (0.80) | **OK (0.75)** |
| file_write | BLIND (0.20) | WEAK (0.55) |
| http_get | BLIND (0.10) | **OK (0.65)** |
| search_text | WEAK (0.30) | WEAK (0.60) + tool_calls 0.45 |
| url_fetch | WEAK (0.30) | WEAK (0.50) |
| web_search | BLIND (0.00) | WEAK (0.45) |

GREEN criteria:
- ≥7 WEAK-or-above: 8/8 ✓
- ≥3 OK: 3/8 (compute, file_read, http_get) ✓

**Packet 10 readiness: GREEN.** The leaderboard ships next.

---

## Commits

| Commit | Change |
| --- | --- |
| `b86948e6` | Per-runner sensitivity remediation — all runner changes, MSB updates, audit updates |
| `f74ffaae` | Docs + reports: directed-evolution milestone + three-techniques framing |

---

## Root cause summary

All 4 BLIND runners shared the same root cause: `char_code_even` bool encoding gave P(value changes per pair) ≈ 0.25, putting them at the BLIND threshold with variance. The fix: change to int encodings (mod5_plus1, mod10_plus1) with 5-10 distinct values giving P ≈ 0.40-0.45, and add second independent params to push combined P > 0.60.

Additional fixes:
- web_search: added ALIENCLAW_SEARCH_URL env var override; audit stub serves 15 results
- compute: output_format param with 10 truly distinct structures (not 3 mapped from 10)
- Audit: RNG isolation (per-runner sub-RNGs), PAIRS_PER_RUNNER 10→20
- Stub body: expanded to 12 lines so url_fetch content_preview 1-10 gives distinct outputs

---

## Evolution evidence

The directed evolution curve was replicated: search_text with 20-match text, seed=42:
- Generation 0: mean fitness = 0.528 (initial eval, max_results 1-10 in population)
- Generation 1: mean fitness = 0.872
- Generation 2: mean fitness = 1.000 (converged to max_results=1 genomes)

This is the SECOND confirmation of the directed-evolution finding (Packet 8.6 was first).

---

## What's deferred

- Fitness variation for http_get, file_read, file_write, extract_json, url_fetch (their genome affects output structure but not tool_calls, so fitness is binary 1.0/0.0)
- Packet 8.8 would wire genome params to tool_calls for more runners
- Packet 10 ships with the current signal — search_text evolution is validated, other runners rank by SUCCESS RATE
