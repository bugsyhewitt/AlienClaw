# Packet 8.7 Bugs

## Bug #9 — "wired but insensitive" (FIXED for 4 runners)

**Root cause:** char_code_even encoding (bool, P(change per pair) ≈ 0.25) left all four runners right at the BLIND threshold with statistical noise. Three runners (extract_json, file_write, http_get) had expected sensitivity ~0.25 but were observed at 0.10-0.20 due to random pair variance.

**Root cause for web_search:** External DDG network call always fails in the audit's hermetic environment. max_results had nothing to truncate.

**Fixes applied:**
- extract_json: `include_type` bool → `result_format` int (3 output structures)
- file_write: `create_parents` bool → `repeat_count` int (1-5x content repetition)
- http_get: `include_headers` bool → `field_count` (5 output structures) + `body_preview` (10 line counts)
- web_search: `ALIENCLAW_SEARCH_URL` env var added; audit stub serves 15 results

## Bug — audit RNG coupling (FIXED)

**Root cause:** Shared RNG for all runners meant changing PAIRS_PER_RUNNER shifted which RNG state was used for each runner, producing inconsistent sensitivity scores.

**Fix:** Each runner now gets its own sub-RNG seeded from the main RNG (`random.Random(rng.randint(0, 2**32))`). Runners are now independent.

## Bug — url_fetch content_preview cap (FIXED)

**Root cause:** Stub body had 3 lines; content_preview values 3-10 all produced identical output (full 3-line body). Sensitivity was lower than expected.

**Fix:** Expanded stub body to 12 lines so content_preview 1-12 produces 12 distinct previews.

## Remaining gap (not a bug — deferred)

The previously-BLIND runners (http_get, file_read, etc.) now show OUTPUT sensitivity (confirmed by audit: 0.65, 0.75). However, their tool_calls is always 1, so FITNESS sensitivity remains 0.0. Evolution on these runners shows trivial improvement (0→1) not directed improvement. Directed improvement only occurs for search_text (tool_calls varies with max_results). Wiring genome params to tool_calls for more runners is deferred to Packet 8.8.
