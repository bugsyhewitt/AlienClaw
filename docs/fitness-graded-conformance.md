# Graded correctness via output-contract conformance (compute)

## Problem

The 2026-07-16 fitness-signal diagnostic found **SIGNAL_PARTIAL**: evolution
optimized tool-call *efficiency* but not output *quality*, because **correctness was
binary** — every tool returned `correctness=1.0` (ran) or `0.0` (errored)
(`src/alienclaw/tools/*.py`), and a composition's correctness is `min()` of slots
(`bridge/server.py`). Two genomes that both ran cleanly both scored `1.0`, so
selection saw only the efficiency gradient (`correctness_sensitivity = 0.00` for
7/8 tool runners in the audit).

## Change

Grade a *successful* tool output by **output-contract conformance** — the fraction
of its MSB OUTPUT CONTRACT fields present and type-valid, in `[0,1]`. "Quality" here
means output completeness / well-formedness, NOT answer-accuracy (these
deterministic tools compute their own ground truth; there is no labeled task set).

Scoped to the **compute** Martian as a proving ground: its genome-controlled
`output_format` (1–5) emits 1/6 → 6/6 contract fields, so conformance varies with
the genome.

## Implementation
- **`src/alienclaw/fitness/conformance.py`** — `conformance_score(contract, output)`
  and `conformance_for(tool_name, output)` (compute-only registry; other tools
  return `None` → keep binary correctness). Extension path: parse each `.msb`'s
  OUTPUT CONTRACT block generically.
- **`bridge/server.py`** — a successful slot scores `conformance_for(tool, output)`
  when the tool has a registered contract, else its binary correctness; errored slot
  → `0.0`. `min()` aggregation and `fitness/function.py` (`correctness × efficiency`)
  unchanged.
- Correctness is scored **only** in the Python bridge; TS paths (leaderboard,
  reflective objectives) read the score, they don't re-derive it — so Martians stay
  interchangeable and the cross-language bridge-fixture conformance holds.

## Result (validated)
Re-running `python3 -m alienclaw.diagnostics audit --seed 42`: compute's
**`correctness_sensitivity` moved 0.00 → 0.75** — the correctness channel
un-flattened. Evolution now selects for more-complete, contract-conformant compute
outputs *in addition to* efficiency. `output_format=1` → correctness `1/6`;
`output_format=5` → `1.0`.

## Out of scope (future)
The other 7 tools' conformance; generic `.msb` contract parsing; answer-accuracy
grading (needs labeled task sets); efficiency-channel hardening.
