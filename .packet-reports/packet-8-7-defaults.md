# Packet 8.7 Defaults Chosen

| Default | Value | Rationale |
| --- | --- | --- |
| PAIRS_PER_RUNNER | 20 (was 10) | Lower variance; expected sensitivities of 0.40-0.75 become stable classifications |
| Audit RNG isolation | Per-runner sub-RNG seeded from main RNG | Changing PAIRS_PER_RUNNER doesn't affect other runners' genome pairs |
| Int encoding preference | mod5_plus1 or mod10_plus1 over char_code_even | P(change per pair) = 0.40-0.45 vs 0.25 for bool; worth 5-10× more distinct values |
| Second param encoding for WEAK→OK | mod10_plus1 (10 values) | Maximum P(value changes | byte changes) = 9/10 = 0.90; combined P(two params differ) ≈ 0.67 |
| Stub body lines | 12 (was 3) | content_preview 1-10 all produce distinct outputs; 12-line body gives room for 12 values |
| Stub search results | 15 (was 1) | max_results (1-10) actually truncates; sensitivity from truncation is real |
| ALIENCLAW_SEARCH_URL | env var override (unset = DDG) | Hermetic audit; production path unchanged; same pattern as ALIENCLAW_DIAGNOSTICS |

## Override paths

- PAIRS_PER_RUNNER: change constant in sensitivity_audit.py
- Second params: add more entries to MSB PARAMETER_SCHEMA + wire in runner
- Stub body size: change _multiline_body in run_audit()
- Per-runner RNG isolation: the main seed still determines all sub-seeds deterministically
