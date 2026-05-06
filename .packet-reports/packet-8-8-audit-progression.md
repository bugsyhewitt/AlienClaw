# Packet 8.8 — Audit Progression

## Baseline (seed=42, Packet 8.7 state)

| Runner | output | correct | tool_calls | fitness | classification |
| --- | --- | --- | --- | --- | --- |
| compute | 0.75 | 0.00 | 0.00 | 0.00 | OK |
| extract_json | 0.25 | 0.00 | 0.00 | 0.00 | WEAK |
| file_read | 0.75 | 0.00 | 0.00 | 0.00 | OK |
| file_write | 0.55 | 0.00 | 0.00 | 0.00 | WEAK |
| http_get | 0.65 | 0.00 | 0.00 | 0.00 | OK |
| search_text | 0.60 | 0.00 | 0.45 | 0.45 | WEAK |
| url_fetch | 0.50 | 0.00 | 0.00 | 0.00 | WEAK |
| web_search | 0.45 | 0.00 | 0.00 | 0.00 | WEAK |

**Goal for 8.8:** All 8 runners: tool_calls_sensitivity > 0.0, fitness_sensitivity > 0.0

## Per-runner post-fix (seed=42)

| Runner | output | correct | tool_calls | fitness | change |
| --- | --- | --- | --- | --- | --- |
| file_write | 0.55 | 0.00 | 0.55 | 0.55 | 0.00 → 0.55 |
| compute | 0.75 | 0.00 | 0.30 | 0.30 | 0.00 → 0.30 |
| extract_json | 0.25 | 0.00 | 0.40 | 0.40 | 0.00 → 0.40 |
| file_read | 0.75 | 0.60 | 0.15 | 0.65 | 0.00 → 0.15 tc, 0.00 → 0.65 fit |
| http_get | 0.65 | 0.00 | 0.55 | 0.55 | 0.00 → 0.55 |
| url_fetch | 0.50 | 0.00 | 0.50 | 0.50 | 0.00 → 0.50 |
| web_search | 0.55 | 0.00 | 0.35 | 0.35 | 0.00 → 0.35 |

## Final (seed=42, all 8 runners fixed)

| Runner | output | correct | tool_calls | fitness | classification |
| --- | --- | --- | --- | --- | --- |
| compute | 0.75 | 0.00 | 0.30 | 0.30 | OK |
| extract_json | 0.25 | 0.00 | 0.40 | 0.40 | WEAK |
| file_read | 0.75 | 0.60 | 0.15 | 0.65 | OK |
| file_write | 0.55 | 0.00 | 0.55 | 0.55 | WEAK |
| http_get | 0.65 | 0.00 | 0.55 | 0.55 | OK |
| search_text | 0.60 | 0.00 | 0.45 | 0.45 | WEAK |
| url_fetch | 0.50 | 0.00 | 0.50 | 0.50 | WEAK |
| web_search | 0.55 | 0.00 | 0.35 | 0.35 | WEAK |

**Result: 8/8 runners have tool_calls_sensitivity > 0.0.** GREEN criterion met.
