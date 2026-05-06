# Packet 8.6 — Per-Runner Correctness + tool_calls Design (Phase D.1)

Phase D.2 is deferred to Packet 8.7. The current params already produce non-zero sensitivity and working evolution. This document captures the design for future completion.

## Current state per runner

| Runner | Correctness | tool_calls | Fitness varies? |
| --- | --- | --- | --- |
| compute | 1.0 (success) / 0.0 (fail) | Attempt number (1-5) | Only if expression fails |
| extract_json | 1.0 / 0.0 | Always 1 | No |
| file_read | 1.0 / 0.0 | Always 1 | No |
| file_write | 1.0 / 0.0 | Always 1 | No |
| http_get | 1.0 / 0.0 | Always 1 | No |
| search_text | 1.0 | min(max_results, match_count) | YES via tool_calls |
| url_fetch | 1.0 / 0.0 | Always 1 | No |
| web_search | 1.0 (results) / 0.5 (empty) | Always 1 | Only if no results |

## Proposed graded correctness (Packet 8.7)

### compute
- Current: binary (1.0 success / 0.0 fail)
- Proposed: remain binary. Compute is correct or wrong; there's no partial compute.
- tool_calls: already variable via max_attempts retry

### extract_json
- Current: binary
- Proposed: 1.0 if all requested paths found; 0.5 if partial path found; 0.0 if not found
- tool_calls: 1 (no retry makes sense for JSON extraction)

### file_read
- Current: binary
- Proposed: 1.0 full read; `lines_read / max_lines` if truncated
- tool_calls: 1 (single read)

### file_write
- Current: binary
- Proposed: remain binary (write succeeds or fails)
- tool_calls: 1 + (1 if created parent dir), so range 1-2

### http_get
- Current: binary
- Proposed: status-graded: 1.0 for 2xx, 0.7 for 3xx, 0.3 for 4xx, 0.0 for 5xx/error
- tool_calls: 1 (no redirect counting yet; Packet 8.7+)

### search_text
- Current: 1.0 (working as intended)
- Proposed: add min-matches correctness: `min(1.0, match_count / requested_min_matches)` where requested_min_matches comes from inputs
- tool_calls: already variable (current implementation) ✓

### url_fetch
- Proposed: same as http_get (status-graded correctness)

### web_search
- Proposed: 1.0 if results returned; 0.0 if network error; 0.5 if no results for query
