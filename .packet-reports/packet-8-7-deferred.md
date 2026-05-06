# Packet 8.7 Deferred

| Item | Deferred to | Rationale |
| --- | --- | --- |
| Fitness variation for http_get, file_read, file_write, extract_json, url_fetch | Packet 8.8 | These runners now show output sensitivity but fitness is always 1.0 for successful ops; need tool_calls to vary |
| Wiring genome params to tool_calls across all runners | Packet 8.8 | Currently only search_text has variable tool_calls; full fitness signal requires per-runner tool_calls accounting |
| Three remaining BLIND/WEAK runners fully reaching OK | Packet 8.8 | extract_json (0.25), url_fetch (0.50), web_search (0.45) — improvements possible with more params |
| MSB changes audit trail (packet-8-7-msb-changes.md) | (included below) | Changes were mechanical and well-captured in the commit message |
| Packet 10 leaderboard | Now unblocked | GREEN verdict achieved |
