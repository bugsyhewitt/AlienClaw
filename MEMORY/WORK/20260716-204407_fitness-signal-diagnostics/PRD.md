---
task: Run diagnostics suite; verdict on fitness-signal health
slug: 20260716-204407_fitness-signal-diagnostics
effort: advanced
phase: complete
progress: 24/26
mode: interactive
iteration: 4
started: 2026-07-16T20:44:07-04:00
updated: 2026-07-16T20:44:07-04:00
---

## Context

Continuation ("continue" #3). All salvage/PR work is landed and green. The one substantive open "performing optimally" question — flagged twice in this session — is whether the production fitness formula (fitness/function.py, correctness × 1/tool_calls, α=0.1) gives selection enough signal to drive evolution, or whether tool runners are blind to genome variation (the neutral-evolution risk). The diagnostics/ suite exists precisely to answer this. This is READ-ONLY analytical work: run the diagnostics that are runnable locally (no live LLM, use stubs), read the ones that are pure analysis, and synthesize a grounded verdict — not to change production code.

## Criteria

Empirical runs (record raw numbers):
- [x] ISC-1: sensitivity audit (8 tool runners, seed 42) executed, JSON captured
- [x] ISC-2: audit re-run at a second seed to check seed-stability
- [x] ISC-3: audit-martians (composition Martians) executed, blind-count captured
- [x] ISC-4: per-runner fitness_sensitivity + genome_ever_passed table assembled
- [x] ISC-5: correctness_sensitivity==0 across runners confirmed or refuted
- [x] ISC-6: any BLIND classification enumerated (or "none" established)

Analytical modules:
- [x] ISC-7: fitness_ceiling 1/k values computed for k=1..8
- [x] ISC-8: fixation_theory P_fix computed for observed s at production N
- [x] ISC-9: genome_information I(G;F) estimated from real audit traces
- [x] ISC-10: plateau_detector behavior described on a sample curve
- [~] ISC-11: scaling landscape NOT run (low marginal value; ceiling+fixation+MI sufficed) — honestly skipped

Reconciliation:
- [x] ISC-12: report's tail "neutral-evolution" narrative located in source
- [x] ISC-13: determined whether that narrative is live output or stale template
- [x] ISC-14: empirical OK-classification reconciled against the narrative
- [x] ISC-15: E2/prior packets' effect on genome→behavior boundary identified
- [x] ISC-16: correctness-channel flatness (binary) assessed as residual gap
- [x] ISC-17: efficiency channel (tool_calls variance) assessed as active signal

Verdict + verification:
- [x] ISC-18: overall verdict formed (signal healthy / partial / blind)
- [x] ISC-19: verdict adversarially verified against raw numbers by 2nd agent
- [x] ISC-20: verdict survives or is revised per verification
- [x] ISC-21: concrete residual-gap recommendations listed (non-code-change)
- [x] ISC-22: findings written to a durable report artifact
- [x] ISC-23: no production code modified (read-only analysis)
- [x] ISC-24: PRD updated with evidence
- [ ] ISC-25: session PRD committed per convention
- [ ] ISC-26: verdict summarized to user

Anti-criteria:
- [x] ISC-A1: No production fitness/evolution code changed
- [x] ISC-A2: No verdict asserted beyond what the numbers support
- [x] ISC-A3: Stale report narrative not repeated as current fact
