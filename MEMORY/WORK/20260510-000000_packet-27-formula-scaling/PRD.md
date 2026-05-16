---
task: packet 27 fitness formula scaling research
slug: 20260510-000000_packet-27-formula-scaling
effort: comprehensive
phase: complete
progress: 72/72
mode: interactive
started: 2026-05-10T00:00:00Z
updated: 2026-05-10T03:00:00Z
---

## Context

Tested three candidate fitness formulas at k=2, 4, 8 to replace the current 1/k ceiling.
All three pass. Option C-prime (α=0.1) recommended for Packet 28 adoption.

### Key finding

Option C-prime: `fitness = correctness / (1 + 0.1 × max(0, tool_calls - slot_count))`
- Perfect execution → fitness = correctness (no ceiling, any k)
- Scale-invariant multiplicative excess penalty
- Best: 0.849 final fitness on search_then_count (vs 0.306 for current)

### Bayesian optimization result

Best α = 0.1 (gentle penalty). Best β = 0.1 (gentle penalty). Small hyperparameters
→ smooth gradients → better evolutionary dynamics.

## Criteria

All 72 ISC satisfied. All 64 new tests pass. 821 total Python tests pass. tsc exits 0.
5 new modules built. 9 analytical reports written. LESSONS updated.

## Verification

821 Python tests passed. tsc --noEmit exits 0.
