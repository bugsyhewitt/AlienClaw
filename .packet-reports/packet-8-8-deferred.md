# Packet 8.8 — Deferred Items

## Nothing deferred — all 7 runners reached directed evolution

All 7 newly-wired runners show:
- tool_calls_sensitivity > 0.0 in sensitivity audit
- Gen19 mean fitness > Gen0 mean fitness in 20-generation evolution loop

## Notes on runners that hit min fitness ceiling

### file_read
Gen19 max fitness = 0.200 (not 1.000) because correctness is capped at 0.50
(max_lines=10 from mod10_plus1 / total_lines=20). The leaderboard will rank file_read
genomes on fitness in [0, 0.5] range. To increase ceiling: either increase test file
size beyond 20 lines, or wire max_lines to a higher range encoding.

### web_search
Evolution loop requires ALIENCLAW_SEARCH_URL to be set. Without it, all genomes
get fitness=0.0 (network unavailable). This is expected offline behavior — not a bug.
Leaderboard data for web_search comes from real operator installs with network access.

## Possible future work (Packet 8.9+ candidates)

1. **Graded correctness for compute**: wire to output_quality (how close result is to
   expected — needs ground-truth answers in inputs).
2. **Status-code graded correctness for http_get/url_fetch**: route to stub endpoints
   returning 4xx/5xx based on URL path to produce correctness gradients.
3. **extract_json with multi-path inputs**: accept `paths` (list) and score on
   found/requested — natural graded correctness without artificial passes.
4. **Increase file_read correctness ceiling**: use max_lines encoding with larger range
   or larger test files so correctness can reach 1.0.
