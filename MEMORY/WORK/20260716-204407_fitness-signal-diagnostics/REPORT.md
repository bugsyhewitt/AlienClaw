# Fitness-Signal Health — Diagnostic Verdict (2026-07-16)

**Question:** Does AlienClaw's production fitness formula give selection enough signal to drive evolution, or are tool runners blind to genome variation (the neutral-evolution risk)?

**Verdict: SIGNAL_PARTIAL** — fitness carries real, reproducible, selection-actionable signal, but on essentially **one channel (tool-call efficiency)**. The correctness channel is flat for 7 of 8 single-tool runners. Evolution is currently driven by *how few tool calls* a genome uses, not by *how correct* its output is. The strong "runners are blind to the genome" hypothesis is **refuted**.

Method: 3 parallel diagnostic agents (empirical audit / analytical modules / source forensics) → synthesis → 3 independent adversarial verifiers (all returned refuted=false). Two agents (analytical, forensics) hit structured-output failures; their load-bearing outputs were **re-derived and verified by hand** (below). Read-only; no production code changed.

## Production formula (verified in `src/alienclaw/fitness/function.py:23-33`)

```
fitness = clamp01(correctness × 1/(1 + α·max(0, tool_calls − slot_count))),  α = 0.1
```

Option C-prime (Packet 28). The first `slot_count` tool calls are free; each excess call applies a gentle 0.1 penalty. This **removed the old 1/k ceiling** — a perfectly-orchestrating k-slot composition now reaches `fitness = correctness`, not `1/k`. So the `fitness_ceiling` module's 1/k table (below) is **historical**, not a current constraint.

## Empirical audit (sensitivity_audit, local stub harness)

| Fact | Value | Source |
|---|---|---|
| Runners with genome passed through | 8/8 (24/24 rows incl. compositions) | a42.json, am.json |
| Rows classified BLIND | 0 | audit |
| `correctness_sensitivity` flat (=0.00) | 7/8 single-tool runners, both seeds | a42/a7.json |
| Only runner with correctness signal | `file_read` (0.85 @s42, 0.95 @s7) | a42/a7 |
| `fitness_sensitivity == tool_calls_sensitivity` | exactly, all 7 flat-correctness runners | a42/a7 |
| Mean `fitness_sensitivity` (tool runners) | 0.725 (s42) / 0.806 (s7) | a42/a7 |
| Composition Martians, correctness nonzero | 4/8 (up to 0.70 write_then_verify) | am.json |

**Methodological catch (verified `sensitivity_audit.py:245` vs `:435`):** the tool-runner auditor classifies on `output_sensitivity`, while the composition auditor classifies on `fitness_sensitivity` (thresholds BLIND≤0.2 / WEAK≤0.6 at `:36-37`). So the "8/8 OK" tool-runner headline measures **output diversity, not fitness health**. Reclassifying tool runners on the selection-relevant field (`fitness_sensitivity`) drops 3/8 to WEAK at seed 42 (search_text 0.55, url_fetch/web_search 0.60).

## Analytical battery (re-run by hand after agent failures)

- **Fixation regime (Kimura, production N=32; `fixation_theory`):** drift threshold 1/(2N) = **0.0156**. For the observed efficiency contrasts (s ≈ 0.10, one excess call vs typical), **P_fix = 0.18, regime = "selection", selection_acts = True**. The fitness gaps the efficiency channel produces are large enough that selection dominates drift at production population size.
- **Mutual information I(G;F) (`genome_information`, 320 audit samples, 36 unique fitness values):** global **max_byte_mi = 0.443 nats**, mean 0.0087, **6 of 256 bytes significant** (threshold 0.01). Signal exists but is **sparse**. Section breakdown: **identity_bytes_0-63 = 0.443, slot0_exec = 0.0, slot1_exec = 0.0, checksum = 0.0.** At byte level in this pooled dataset the *only* detectable genome→fitness signal is cross-martian-type identity; the behavior/EXECUTION bytes evolution actually mutates carry no isolable byte-level MI (their effect shows up in paired within-type `fitness_sensitivity` but is too diffuse for byte-MI at n=320).
- **Fitness ceiling (historical 1/k):** k=1→1.00, k=2→0.50, k=4→0.25, k=8→0.125. No longer binds under C-prime.
- **Plateau detector:** correctly flags a synthetic rising-then-flat curve (plateau gen 6-21).

## Residual gaps

1. **Flat correctness channel** at the single-tool level (0.00 for 7/8): selection gets almost no signal about output *quality*, only call *count*.
2. **Efficiency signal is conditional** on `tool_calls > slot_count`; where a composition already orchestrates near its slot budget (read_then_extract: fit 0.25 vs tc 0.85) even the healthy channel goes quiet.
3. **Output diversity ≠ selectable fitness:** output_sensitivity is 0.70-1.00 while correctness stays flat — genomes produce different-but-equally-correct outputs the formula can't rank.
4. **Byte-MI signal is cross-type only** (identity), not within-behavior — most of the genome is neutral w.r.t. fitness at byte granularity.
5. **Harness caveat:** all runs use local stub servers + tempdirs, not production tool backends; the flat-correctness finding is a stub-harness property, not a production measurement. Composition audit ran at seed 42 only.

## Recommendations (analysis/instrumentation, not production-logic changes)

1. Report the `fitness_sensitivity` classification for tool runners alongside the existing `output_sensitivity` one — the code already computes it; the current headline hides that 3/8 runners are WEAK on the channel that drives selection.
2. Log raw per-pair correctness *values* (not just "differs") to settle whether correctness is genuinely binary/constant or the two random genomes merely co-locate.
3. Quantify the `tool_calls`-vs-`slot_count` distribution per Martian — that gap is the precondition for any efficiency signal under C-prime.
4. Re-run the composition audit at ≥2 seeds; validate the flat-correctness finding against real tool backends before treating it as a production property.
5. **The design lever is correctness scoring, not runner instrumentation.** A flat correctness channel means evolution optimizes call-count; if the goal is task-quality improvement, that is the fitness/correctness owners' surface, not the runners'.

## Confidence

Verdict survived 3 independent adversarial verifiers (each re-ran the audit value-identically and read source), plus hand-verification of the two load-bearing source claims (formula, classification-field mismatch) and hand-execution of the entire analytical battery. Corrections applied from verification: headline scoped to "7/8 single-tool runners and half of compositions" rather than a blanket "correctness is flat" (file_read and write_then_verify carry correctness signal).
