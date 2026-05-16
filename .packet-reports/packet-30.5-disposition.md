# Packet 30.5 — Per-File Disposition

## Disposition buckets

- **DELETE**: stale intermediate from a superseded approach
- **COMMIT**: complete, correct, belongs to a known packet's scope
- **HOLD**: purpose unclear; needs Bugsy's input

## DELETE

| File | Reason |
|------|--------|
| `os` | 12MB PostScript junk image, no purpose in this repo |
| `src/alienclaw/agents/employee.ts` | Superseded by Subagent architecture (Packet 17) |
| `src/alienclaw/bridge/runners/*.py` (12 files) | Superseded by src/alienclaw/tools/ (Packets 22-24) |
| `src/alienclaw/governance/*.ts` + `governance/sync/*.ts` (19 files) | Old flat structure superseded by governance/common/ (Packets 14-18) |
| `test/bridge/runners/test_web_search_backend.py` | Superseded by test/tools/ |
| `test/governance/specialist/*.test.ts` (3 files) | Superseded by test/governance/subagent/ (Packet 17) |
| Old `.packet-reports/` history files (85 files) | Intentionally removing packet 01-12 report history from committed tree |
| `.coverage` | pytest artifact, should be in .gitignore; not committed |

## COMMIT — by group

### Group 1: Cleanup (deletes)
All DELETE-bucket files above. One commit.

### Group 2: Governance + Types (Packets 14-18)
- src/alienclaw/types.ts — Campaign, Scheme, SubagentRole types
- src/alienclaw/governance/common/subagent/*.ts (5 files) — decision engine, transition table, budget, fitness aggregator
- test/governance/subagent/budget.test.ts + decision-engine + fitness-aggregator + multi-martian + termination-reasons + transition-table (6 test files)
- Modified governance test files (boss-bot, advisor-bot, comm-graph, creator-bot, goal-loop, etc.)
- src/alienclaw/agents/*.ts modifications (agent-registry, bossbot, creatorbot)
- src/alienclaw/constants.ts, index.ts, wiring/hierarchy-bootstrap.ts
- src/alienclaw/governance/hermes/README.md, openclaw/README.md stubs
- src/alienclaw/registry/genome-operators.ts

### Group 3: Tools / Bridge refactor (Packets 22-24)
- src/alienclaw/tools/*.py (10 files — replacement for bridge/runners/)
- src/alienclaw/bridge/server.py (modified)
- test/tools/__init__.py + test/tools/test_web_search_backend.py
- test/bridge/test_martian_dispatch.py
- test/fixtures/bridge-fixture.json (modified)

### Group 4: Martians module (Packet 16)
- src/alienclaw/martians/*.py + *.ts (9 files)
- seed/martians/*.martian + stubs/ (16+ files)
- test/martians/*.py + *.ts (7 files)
- test/fixtures/martian-registry-fixtures.json + martian-substitution-fixtures.json

### Group 5: Diagnostics (Packet 21)
- src/alienclaw/diagnostics/*.py (13 new files + 3 modified)
- test/diagnostics/*.py (14 test files)

### Group 6: Evolution updates (Packets 25-27)
- src/alienclaw/evolution/*.py modifications (generation, types, __main__)
- src/alienclaw/evolution/migrations/*.py
- src/alienclaw/evolution/scale_experiment.py
- test/evolution/*.py (3 files)
- scripts/*.py (3 analysis scripts)

### Group 7: Genome / Brain / Fitness / API updates (Packets 14-15, 19)
- src/alienclaw/genome/codec.py, operators.py (modified)
- src/alienclaw/brains/parser.py, types.py (modified)
- src/alienclaw/fitness/function.py, types.py (modified)
- src/alienclaw/api/server.py (modified)
- src/alienclaw/msb/msb-loader.ts, msb-types.ts (modified)
- src/alienclaw/registry/genome-codec.ts (modified)
- test/genome/test_step_mutation.py, test_xcode_helpers.py (new)
- test/genome/test_fixtures.py, test_operators.py (modified)
- test/brains/test_fixtures.py (modified)
- test/fitness/test_fitness.py (modified)
- test/api/test_api_server.py (modified)
- test/fixtures/genome-spec-fixtures.json, brain-registry-fixtures.json (modified)
- seed/msb/*.msb (8 modified)

### Group 8: Docs/Specs (Packets 17, 21-23)
- docs/ARCHITECTURE.md (new)
- docs/MATHEMATICAL_FOUNDATIONS.md (new)
- docs/specs/SUBAGENT_FILE_FORMAT_v1_3_ADDENDUM.md (new)
- docs/specs/SUBAGENT_FILE_FORMAT_v1_4_ADDENDUM.md (new)
- docs/specs/SUBAGENT_SPEC.md (new)
- docs/specs/SPECIALIST_FILE_FORMAT_v1_1_ADDENDUM.md (modified — rename/update)
- docs/specs/SPECIALIST_SPEC.md (modified — rename/update)

### Group 9: Integration tests + fixtures (Packets 22-23)
- test/integration/end_to_end/realistic-goal.test.ts (new, skipped)
- test/integration/end_to_end/synthetic-goal.test.ts (new, skipped)
- test/fixtures/test-goals/*.json (2 files)

### Group 10: MEMORY/Work PRDs (packets 14-28)
- All 15 MEMORY/WORK/ PRD files for packets 14-28
- Modified MEMORY/WORK PRDs for packets 29-30

## HOLD

None — all files in the working tree have clear attribution and purpose.

## Summary

- DELETE: ~120 files
- COMMIT (Groups 1-10): ~193 files
- HOLD: 0
