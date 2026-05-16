---
task: packet 26 composition fitness ceiling diagnostic
slug: 20260509-210000_packet-26-composition-ceiling
effort: comprehensive
phase: complete
progress: 78/78
mode: interactive
started: 2026-05-09T21:00:00Z
updated: 2026-05-09T23:30:00Z
---

## Context

Diagnosed why 2-slot composition Martians plateau at fitness=0.500 in Packet 25.

### Phase 2 findings (code reading confirmed H1 immediately)

Fitness formula (fitness/function.py): `fitness = correctness × (1/tool_calls)`
For 2-slot perfect execution: `1.0 × (1/2) = 0.500`. H1 confirmed algebraically.

Decoder (brains/decoder.py): `base = slot_index * 64 + 1 + xcode_index * 2`
Slot 0 → bytes 65-126; Slot 1 → bytes 129-190. Distinct sections. H3 disproven.

### Results

- **H3 DISPROVEN**: Decoder uses distinct genome sections per slot. No bug.
- **H1 CONFIRMED**: Formula ceiling 1/k for k-slot compositions (k=2 → 0.500).
- **H2 PARTIALLY DISPROVEN**: MI of 0.6-1.1 nats exists at failure/success boundary.
  Selection acts strongly (s=0.4-6.6). Within ceiling zone, MI=0 and s=0 (neutral).

## Criteria

### Pre-flight
- [x] ISC-1: `packet-26-starting-commit.txt` written
- [x] ISC-2: Pre-26 baseline ≥705 pytest, tsc exits 0

### H3 — Decoder audit module
- [x] ISC-3–10: `composition_decoder_audit.py` created, tested (8 cases)

### H3 — report
- [x] ISC-11–13: `packet-26-h3-decoder-audit.md` — H3 DISPROVEN

### H1 — Fitness formula module
- [x] ISC-14–21: `fitness_ceiling.py` created, tested (13 cases in fitness_ceiling test file)

### H1 — proof report
- [x] ISC-22–26: `packet-26-h1-formula-proof.md` — H1 CONFIRMED algebraically

### H2 — MI module
- [x] ISC-27–33: `genome_information.py` created, tested (11 cases)

### H2 — per-genome capture
- [x] ISC-38–41: `per_genome_capture.py` created, tested

### H2 — MI experiments
- [x] ISC-42–44: All 3 compositions captured (1500 records each)

### H2 — MI report
- [x] ISC-45–47: `packet-26-h2-mutual-information.md` — H2 partially disproven

### Fixation analysis module
- [x] ISC-48–54: `fixation_theory.py` created, tested (14 cases)

### Fixation report
- [x] ISC-55–59: `packet-26-fixation-analysis.md` — selection acts, neutral at ceiling

### Verdict + synthesis
- [x] ISC-60–65: `packet-26-verdict.md` — H1 confirmed, Packet 25 claim corrected

### Tests
- [x] ISC-66–71: All 52 new tests pass

### Final
- [x] ISC-72–78: All reports written, LESSONS updated, 757 pytest passed, tsc exits 0

### Anti-criteria
- [x] ISC-A1–A6: All locked subsystems untouched

## Decisions

- H3 disproven algebraically before even running audit
- H1 confirmed via algebraic proof of formula
- H2 investigated to characterize the two-zone fitness landscape
- Formula revision deferred to Packet 27

## Verification

757 Python tests passed. tsc --noEmit exits 0.
