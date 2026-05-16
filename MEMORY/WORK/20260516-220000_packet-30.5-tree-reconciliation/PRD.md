---
task: Packet 30.5 reconcile working tree CI green honestly
slug: 20260516-220000_packet-30.5-tree-reconciliation
effort: deep
phase: execute
progress: 0/65
mode: interactive
started: 2026-05-16T22:00:00Z
updated: 2026-05-16T22:05:00Z
---

## Context

Packet 30.5 reconciles the local working tree which has ~313 uncommitted changes
(124 deleted, 58 modified, 131 untracked) from Packets 14-28 that were staged but
never committed. Root cause: prior packets ran `git add` but exited without committing;
the staging area accumulated across packets; the Packet 29 audit commit swept the
staged files. The tree IS locally coherent (402 tests pass, tsc clean) — the issue is
that the commits don't exist. This packet attributes files to their originating packets
in scoped commits — NO bulk "ship the arc" commit.

### Risks
- Some files may belong to packets whose intent is unclear without reading full PRDs
- Bridge/runner → tools/ migration may have test dependencies not obvious at surface level
- The specialist→subagent rename spans multiple docs/specs files; must all move together
- `os` file (12MB PostScript image, junk) must be deleted before any tests reference it

## Criteria

### Pre-flight
- [ ] ISC-1: Starting commit recorded in packet-30.5-starting-commit.txt
- [ ] ISC-2: Full backup taken (includes working tree state)
- [ ] ISC-3: packet-30.5-inventory.md produced with exhaustive file list
- [ ] ISC-4: packet-30.5-packet29-trace.md produced with factual protocol finding
- [ ] ISC-5: packet-30.5-disposition.md produced with per-file decisions

### Cleanup (DELETE bucket)
- [ ] ISC-6: Old .packet-reports/ deletion (85 files from packets 01-12 history) committed
- [ ] ISC-7: Old bridge/runners/ Python files deleted (12 files, superseded by tools/)
- [ ] ISC-8: Old flat governance/ TypeScript files deleted (14 files, superseded by common/)
- [ ] ISC-9: Old specialist/ test files deleted (3 files, superseded by subagent/)
- [ ] ISC-10: employee.ts deleted
- [ ] ISC-11: test/bridge/runners/test_web_search_backend.py deleted (superseded)
- [ ] ISC-12: `os` file (12MB PostScript junk) deleted
- [ ] ISC-13: All deletes committed in one attributed cleanup commit

