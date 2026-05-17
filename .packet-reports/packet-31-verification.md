# Packet 31 — Verification

## Code verification (complete)

### leaderboard_name field — 77/77 API tests pass
- Valid ^[A-Z]{8}$ names accepted
- Lowercase rejected (INVALID_LEADERBOARD_NAME)
- Digits rejected
- Wrong length rejected
- Missing field rejected (400 MISSING_FIELDS)
- leaderboard_name appears in GET /v1/genomes/top responses

### CreatorBot leaderboard_check — 21/21 TypeScript tests pass
- Artifact written when operator has top genome ✓
- No artifact written when operator doesn't have top ✓
- Oversized response rejected (hardenedFetch size limit) ✓
- Malformed/injected response rejected (validateLeaderboardResponse) ✓
- Invalid config name rejected ✓
- submitFromFile is a separate function ✓
- No inbound listener in leaderboardCheck ✓

### Full CI: SUCCESS
- CI run 25978698026: all jobs pass
- TypeScript typecheck ✓
- Unit tests ✓
- Python lint + all subtasks ✓
- Install smoke ✓

## Deployment verification (PENDING)

The API is not yet deployed. Once Bugsy completes the steps in
packet-31-deployment.md, the following should be verified:

- [ ] `curl https://api.alienclaw.net/v1/health` returns 200
- [ ] `curl "https://api.alienclaw.net/v1/genomes/top?martian_type=compute&n=5"` returns 200 with empty genomes
- [ ] Submit a genome: POST /v1/genomes with valid leaderboard_name returns 201 with rank
- [ ] Submitted genome appears in GET /v1/genomes/top response
- [ ] alienclaw.net/leaderboard.html shows real data (not empty state)

## Trust model verification

| Guarantee | Verified | Code location |
|-----------|----------|---------------|
| Pull-only (no inbound listener) | ✓ | leaderboard.ts — grep confirms no createServer/listen |
| Inert data (whitelist validation) | ✓ | validateLeaderboardResponse() — tested with injection fixtures |
| File-mediated (separate submitFromFile) | ✓ | leaderboardCheck() — only output is writeFileSync |
| Name-constrained (^[A-Z]{8}$) | ✓ | Three enforcement points + DB CHECK |
| Hardened fetch (timeout + size) | ✓ | hardenedFetch() — tested with oversized response |
