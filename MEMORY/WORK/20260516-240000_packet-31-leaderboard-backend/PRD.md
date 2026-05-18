---
task: Packet 31 leaderboard backend CI green L5 closed
slug: 20260516-240000_packet-31-leaderboard-backend
effort: advanced
phase: complete
progress: 0/48
mode: interactive
started: 2026-05-16T24:00:00Z
updated: 2026-05-17T00:15:00Z
---

## Context

Packet 31 closes L5 — the last launch-blocker. The Packet 10 Python API is
already built (routes, auth, rate-limit, audit-log, flat-file storage). What's
missing: (1) leaderboard_name (^[A-Z]{8}$) field, (2) MySQL storage backend
replacing flat-files, (3) CreatorBot leaderboard_check TypeScript routine,
(4) leaderboard UI showing real data, (5) deployment to Hostinger.

Hostinger plan: Business hosting with MySQL (confirmed from screenshot).
Stack: existing Python API + MySQL storage + Hostinger deployment.
Trust model: pull-only, inert-data, file-mediated, name-constrained — each
enforced in code.

### Risks

- Python persistent process on Hostinger may not work if plan is shared PHP
  hosting; have Node.js fallback plan documented
- MySQL connection from Python needs pymysql or mysql-connector-python dep
- Deployment mechanics for Python on Hostinger are unknown until attempted
- leaderboard_name must be added to existing types without breaking existing
  tests
- The existing storage.py uses /var/alienclaw/ path — must be overridden via
  ALIENCLAW_API_DATA_ROOT env var on Hostinger

## Criteria

### Pre-flight
- [ ] ISC-1: Starting commit recorded, working tree clean
- [ ] ISC-2: CI confirmed green before starting
- [ ] ISC-3: Backup taken
- [ ] ISC-4: packet-31-hostinger-audit.md produced documenting plan/capabilities

### leaderboard_name field — API
- [ ] ISC-5: SubmissionRequest dataclass has leaderboard_name field (str, required)
- [ ] ISC-6: validate_submission() rejects missing leaderboard_name with MISSING_FIELDS
- [ ] ISC-7: validate_submission() rejects non-^[A-Z]{8}$ with INVALID_LEADERBOARD_NAME
- [ ] ISC-8: validate_submission() rejects lowercase names (e.g. "abcdefgh")
- [ ] ISC-9: validate_submission() rejects names with digits (e.g. "ABCDE123")
- [ ] ISC-10: validate_submission() rejects names with wrong length (7, 9)
- [ ] ISC-11: storage layer persists leaderboard_name with each submission
- [ ] ISC-12: GenomeEntry dataclass has leaderboard_name field
- [ ] ISC-13: GET /v1/genomes/top returns leaderboard_name in each GenomeEntry

### MySQL storage backend
- [ ] ISC-14: MySQL schema migration SQL file created (migrations/001_leaderboard.sql)
- [ ] ISC-15: Table has leaderboard_name CHAR(8) NOT NULL CHECK constraint
- [ ] ISC-16: Table has genome, martian_type, fitness, submitted_at, api_key_hash
- [ ] ISC-17: Index on (martian_type, fitness DESC)
- [ ] ISC-18: MySQLSubmissionStore implements same interface as SubmissionStore
- [ ] ISC-19: DB connection via ALIENCLAW_DB_URL env var (never hardcoded)
- [ ] ISC-20: .env.example documents ALIENCLAW_DB_URL and ALIENCLAW_API_DATA_ROOT
- [ ] ISC-21: requirements-dev.txt includes pymysql or mysql-connector-python

### API tests (leaderboard_name coverage)
- [ ] ISC-22: test_api_server.py: submission with valid name returns 201
- [ ] ISC-23: test_api_server.py: submission with missing name returns 400
- [ ] ISC-24: test_api_server.py: submission with lowercase name returns 400/422
- [ ] ISC-25: test_api_server.py: submission with digit name returns 400/422
- [ ] ISC-26: test_api_server.py: GET /v1/genomes/top includes leaderboard_name in response

### Trust model document
- [ ] ISC-27: packet-31-trust-model.md documents all 5 guarantees
- [ ] ISC-28: Each guarantee cites the specific file/function that enforces it

### CreatorBot leaderboard_check TypeScript routine
- [ ] ISC-29: leaderboardCheck() function created in governance area
- [ ] ISC-30: hardenedFetch() has timeout (10s default) and maxResponseBytes (256KB)
- [ ] ISC-31: validateLeaderboardResponse() validates every field type strictly
- [ ] ISC-32: validateLeaderboardResponse() rejects extra fields
- [ ] ISC-33: validateLeaderboardResponse() re-validates leaderboard_name ^[A-Z]{8}$
- [ ] ISC-34: If operator fitness ≤ top, no file is written
- [ ] ISC-35: If operator fitness > top, artifact file is written with leaderboard_name, genome_hash, martian_type, fitness
- [ ] ISC-36: submitFromFile() is a SEPARATE function from leaderboardCheck()
- [ ] ISC-37: No inbound listener or push channel exists in leaderboardCheck

### CreatorBot tests
- [ ] ISC-38: test: leaderboardCheck writes artifact when operator has top genome
- [ ] ISC-39: test: leaderboardCheck writes nothing when operator doesn't have top
- [ ] ISC-40: test: hardenedFetch rejects response > maxResponseBytes
- [ ] ISC-41: test: validateLeaderboardResponse rejects malformed/injected response

### Leaderboard UI
- [ ] ISC-42: leaderboard.html no longer shows "Data coming with Packet 10" placeholder
- [ ] ISC-43: leaderboard.html fetches from api.alienclaw.net/v1/genomes/top
- [ ] ISC-44: leaderboard.html displays leaderboard_name, fitness, rank, martian_type
- [ ] ISC-45: leaderboard.html handles empty board gracefully ("No entries yet")

### Deployment
- [ ] ISC-46: api.alienclaw.net DNS record set and resolves
- [ ] ISC-47: GET https://api.alienclaw.net/v1/health returns 200
- [ ] ISC-48: packet-31-deployment.md documents steps taken + verification

### Final artifacts
- [ ] ISC-49: packet-31-verdict.md (L5 status, all-5-blockers status)
- [ ] ISC-50: packet-31-report.md
- [ ] ISC-51: packet-31-bugs.md
- [ ] ISC-52: packet-31-deferred.md (server-side re-verification + Postgres as future)

### Anti-criteria
- [ ] ISC-A1: No inbound endpoint/listener on operator machine in leaderboardCheck
- [ ] ISC-A2: No leaderboard response field ever executed as code
- [ ] ISC-A3: No secrets committed (MySQL creds only in .env.example)
- [ ] ISC-A4: No locked baseline subsystem changes

## Decisions

### D1: MySQL over Postgres
Hostinger plan has MySQL, not Postgres. Packet specified Postgres "for headroom"
but Hostinger's available database is MySQL. Using MySQL with the same migration
discipline. Postgres deferred to if/when a VPS upgrade happens.

### D2: Python API (existing) over Node.js rewrite
The Packet 10 Python API is already complete and tested. Attempting Python
deployment on Hostinger first. If Python persistent processes aren't supported,
a minimal Node.js equivalent is the documented fallback.

### D3: Flat-file storage retained as fallback
If MySQL connection setup on Hostinger proves complex, the existing flat-file
storage (with ALIENCLAW_API_DATA_ROOT pointing to a writable path) is the
fallback for v1. MySQL is the primary target.

## Verification
