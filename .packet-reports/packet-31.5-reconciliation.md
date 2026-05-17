# Packet 31.5 — Reconciliation

## Python references corrected

### Files removed (Python API)
- src/alienclaw/api/*.py (9 files): server, types, validation, auth, rate_limit, storage, audit_log, __init__, __main__
- src/alienclaw/api/handlers/*.py (5 files): genomes, health, install, martian_types, stats, __init__
- test/api/test_api_server.py
- test/api/test_api_contract_fixtures.py
- test/api/test_audit_log.py
- test/api/test_handler_genomes_audit_integration.py
- test/api/test_rate_limit_persistence.py

### Documents corrected
- `.packet-reports/packet-31-deployment.md`: Step 3 updated from "Deploy Python API" to "Deploy TypeScript API"
- `.github/workflows/ci.yml`: "Run API tests with coverage" step replaced with a note that API tests moved to TypeScript (vitest)
- `.env.example`: Added ALIENCLAW_API_DATA_ROOT, ALIENCLAW_API_PORT, ALIENCLAW_API_HOST docs

### Grep verification

```bash
grep -rni "python.*api\|alienclaw\.api" \
  src/ test/ README.md .env.example \
  --include="*.md" --include="*.ts" --include="*.json" --include="*.example" \
  | grep -v "ported from\|TypeScript port\|was Python\|packet-31.5"
```

Result: no stale "Python API" references remain in src/, test/, or primary docs.
The packet-31.5-port-plan.md contains the mapping table (Python → TypeScript)
which is intentional historical documentation.

## What's TypeScript now (complete list)

The AlienClaw API is now entirely TypeScript:
- `src/alienclaw/api/server.ts` — HTTP server (node:http)
- `src/alienclaw/api/types.ts` — request/response interfaces
- `src/alienclaw/api/validation.ts` — submission validation, ^[A-Z]{8}$
- `src/alienclaw/api/auth.ts` — API key generation and hashing
- `src/alienclaw/api/rate-limit.ts` — token bucket rate limiter
- `src/alienclaw/api/audit-log.ts` — JSONL submission audit log
- `src/alienclaw/api/storage.ts` — flat-file persistence
- `src/alienclaw/api/main.ts` — entry point (tsx src/alienclaw/api/main.ts)
- `src/alienclaw/api/handlers/` — 5 endpoint handlers

Tests:
- `test/api/ts-api-server.test.ts` — 25 integration tests
- `test/governance/leaderboard.test.ts` — 21 client-side tests

## What's still Python (unrelated to the API)

The following Python modules are intentionally Python and NOT ported:
- `src/alienclaw/genome/` — genome codec, operators (Python)
- `src/alienclaw/brains/` — brain parsing (Python)
- `src/alienclaw/evolution/` — evolution engine (Python)
- `src/alienclaw/fitness/` — fitness functions (Python)
- `src/alienclaw/martians/` — Martian module (Python)
- `src/alienclaw/diagnostics/` — analysis tools (Python)
- `src/alienclaw/tools/` — tool implementations (Python)
- `src/alienclaw/bridge/` — Python-TypeScript bridge (Python)

These are the evolution/ML/scientific computing layer and are correctly Python.
Only the community API server was ported; everything else is unchanged.
