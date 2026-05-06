# Packet 8.6 Deferred

| Item | Deferred to | Rationale |
| --- | --- | --- |
| Graded correctness per runner (Phase D) | Packet 8.7 | Not needed for success criteria — binary correctness + tool_calls already drives evolution |
| Status-graded correctness for http_get/url_fetch | Packet 8.7 | Phase D.1 design already written in packet-8-6-runner-design.md |
| web_search sensitivity | Packet 8.7 | Requires stub server awareness in the web_search runner, or a mock URL override param |
| extract_json, file_write, http_get sensitivity improvement | Packet 8.7 | Better encoding choices (not char_code_even which has low P(differ)) |
| Cross-language decoder in TypeScript | Packet 8.7 | Python decoder runs in bridge; TS governance doesn't decode. Decoder fixture coverage deferred |
| decoder-fixtures.json | Packet 8.7 | Defined in the mini-packet spec but not blocking — Python tests exercise decoder directly |
| Additional params per runner (>1 per runner) | Packet 8.7 | Each runner only has 1 runner-specific param in v1.0; BEHAVIOR bytes 2-63 are available |
