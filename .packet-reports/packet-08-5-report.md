# Packet 8.5 Report — Tool-Runner Sensitivity Audit

**Started from:** commit 971b1e5a (packet-09 deploy log)  
**Completed:** 2026-05-06  
**Commits in packet:** 5

---

## Phases completed

| Phase | Deliverable | Commit |
| --- | --- | --- |
| 3 | Opt-in instrumentation + localhost stub server | `3eee9eca` |
| 4 | Sensitivity audit runner + report formatter | `71677a16` |
| 5 | Audit run (seed=42); raw data + report produced | `2b0beb43` |
| 7+8 | MINI-PACKET-8-6 spec + LESSONS update + CI | `40300ef7` |

Phase 6 (small fixes): N/A — all 4 MUST FIX items exceed the 20-line threshold.

---

## Primary deliverable: audit findings

**8/8 runners BLIND. 0/8 with any signal. All sensitivity scores: 0.00.**

See `.packet-reports/packet-08-5-audit-report.md` for full detail.

---

## New files

- `src/alienclaw/diagnostics/__init__.py`
- `src/alienclaw/diagnostics/instrumentation.py` — opt-in CaptureHook
- `src/alienclaw/diagnostics/stub_servers.py` — localhost HTTP stub
- `src/alienclaw/diagnostics/sensitivity_audit.py` — paired comparison runner
- `src/alienclaw/diagnostics/reporting.py` — markdown report formatter
- `src/alienclaw/diagnostics/__main__.py` — CLI
- `test/diagnostics/__init__.py`
- `test/diagnostics/test_instrumentation.py` (8 tests)
- `test/diagnostics/test_sensitivity_audit.py` (11 tests)
- `test/diagnostics/test_stub_servers.py` (5 tests)
- `.packet-reports/packet-08-5-audit-report.md` — primary deliverable
- `.packet-reports/packet-08-5-raw-data.json` — machine-readable data
- `.packet-reports/MINI-PACKET-8-6-genome-to-behavior.md` — follow-up spec

**Modified:**
- `src/alienclaw/bridge/server.py` — instrumentation hooks (opt-in, zero production cost when off)
- `docs/LESSONS_FROM_THE_ARC.md` — Packet 8.5 findings appended
- `.github/workflows/ci.yml` — diagnostics tests + leak detection added

---

## Test counts

| Suite | Tests | Status |
| --- | --- | --- |
| test_instrumentation.py | 8 | all pass |
| test_sensitivity_audit.py | 11 | all pass |
| test_stub_servers.py | 5 | all pass |
| **Total new** | **24** | all pass |
| Python total | 384 | 384 pass, 125 skip |

---

## Packet 10 readiness verdict: RED

All 4 MUST FIX items from the audit are structural and require Packet 8.6:

| Finding | Classification | Fix size |
| --- | --- | --- |
| Genome discarded after validation | MUST FIX | Large (Packet 8.6) |
| No machine-readable parameter_schema | MUST FIX | Large (Packet 8.6) |
| Binary correctness (1.0 / 0.0) | MUST FIX | Medium (Packet 8.6) |
| tool_calls always 1 | MUST FIX | Medium (Packet 8.6) |

The leaderboard (Packet 10) is gated on Packet 8.6. A leaderboard on zero-signal
fitness propagates noise across operators.

**Next step:** Execute MINI-PACKET-8-6-genome-to-behavior.md. Then re-run:
```bash
PYTHONPATH=src python3 -m alienclaw.diagnostics audit --seed 42
```
Success criterion: ≥3 runners with output_sensitivity > 0.2.

---

## Methodological note

This was bug class #2 in the arc: "infrastructure correct, signal dead."
The previous 7 bugs were all wrong-implementation bugs caught by code reading
or fixture comparison. This required a different technique: instrumented
paired-comparison experiments. Both techniques are now documented in
LESSONS_FROM_THE_ARC.md and both are now permanent infrastructure.
