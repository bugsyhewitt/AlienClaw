# Packet 7 Deferred

| Item | Deferred to | Rationale |
| --- | --- | --- |
| Process pooling for bridge | v1.1+ | Measure first — one subprocess/summon is correct and simple |
| LLM-backed Martian execution | Packets 8-10 | Governance loop must be stable first |
| `url_fetch` / `http_get` live network tests | Packets 8-10 | Would require network mocking in CI |
| `web_search` real API integration | v0.2+ | DDG wrapper is best-effort; real API needs key management |
| Specialist workspace files (5-file structure) | v0.2+ | Spec describes concept; not needed for v1 governance |
| ALIENCLAW_PYTHON_BIN documented in ops guide | Ops guide | Low urgency; env var works as-is |
| Bridge streaming responses | v2.0+ | Request/response sufficient for v1.0 throughput |
