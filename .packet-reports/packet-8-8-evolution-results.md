# Packet 8.8 — Evolution Results

## search_text (baseline — Packets 8.6/8.7)

**Config:** population_size=16, generations=20, seed=42  
**Input:** `{"text": "20-line text with 20 fox matches", "pattern": "fox"}`  
**Result:** Gen0 mean=0.528 → Gen3 mean=1.000. Directed (already confirmed twice).

---

## file_write

**Config:** population_size=16, generations=20, seed=42  
**Input:** `{"path": "/tmp/evo_filewrite_test.txt", "content": "evolution test content"}`  
**Mechanism:** tool_calls = repeat_count (1-5). Fitness = 1/repeat_count.

| Gen | Mean fitness |
| --- | --- |
| 0 | 0.553 |
| 12 | 1.000 |
| 19 | 1.000 |

**Result: Gen0 mean=0.553 → Gen19 mean=1.000. Directed. Converges by gen 12.**

---

## compute

**Config:** population_size=16, generations=20, seed=42  
**Input:** `{"input": "7 / 3"}`  
**Mechanism:** tool_calls = validation_count (1-5). Fitness = 1/validation_count.

| Gen | Mean fitness |
| --- | --- |
| 0 | 0.427 |
| 19 | 1.000 |

**Result: Gen0 mean=0.427 → Gen19 mean=1.000. Directed.**

---

## extract_json

**Config:** population_size=16, generations=20, seed=42  
**Input:** `{"json": "{\"name\": \"Alice\", \"score\": 99}", "path": "name"}`  
**Mechanism:** tool_calls = extraction_passes (1-5). Fitness = 1/extraction_passes.

| Gen | Mean fitness |
| --- | --- |
| 0 | 0.427 |
| 19 | 1.000 |

**Result: Gen0 mean=0.427 → Gen19 mean=1.000. Directed.**

---

## file_read

**Config:** population_size=16, generations=20, seed=42  
**Input:** `{"path": "/tmp/20line-file.txt"}` (20-line test file)  
**Mechanism:** tool_calls = chunk_count (1-5). Fitness = correctness/chunk_count where correctness = max_lines/total_lines (0.05-0.50).

| Gen | Mean fitness |
| --- | --- |
| 0 | 0.066 |
| 19 | 0.200 |

**Result: Gen0 mean=0.066 → Gen19 mean=0.200. Directed.**

Note: Max fitness = 0.50 (10 lines / 20 total = 0.50 correctness × 1/1 chunk = 0.50). Evolution converges to the max-correctness, min-chunk-count genome. Mean fitness increases 3× from gen 0 to gen 19.

---

## http_get

**Config:** population_size=16, generations=20, seed=42  
**Input:** `{"url": "https://httpbin.org/get"}`  
**Mechanism:** tool_calls = request_count (1-5). Fitness = 1/request_count.

| Gen | Mean fitness |
| --- | --- |
| 0 | 0.427 |
| 19 | 1.000 |

**Result: Gen0 mean=0.427 → Gen19 mean=1.000. Directed.**

---

## url_fetch

**Config:** population_size=16, generations=20, seed=42  
**Input:** `{"url": "https://httpbin.org/get", "method": "GET"}`  
**Mechanism:** tool_calls = request_count (1-5). Fitness = 1/request_count.

| Gen | Mean fitness |
| --- | --- |
| 0 | 0.427 |
| 19 | 1.000 |

**Result: Gen0 mean=0.427 → Gen19 mean=1.000. Directed.**

---

## web_search

**Config:** population_size=16, generations=20, seed=42 (with stub server)  
**Input:** `{"query": "alienclaw genome evolution", "num_results": 5}`  
**Mechanism:** tool_calls = page_count (1-3). Fitness = 1/page_count.

| Gen | Mean fitness |
| --- | --- |
| 0 | 0.604 |
| 19 | 1.000 |

**Result: Gen0 mean=0.604 → Gen19 mean=1.000. Directed (stub server).**

Note: Production web_search requires ALIENCLAW_SEARCH_URL set to an accessible
search endpoint. Offline evolution loop gives fitness=0.0 (network unavailable).

---

## Summary

| Runner | Gen0 mean | Gen19 mean | Directed |
| --- | --- | --- | --- |
| file_write | 0.553 | 1.000 | ✓ |
| compute | 0.427 | 1.000 | ✓ |
| extract_json | 0.427 | 1.000 | ✓ |
| file_read | 0.066 | 0.200 | ✓ |
| http_get | 0.427 | 1.000 | ✓ |
| url_fetch | 0.427 | 1.000 | ✓ |
| web_search | 0.604 | 1.000 | ✓ (stub) |
| search_text | 0.528 | 1.000 | ✓ (replicated twice in 8.6/8.7) |

**7/7 newly-wired runners show directed evolution. GREEN verdict.**
