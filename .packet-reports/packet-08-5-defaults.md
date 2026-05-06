# Packet 8.5 Defaults Chosen

| Default | Value | Rationale |
| --- | --- | --- |
| Pairs per runner | 10 | Sufficient to confirm BLIND (0/10 = 0.0); cheap to run (80 bridge calls total) |
| Default seed | 42 | Reproducible; arbitrary; matches Packet 8's experiment seed |
| BLIND threshold | ≤ 0.2 | Conservative — a runner that's different 1 in 5 pairs is weak signal, not no signal |
| WEAK threshold | ≤ 0.6 | Above BLIND, below reliable |
| OK threshold | > 0.6 | Reliable enough to act on |
| Diagnostics env var | `ALIENCLAW_DIAGNOSTICS=1` | Explicit opt-in; any other value = off |
| Stub server binding | 127.0.0.1, random port | Hermetic; no firewall issues; no port conflicts |
| Mutation rate for pair generation | 0.5 | High rate ensures genome sections are clearly different (audit needs variation) |
| Instrumentation hooks | record_genome, record_runner_call, record_runner_result, record_fitness | Covers the full data flow; minimal surface area |
| Classification labels | BLIND / WEAK / OK | Self-explanatory; maps to MUST FIX / SHOULD FIX / MAY ADDRESS |

## Override paths

- Pairs per runner: change `PAIRS_PER_RUNNER` constant in `sensitivity_audit.py`
- Thresholds: change `BLIND_THRESHOLD` / `WEAK_THRESHOLD` constants
- Default seed: pass `--seed N` to the CLI
- Stub responses: pass different `responses` dict to `StubServer()`