### Governance + types (Packets 14, 17, 18)
- [ ] ISC-14: src/alienclaw/types.ts committed (Campaign.subagents type — Packet 17)
- [ ] ISC-15: src/alienclaw/governance/common/subagent/*.ts (5 files) committed (Packet 18)
- [ ] ISC-16: test/governance/subagent/budget.test.ts committed
- [ ] ISC-17: test/governance/subagent/decision-engine.test.ts committed
- [ ] ISC-18: test/governance/subagent/fitness-aggregator.test.ts committed
- [ ] ISC-19: test/governance/subagent/multi-martian.test.ts committed
- [ ] ISC-20: test/governance/subagent/termination-reasons.test.ts committed
- [ ] ISC-21: test/governance/subagent/transition-table.test.ts committed
- [ ] ISC-22: Modified test/governance/*.test.ts files committed
- [ ] ISC-23: Modified src/alienclaw/agents/*.ts files committed
- [ ] ISC-24: Modified src/alienclaw/constants.ts, index.ts, wiring/ committed

### Tools / Bridge refactor (Packets 22-24)
- [ ] ISC-25: src/alienclaw/tools/*.py (10 files) committed
- [ ] ISC-26: src/alienclaw/bridge/server.py (modified) committed
- [ ] ISC-27: test/tools/__init__.py + test/tools/test_web_search_backend.py committed
- [ ] ISC-28: test/bridge/test_martian_dispatch.py committed

### Martians module (Packet 16)
- [ ] ISC-29: src/alienclaw/martians/*.py + *.ts (10 files) committed
- [ ] ISC-30: seed/martians/*.martian + stubs/ committed
- [ ] ISC-31: test/martians/*.py + *.ts (7 files) committed
- [ ] ISC-32: test/fixtures/martian-registry-fixtures.json + martian-substitution-fixtures.json committed

### Diagnostics (Packet 21)
- [ ] ISC-33: src/alienclaw/diagnostics/*.py (13 new files) committed
- [ ] ISC-34: test/diagnostics/*.py (14 test files) committed

### Evolution updates (Packets 25-27)
- [ ] ISC-35: src/alienclaw/evolution/*.py modifications committed
- [ ] ISC-36: src/alienclaw/evolution/migrations/ committed
- [ ] ISC-37: src/alienclaw/evolution/scale_experiment.py committed
- [ ] ISC-38: test/evolution/*.py (3 files) committed
- [ ] ISC-39: scripts/*.py analysis scripts committed

### Genome/Brain/Fitness updates (Packets 14-15)
- [ ] ISC-40: src/alienclaw/genome/codec.py, operators.py modifications committed
- [ ] ISC-41: src/alienclaw/brains/parser.py, types.py modifications committed
- [ ] ISC-42: src/alienclaw/fitness/*.py modifications committed
- [ ] ISC-43: src/alienclaw/api/server.py modification committed
- [ ] ISC-44: test/genome/test_step_mutation.py + test_xcode_helpers.py committed
- [ ] ISC-45: test/genome/test_fixtures.py, test_operators.py modifications committed
- [ ] ISC-46: test/brains/test_fixtures.py modification committed
- [ ] ISC-47: test/fitness/test_fitness.py modification committed
- [ ] ISC-48: test/api/test_api_server.py modification committed
- [ ] ISC-49: test/fixtures/genome-spec-fixtures.json, brain-registry-fixtures.json modifications committed

### Docs/Specs (various packets)
- [ ] ISC-50: docs/ARCHITECTURE.md, docs/MATHEMATICAL_FOUNDATIONS.md committed
- [ ] ISC-51: docs/specs/SUBAGENT_*.md (3 files) committed
- [ ] ISC-52: docs/specs/SPECIALIST_*.md modifications committed
- [ ] ISC-53: MSB files (seed/msb/*.msb 8 files) committed

### Integration + fixtures (Packet 22)
- [ ] ISC-54: test/integration/*.test.ts (2 files) committed
- [ ] ISC-55: test/fixtures/test-goals/*.json (2 files) committed
- [ ] ISC-56: test/fixtures/bridge-fixture.json modification committed
- [ ] ISC-57: src/alienclaw/registry/genome-operators.ts committed

### PRD/MEMORY (packets 14-28)
- [ ] ISC-58: MEMORY/WORK/ PRD files for packets 14-28 (15 files) committed
- [ ] ISC-59: Modified MEMORY/WORK/ PRD files for packets 29-30 committed

### Governance/hermes/openclaw stubs
- [ ] ISC-60: src/alienclaw/governance/hermes/README.md, openclaw/README.md committed

### Verification
- [ ] ISC-61: npx tsc --noEmit exits 0 after all commits
- [ ] ISC-62: npx vitest run: all tests pass after all commits
- [ ] ISC-63: CI run triggered and GREEN
- [ ] ISC-64: packet-30.5-ci-verification.md produced with evidence

### Final artifacts
- [ ] ISC-65: packet-30.5-verdict.md produced (L4 closure status, working tree clean)
- [ ] ISC-66: packet-30.5-report.md produced
- [ ] ISC-67: packet-30.5-bugs.md produced (bug #13 documented)
- [ ] ISC-68: packet-30.5-deferred.md produced
- [ ] ISC-69: packet-30.5-defaults.md produced
- [ ] ISC-70: docs/LESSONS_FROM_THE_ARC.md updated with bug #13 + process-hygiene change
- [ ] ISC-71: LESSONS includes process change: pre-commit working-tree-clean check

### Anti-criteria
- [ ] ISC-A1: No single commit contains files from multiple unrelated packets
- [ ] ISC-A2: No test-suppression to make CI green
- [ ] ISC-A3: No new feature development (only reconciliation of existing files)
- [ ] ISC-A4: Working tree fully clean after reconciliation (no uncommitted files except documented holds)

## Decisions

## Verification
