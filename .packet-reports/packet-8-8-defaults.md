# Packet 8.8 — Defaults

## Three architectural decisions logged (per spec)

### 1. Per-runner tool_calls accounting designed before implementation

Design doc `packet-8-8-runner-design.md` was written in Phase 2 BEFORE any code changes.
It documents the tool_calls driver, correctness heuristic, and expected sensitivity for
each runner. Implementation followed the design without deviation.

### 2. Graded correctness only where it doesn't hurt directed evolution

Correctness gradients were only added where `fitness = correctness/tool_calls` produces
a non-constant fitness distribution across genomes. file_read gets graded correctness
(lines_returned/total_lines) because max_lines is genome-derived. Other runners stay
binary because adding graded correctness would make fitness = constant (not directed).

### 3. Audit re-run after every runner commit

The audit was re-run (full 8-runner, seed=42) after each runner was committed.
Results were confirmed before proceeding to the next runner. See audit-progression.md.

## New parameter defaults

| Runner | Param | Default | Range | Why default=1 |
| --- | --- | --- | --- | --- |
| file_write | repeat_count (existing) | 1 | 1-5 | min tool_calls = best fitness |
| compute | validation_count | 1 | 1-5 | min tool_calls = best fitness |
| extract_json | extraction_passes | 1 | 1-5 | min tool_calls = best fitness |
| file_read | chunk_count | 1 | 1-5 | min tool_calls = best fitness |
| http_get | request_count | 1 | 1-5 | min tool_calls = best fitness |
| url_fetch | request_count | 1 | 1-5 | min tool_calls = best fitness |
| web_search | page_count | 1 | 1-3 | min tool_calls = best fitness |

All defaults are 1 (minimum). The evolution loop finds genomes that decode to 1 as
the fitness-maximizing optimum. Default=1 means out-of-the-box (no genome) behavior
is also optimal.
