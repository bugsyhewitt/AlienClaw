---
task: packet 14 architecture correction and rename
slug: 20260507-140333_packet-14-architecture-correction
effort: advanced
phase: complete
progress: 34/34
mode: interactive
started: 2026-05-07T14:03:33Z
updated: 2026-05-07T14:05:00Z
---

## Context

Packet 14 of AlienClaw. The architecture correction document (docs/ARCHITECTURE.md) establishes that what were called "Martians" throughout Packets 1-13 are actually **tools** — deterministic tool-call executors. A Martian is a **composition** of up to 4 tools, encoded in a 256-char Base62 genome. That composition concept doesn't exist in code yet (Packet 16 builds it).

This packet is purely structural: rename and reorganize to match the correct architecture.

Two change tracks:
1. **Python**: `bridge/runners/` → `tools/` with RUNNER_REGISTRY → TOOL_REGISTRY
2. **TypeScript governance**: `governance/*.ts` → `governance/common/*.ts`, create empty `hermes/` and `openclaw/` stubs
3. **Docs**: commit `docs/ARCHITECTURE.md`

Success criteria: `PYTHONPATH=src python -m pytest test/ -q --tb=no` still passes 466 tests, `npm run typecheck` still produces 0 errors.

### Risks

- Governance TypeScript move requires updating relative imports in ~15 files (within-dir `'../utils.js'` etc. become `'../../utils.js'`)
- All test/governance/*.test.ts files import from `src/alienclaw/governance/X.js` directly — these all need updating
- The bridge/runners pycache won't be cleaned automatically; that's fine (Python ignores stale .pyc on missing source)
- reporting.py contains hardcoded strings referencing the old paths — need updating

## Criteria

### Python: tools/ directory creation
- [x] ISC-1: `src/alienclaw/tools/` directory exists with `__init__.py`
- [x] ISC-2: `src/alienclaw/tools/types.py` exists (moved from bridge/runners/types.py)
- [x] ISC-3: `src/alienclaw/tools/registry.py` exists with `TOOL_REGISTRY` (renamed from `RUNNER_REGISTRY`)
- [x] ISC-4: `src/alienclaw/tools/compute.py` exists
- [x] ISC-5: `src/alienclaw/tools/extract_json.py` exists
- [x] ISC-6: `src/alienclaw/tools/file_read.py` exists
- [x] ISC-7: `src/alienclaw/tools/file_write.py` exists
- [x] ISC-8: `src/alienclaw/tools/http_get.py` exists
- [x] ISC-9: `src/alienclaw/tools/search_text.py` exists
- [x] ISC-10: `src/alienclaw/tools/url_fetch.py` exists
- [x] ISC-11: `src/alienclaw/tools/web_search.py` exists

### Python: old bridge/runners/ removed
- [x] ISC-12: `src/alienclaw/bridge/runners/` directory does not exist

### Python: import updates
- [x] ISC-13: `bridge/server.py` imports `TOOL_REGISTRY` from `alienclaw.tools`
- [x] ISC-14: `bridge/server.py` variable `runner` renamed to `tool` in summon handler
- [x] ISC-15: `diagnostics/sensitivity_audit.py` imports `TOOL_REGISTRY` from `alienclaw.tools`
- [x] ISC-16: `diagnostics/reporting.py` path strings updated to `src/alienclaw/tools/`
- [x] ISC-17: `diagnostics/reporting.py` code snippet string updated from `RUNNER_REGISTRY` to `TOOL_REGISTRY`

### Python tests
- [x] ISC-18: `test/bridge/runners/test_web_search_backend.py` moved to `test/tools/test_web_search_backend.py`
- [x] ISC-19: moved test imports from `alienclaw.tools.web_search`
- [x] ISC-20: `PYTHONPATH=src python -m pytest test/ -q --tb=no` exits 0 with 466 passed

### TypeScript governance restructure
- [x] ISC-21: `src/alienclaw/governance/common/` directory exists
- [x] ISC-22: all `src/alienclaw/governance/*.ts` files moved to `governance/common/*.ts`
- [x] ISC-23: `src/alienclaw/governance/sync/` moved to `governance/common/sync/`
- [x] ISC-24: `src/alienclaw/governance/hermes/` exists (empty stub)
- [x] ISC-25: `src/alienclaw/governance/openclaw/` exists (empty stub)
- [x] ISC-26: within-`common/` relative imports updated (`'../utils.js'` → `'../../utils.js'` etc.)
- [x] ISC-27: `src/alienclaw/index.ts` governance imports updated to `./governance/common/`
- [x] ISC-28: `src/alienclaw/wiring/hierarchy-bootstrap.ts` governance imports updated to `../governance/common/`
- [x] ISC-29: all `test/governance/*.test.ts` governance source imports updated to `governance/common/`
- [x] ISC-30: `npm run typecheck` exits 0 with no errors

### ARCHITECTURE.md
- [x] ISC-31: `docs/ARCHITECTURE.md` file exists
- [x] ISC-32: File contains §1 through §10 from the architecture correction document

### Anti-criteria
- [x] ISC-A1: No changes to any .msb files, genome layer, evolution layer, or API handler logic
- [x] ISC-A2: Bridge wire format (JSON request/response fields) unchanged
- [x] ISC-A3: No changes to `martian_type` field name at API or wire level

## Decisions

## Verification

- pytest: 466 passed, 125 skipped, 2 warnings — fresh run post-all-changes
- typecheck: `tsc --noEmit` exit 0, zero errors — fresh run post-all-changes
- `bridge/runners/` directory: confirmed deleted
- `RUNNER_REGISTRY`: zero occurrences in src/ and test/
- `governance/common/`: 17 .ts files confirmed; sync/ has 5 .ts files confirmed
- Wire format fields (`martian_type`, `TOOL_RUNNER_FAILED`): confirmed unchanged in api/types.py and bridge/server.py
