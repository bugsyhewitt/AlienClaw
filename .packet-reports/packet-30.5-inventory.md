# Packet 30.5 — Working-Tree Inventory

## Summary (as of starting commit bf584f3e)

| Category | Count |
|----------|-------|
| Staged (none — all pre-staged files swept into Packet 29 commit) | 0 |
| Modified (unstaged) — .packet-reports/ deletions | ~85 |
| Modified (unstaged) — code/test/docs files | ~97 |
| Untracked — MEMORY/Work PRDs | 15 |
| Untracked — source/test/docs/seed | ~116 |
| **Total uncommitted changes** | **~313** |

## Breakdown by area

### .packet-reports/ deletions (85 files)
Old packet report files from packets 01-12 history (MINI-PACKET-8-6, all-files.txt,
branches.txt, clone-commit.txt, install-sh-dry-run.txt, npm-view-openclaw.txt,
old-ci.yml.txt, open-prs-raw.json, packets 01-02 reports, packets 07-12 reports,
packet-8.x series reports, pr-details.txt, recent-commits.txt).
**Attribution:** Various packets (cleanup of their audit history). These deletions
mean packet reports are being consolidated/removed from the committed tree.

### Deleted code files (39 files)
- `src/alienclaw/agents/employee.ts` — old file, superseded by subagent architecture (Packet 17)
- `src/alienclaw/bridge/runners/*.py` (12 files) — old bridge runner architecture, superseded by tools/ (Packets 22-24)
- `src/alienclaw/governance/*.ts` (14 files) — old flat governance structure, superseded by common/ (Packets 14-18)
- `src/alienclaw/governance/sync/*.ts` (5 files) — same as above
- `test/bridge/runners/test_web_search_backend.py` — superseded by test/tools/ (Packet 24)
- `test/governance/specialist/*.test.ts` (3 files) — superseded by subagent/ (Packet 17)

### Modified code files (58 files)
Core source files updated across Packets 14-28:
- governance/common/*.ts (3 modified — partially committed in P30)
- agents/*.ts (3 files — Packet 17-18 updates)
- api/server.py — API updates
- brains/parser.py, types.py — Packet 14-15 updates
- bridge/server.py — Packet 22-24 bridge refactor
- constants.ts, index.ts, wiring/ — various
- diagnostics/ (3 modified) — Packet 21
- evolution/ (3 modified) — Packets 25-27
- fitness/ (2 modified) — Packet 19
- genome/codec.py, operators.py — Packet 15
- msb/msb-loader.ts, msb-types.ts — MSB format updates
- registry/genome-codec.ts — registry updates
- types.ts — Campaign/Scheme types (Packet 17)
- test/* (many) — test updates matching source changes
- MEMORY/WORK PRDs (2) — packet 29, 30 PRDs with stale phase

### Untracked new files (131)
- MEMORY/WORK/ PRDs for packets 14-28 (15 files)
- docs/ARCHITECTURE.md, docs/MATHEMATICAL_FOUNDATIONS.md (new)
- docs/specs/SUBAGENT_*.md (3 files — Packet 17 Specialist→Subagent rename)
- `os` — 12MB PostScript junk file (DELETE)
- scripts/*.py (3 analysis scripts)
- seed/martians/*.martian + stubs/ (16 files — Packet 16)
- src/alienclaw/diagnostics/*.py (13 new files — Packet 21)
- src/alienclaw/evolution/migrations/ — Packet 25
- src/alienclaw/evolution/scale_experiment.py — Packet 25
- src/alienclaw/governance/common/subagent/*.ts (5 files — Packet 18)
- src/alienclaw/governance/hermes/README.md, openclaw/README.md (placeholder stubs)
- src/alienclaw/martians/*.py + *.ts (9 files — Packet 16)
- src/alienclaw/registry/genome-operators.ts
- src/alienclaw/tools/*.py (10 files — Packets 22-24)
- test/bridge/test_martian_dispatch.py
- test/diagnostics/*.py (14 files)
- test/evolution/*.py (3 files)
- test/fixtures/*.json (new) + test/fixtures/test-goals/*.json
- test/genome/test_step_mutation.py, test_xcode_helpers.py
- test/governance/subagent/*.test.ts (6 files — beyond the 3 in Packet 29 commit)
- test/integration/*.test.ts (2 files — explicitly skipped, safe to commit)
- test/martians/*.py + *.ts (7 files)
- test/tools/*.py (2 files)

## Files with no clear originating packet
- `os` — PostScript image, clearly junk (DELETE)
- `.coverage` — pytest coverage database (gitignore candidate, do NOT commit)
- `src/alienclaw/governance/hermes/README.md` — intentional placeholder stub (COMMIT)
- `src/alienclaw/governance/openclaw/README.md` — intentional placeholder stub (COMMIT)
