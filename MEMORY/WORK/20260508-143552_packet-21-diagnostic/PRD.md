---
task: packet 21 read then extract diagnostic investigation
slug: 20260508-143552_packet-21-diagnostic
effort: advanced
phase: complete
progress: 28/28
mode: interactive
started: 2026-05-08T14:35:52Z
updated: 2026-05-08T14:50:00Z
---

## Context

Packet 21 diagnoses read_then_extract's WEAK fitness sensitivity (0.25 from Packet 19).

### Phase-2 findings (pre-work already done)

**Root cause identified through code analysis + experiment:**

1. The stub file (`test_read_extract.json`) is a SINGLE-LINE JSON file
2. file_read's `skip_lines` parameter (range [0,9]) maps to genome Xcodes
3. With random genomes: skip_lines distribution roughly uniform across [0,9]
4. The code: `skip = max(0, skip_lines - 1)` means:
   - skip_lines=0 or 1 → NO lines skipped (lines read: 1)
   - skip_lines=2-9 → 1-8 lines skipped (on a 1-line file → empty content)
5. With 1-line file: ~20% of genomes have skip_lines≤1 (succeed), ~80% fail
6. **Empirically confirmed**: 10/40 random genome evaluations succeed (25% match)
7. Fitness sensitivity = ~25% = fraction of pairs that straddle the boundary

**Wiring is CORRECT**: `${slot[0].output.content}` → `json` is the right mapping.
extract_json correctly uses `inputs.get("json", inputs.get("input", ""))`.

**Fundamental compositional insight**: file_read truncation/skipping produces
INCOMPLETE JSON that extract_json can't parse. Even with a 20-line file, any
truncation breaks JSON validity. The composition has a structural mismatch:
file_read's genome-driven parameters (skip_lines, max_lines) aren't compatible
with extract_json needing complete, valid JSON input.

### Phase ordering
- Phase 3 (stub override): Test if bypassing file_read's truncation by providing
  pre-computed content reveals extract_json's own parameter sensitivity
- Phase 4 (wiring): ALREADY CONFIRMED CORRECT — skip or document as verified
- Phase 5 (composition): Document the structural mismatch finding

### Expected outcomes
- Phase 3 stub: extract_json's result_format parameter (range [1,3]) SHOULD create
  sensitivity if it gets valid JSON input. If classification improves → stub realism
  was CONTRIBUTING but compositional issue is the primary cause.
- If Phase 3 doesn't help → extract_json also lacks sensitivity → deeper compositional issue

## Criteria

### Baseline document
- [x] ISC-1: `.packet-reports/packet-21-baseline.md` — raw data + code analysis findings

### Phase 3: Stub realism
- [x] ISC-2: `seed/martians/stubs/read_then_extract.stub.yaml` written with pre-computed content
- [x] ISC-3: Stub provides valid JSON in `content` field to bypass file_read truncation
- [x] ISC-4: Audit re-run with override; per-metric sensitivities captured
- [x] ISC-5: `.packet-reports/packet-21-stub-realism.md` — before/after comparison, verdict

### Phase 4: Wiring verification
- [x] ISC-6: `.packet-reports/packet-21-wiring.md` — wiring confirmed correct (no patch)

### Phase 5: Compositional analysis
- [x] ISC-7: Quantify: with pre-computed stub, does extract_json show sensitivity?
- [x] ISC-8: Document the structural mismatch: truncation → invalid JSON
- [x] ISC-9: `.packet-reports/packet-21-composition.md` — analysis + deferred recommendation

### Verdict
- [x] ISC-10: `.packet-reports/packet-21-verdict.md` — CAUSE-FOUND with appropriate sub-verdict
- [x] ISC-11: Recommended follow-up structure in packet-21-deferred.md

### Reports
- [x] ISC-12: `.packet-reports/packet-21-report.md`
- [x] ISC-13: `.packet-reports/packet-21-bugs.md`
- [x] ISC-14: `.packet-reports/packet-21-deferred.md`
- [x] ISC-15: `.packet-reports/packet-21-defaults.md`
- [x] ISC-16: `docs/LESSONS_FROM_THE_ARC.md` appended

### Verification
- [x] ISC-17: `PYTHONPATH=src python -m pytest test/ -q --tb=no` ≥668 passed
- [x] ISC-18: `npm run typecheck` exits 0

### Anti-criteria
- [x] ISC-A1: No .msb files modified
- [x] ISC-A2: Only read_then_extract.martian may be modified (wiring is correct, no change)
- [x] ISC-A3: Packet 19 raw audit data unchanged
- [x] ISC-A4: No genome/bridge/evolution/governance code modified

## Decisions

- Root cause: BOTH stub realism (1-line file) AND compositional (truncation breaks JSON validity)
- Phase 3: stub override bypasses file_read truncation to test extract_json's own sensitivity
- Phase 4: wiring is correct — document as verified, no patch
- Phase 5: structural mismatch — document, defer redesign to future research packet
- Verdict expected: CAUSE-FOUND-DEFERRED (compositional) with stub-realism as contributing factor

## Verification
