# Packet 31.5 — Port Plan

## Python → TypeScript mapping

| Python file | TypeScript file | Notes |
|-------------|-----------------|-------|
| api/types.py | api/types.ts | Dataclasses → interfaces |
| api/validation.py | api/validation.ts | ^[A-Z]{8}$, genome length/alphabet |
| api/auth.py | api/auth.ts | Base62 key gen, SHA-256 hash |
| api/rate_limit.py | api/rate-limit.ts | Flat-file token bucket |
| api/audit_log.py | api/audit-log.ts | JSONL append log |
| api/storage.py | api/storage.ts | Flat-file + optional MySQL |
| api/server.py | api/server.ts | node:http routing |
| api/__main__.py | api/main.ts | Entry point |
| api/handlers/genomes.py | api/handlers/genomes.ts | GET /v1/genomes/top, POST /v1/genomes |
| api/handlers/health.py | api/handlers/health.ts | GET /v1/health |
| api/handlers/install.py | api/handlers/install.ts | POST /v1/install |
| api/handlers/stats.py | api/handlers/stats.ts | GET /v1/stats |
| api/handlers/martian_types.py | api/handlers/martian-types.ts | GET /v1/martian-types |

## Client/server contract (leaderboard.ts expects)

leaderboard.ts (already shipped, must not be changed) makes:
- GET /v1/genomes/top?martian_type=X&n=N
  Returns: { martian_type, genomes: [{ leaderboard_name, fitness, martian_type, submission_id, submitted_at, ... }], total_for_type }

submitFromFile() makes:
- POST /v1/genomes with body: { genome, martian_type, fitness, leaderboard_name }
  Returns: { submission_id, submitted_at, rank, is_new_top }

Both contracts are preserved exactly in the TypeScript port.

## Genome imports from existing TS

- BASE62_ALPHABET: from '../../registry/genome-codec.js'
- GENOME_LENGTH: from '../../constants.js'
- Checksum validation: NOT ported (no TS equivalent; length + alphabet checks suffice for API)
  This is a known behavioral difference documented in packet-31.5-port-equivalence.md.

## MySQL support

- Flat-file storage is ported faithfully (behavioral equivalence for tests)
- If ALIENCLAW_DB_URL is set: SubmissionStore uses MySQL (mysql2/promise)
- Otherwise: flat-file storage (same as Python)
- InstallStore + GlobalStats: flat-file only in v1

## HTTP framework

node:http (no framework). Same philosophy as Python's stdlib http.server.
Port, accept, route per path — no middleware stack.

## TypeScript constraints

- module: nodenext — imports use .js extension
- strict: true — no `any`, no implicit types
- noEmit: true — tests run via tsx/vitest; production via tsx
- tsx added as runtime dependency for Hostinger Node slot
