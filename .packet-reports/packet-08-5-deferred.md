# Packet 8.5 Deferred

| Item | Deferred to | Rationale |
| --- | --- | --- |
| All 4 MUST FIX items | Packet 8.6 | All exceed 20-line threshold; full spec in MINI-PACKET-8-6-genome-to-behavior.md |
| Packet 10 leaderboard | Gated on Packet 8.6 | Zero-signal fitness makes leaderboard meaningless |
| Per-field sensitivity (within runner) | Packet 8.6 | No parameter_schema exists yet; audit measured at runner level |
| TypeScript sensitivity audit | Packet 8.6 | Only Python bridge was audited; TS side also needs decoder |
| Network runner sensitivity (http_get etc.) | Packet 8.6 | Currently BLIND because genome never reaches runner; will improve after Fix #1 |
| Graded correctness design per runner | Packet 8.6 Phase D | Needs case-by-case analysis per runner type |
| Multiple parallel experiments (different seeds) | Future | Single seed=42 is sufficient for the binary BLIND finding |
| Sensitivity dashboard / continuous tracking | Future | Overkill for v1.0; audit CLI + manual re-run is sufficient |
