---
task: Packet 31.5 port leaderboard API TypeScript deploy close L5
slug: 20260517-000000_packet-31.5-ts-port-deploy
effort: advanced
phase: observe
progress: 0/49
mode: interactive
started: 2026-05-17T00:00:00Z
updated: 2026-05-17T00:05:00Z
---

## Context

Port Packet 31's Python leaderboard API to TypeScript for Hostinger's Node.js
deployment slot. The Hostinger plan runs Node.js; the Python API is a deployment
mismatch. TypeScript matches AlienClaw's TS-heavy codebase. Decision confirmed
by Bugsy. Port must preserve behavior of all security validators exactly (same
test cases). Python API removed once equivalence is verified. Deploy to Hostinger
Node slot with MySQL. Close L5.

### Risks
- Port drift in security validators (^[A-Z]{8}$, response schema, rate limiter)
  - Mitigated by running same test cases against TS port
- Hostinger Node.js deployment mechanics unknown until attempted
  - Mitigated by writing precise manual-step instructions for Bugsy
- mysql2 package compatibility with Hostinger's Node version
- TypeScript API must be contract-compatible with existing leaderboard.ts client

## Criteria

### Pre-flight
- [ ] ISC-1: Starting commit recorded, working tree clean
- [ ] ISC-2: CI confirmed green
- [ ] ISC-3: Backup taken
- [ ] ISC-4: Python API, tests, client contract, tsconfig all read and understood
- [ ] ISC-5: packet-31.5-port-plan.md produced

### TypeScript API — types and validation
- [ ] ISC-6: src/alienclaw/api/types.ts created with request/response interfaces
- [ ] ISC-7: src/alienclaw/api/validation.ts created with ^[A-Z]{8}$ validator
- [ ] ISC-8: Name validator rejects: lowercase, digits, symbols, wrong length, empty
- [ ] ISC-9: Name validator accepts: exactly 8 uppercase A-Z letters

### TypeScript API — auth and rate limiting
- [ ] ISC-10: src/alienclaw/api/auth.ts ported (API key format validation, hashing)
- [ ] ISC-11: src/alienclaw/api/rate-limit.ts ported (flat-file rate limiter)

### TypeScript API — storage
- [ ] ISC-12: src/alienclaw/api/storage.ts ported using mysql2 with parameterized queries
- [ ] ISC-13: No string-concatenated SQL anywhere in storage layer
- [ ] ISC-14: mysql2 added to package.json dependencies

### TypeScript API — HTTP server and handlers
- [ ] ISC-15: src/alienclaw/api/server.ts ported (http module, routing)
- [ ] ISC-16: GET /v1/genomes/top returns leaderboard_name in GenomeEntry
- [ ] ISC-17: POST /v1/genomes validates leaderboard_name (^[A-Z]{8}$)
- [ ] ISC-18: GET /v1/health, GET /v1/stats, GET /v1/martian-types ported
- [ ] ISC-19: POST /v1/install ported with auth validation
- [ ] ISC-20: npx tsc --noEmit passes strict mode (no `any`)

### Behavioral equivalence tests
- [ ] ISC-21: TS tests cover ^[A-Z]{8}$ — lowercase rejected
- [ ] ISC-22: TS tests cover ^[A-Z]{8}$ — digits rejected
- [ ] ISC-23: TS tests cover ^[A-Z]{8}$ — symbols rejected
- [ ] ISC-24: TS tests cover ^[A-Z]{8}$ — wrong length rejected
- [ ] ISC-25: TS tests cover ^[A-Z]{8}$ — valid name accepted
- [ ] ISC-26: TS tests cover response schema — extra fields rejected
- [ ] ISC-27: TS tests cover response schema — injected content rejected
- [ ] ISC-28: TS tests cover rate limiter boundary cases
- [ ] ISC-29: packet-31.5-port-equivalence.md produced (match table)
- [ ] ISC-30: All shared test cases show MATCH (no port drift)

### Remove Python + reconcile
- [ ] ISC-31: All src/alienclaw/api/*.py files removed from git
- [ ] ISC-32: All src/alienclaw/api/handlers/*.py files removed
- [ ] ISC-33: No stale "Python API" references in docs, .env.example, reports
- [ ] ISC-34: packet-31.5-reconciliation.md produced

### Deployment preparation
- [ ] ISC-35: packet-31.5-manual-steps.md produced (precise ordered steps for Bugsy)
- [ ] ISC-36: .env.example updated for TypeScript API (MySQL vars, API port)
- [ ] ISC-37: Package.json has start script for Hostinger Node deployment
- [ ] ISC-38: App entry point configured for Hostinger (correct port binding)

### Live verification (post Bugsy's manual steps)
- [ ] ISC-39: api.alienclaw.net responds to GET /v1/health (200)
- [ ] ISC-40: GET /v1/genomes/top returns valid inert data
- [ ] ISC-41: POST /v1/genomes with invalid leaderboard_name is rejected live
- [ ] ISC-42: Trust model guarantee 1 (pull-only) verified live
- [ ] ISC-43: Trust model guarantee 2 (inert data) verified live
- [ ] ISC-44: packet-31.5-live-verification.md produced

### Final artifacts
- [ ] ISC-45: packet-31.5-verdict.md (L5 closed, all 5 blockers table)
- [ ] ISC-46: packet-31.5-report.md
- [ ] ISC-47: packet-31.5-bugs.md
- [ ] ISC-48: packet-31.5-deferred.md
- [ ] ISC-49: packet-31.5-defaults.md

### Anti-criteria
- [ ] ISC-A1: No string-concatenated SQL (parameterized queries only)
- [ ] ISC-A2: No secrets committed
- [ ] ISC-A3: Python API code not left alongside TypeScript
- [ ] ISC-A4: CreatorBot's leaderboard_check client routine not redesigned
- [ ] ISC-A5: L5 not declared closed before live api.alienclaw.net verified

## Decisions

### D1: Use mysql2/promise for MySQL access
Standard Node.js MySQL client with promise support. Well-maintained, supports
parameterized queries. Alternative (mysql2 synchronous) not used.

### D2: Use Node.js http module directly
No Express or Fastify. Consistent with the Python API using stdlib http.server.
Lower dependency surface.

### D3: TypeScript API under src/alienclaw/api/ replacing Python files
Same directory, .ts files replace .py files. Clean structure.

## Verification
