# Packet 31.5 — Live Verification

## Status: PENDING BUGSY'S DEPLOYMENT

The TypeScript API code is complete and CI is green. Live verification runs
after Bugsy executes the steps in `packet-31.5-manual-steps.md`.

---

## What to verify once api.alienclaw.net is live

### 1. Health check (pull-only guarantee: no inbound channel exists)

```bash
curl https://api.alienclaw.net/v1/health
# Expected: {"status":"ok","version":"1.0.0","uptime_seconds":<N>}
```

### 2. Empty leaderboard (inert-data guarantee: response is only numbers and 8-letter names)

```bash
curl "https://api.alienclaw.net/v1/genomes/top?martian_type=compute&n=5"
# Expected: {"martian_type":"compute","genomes":[],"total_for_type":0}
# Verify: no unexpected fields, no executable content
```

### 3. Name constraint on live API (constrained-names guarantee)

```bash
# Should return 422 INVALID_LEADERBOARD_NAME:
curl -X POST https://api.alienclaw.net/v1/install \
  -H "Content-Type: application/json" \
  -d '{"api_key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","machine_hash":"'$(python3 -c "print('a'*64)'")'}"

# Install first, then try bad name:
# curl -X POST https://api.alienclaw.net/v1/genomes \
#   -H "Authorization: Bearer <key>" \
#   -H "Content-Type: application/json" \
#   -d '{"genome":"<256chars>","martian_type":"compute","fitness":0.5,"leaderboard_name":"lowercase"}'
# Expected: 422 INVALID_LEADERBOARD_NAME
```

### 4. End-to-end submission

```bash
# Register → submit → check rank → see in leaderboard.html
# (requires valid 256-char genome and registered API key)
```

### 5. Trust model verification against live API

| Guarantee | Verified | Notes |
|-----------|----------|-------|
| Pull-only | [ ] | No inbound channel on operator side (structural — leaderboard.ts not changed) |
| Inert data | [ ] | /v1/genomes/top returns only numbers and ^[A-Z]{8}$ names |
| File-mediated | [ ] | submitFromFile is separate from leaderboardCheck (code, unchanged) |
| Name-constrained | [ ] | Live API rejects non-^[A-Z]{8}$ names |
| Hardened fetch | [ ] | hardenedFetch on client unchanged from Packet 31 |

---

## Current state

- Code: committed (e1f3de9a), CI green
- Deployment: not yet executed
- api.alienclaw.net: unreachable (HTTP 000, same as Packet 29 audit)

L5 remains PARTIAL until Bugsy completes packet-31.5-manual-steps.md.
