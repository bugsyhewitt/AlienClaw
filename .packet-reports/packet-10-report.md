# Packet 10 — Community Genome Network

## Summary

Packet 10 ships the community genome network for AlienClaw: a REST API server
(`api.alienclaw.net`) that allows distributed AlienClaw installations to
submit genome fitness scores, retrieve top genomes, and seed their local
evolution loops from the community population.

**Status:** Code complete. Awaiting DNS provision to go live.

---

## What was built

### Phase 3 — Python REST API server

6 endpoints, production-grade:

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/health` | GET | Liveness + uptime |
| `/v1/install` | POST | Register an API key + machine hash |
| `/v1/genomes` | POST | Submit a genome fitness score |
| `/v1/genomes/top` | GET | Top genomes per martian type |
| `/v1/martian-types` | GET | Registered Martian types |
| `/v1/stats` | GET | Global counters |

**Auth:** Bearer token (43-char Base62 API key), stored server-side as SHA-256 hash.
**Rate limiting:** 100 submissions/hour per install, in-memory token bucket.
**Storage:** Flat-file atomic writes. `data/genomes/<type>/<id>.json`, `data/installs/<hash[:2]>/<hash>.json`.
**Validation:** Full genome decode on submission — length, alphabet, FNV-1a checksum.

17/17 integration tests pass (real HTTP on random port via `HTTPServer(port=0)`).

### Phase 4 — Cross-language API contract fixture

`test/fixtures/api-contract-fixtures.json` — 41 cases covering:
- API key format validation (8 cases)
- Machine hash validation (7 cases)
- Genome validation (10 cases — length, alphabet, checksum, fitness, martian_type)
- Endpoint response schemas (9 cases)
- Error codes (canonical list)
- Auth and rate limit expectations
- Ordering guarantees (rank is 1-indexed, sorted by fitness descending)

29/29 Python fixture-driven tests pass. TypeScript implementations consume
the same fixture JSON — no divergence possible.

### Phase 5 — CreatorBot sync module

`src/alienclaw/governance/sync/`:

| File | Purpose |
| --- | --- |
| `client.ts` | Typed HTTP client wrapping all 5 endpoints |
| `push.ts` | Push top-N local genomes to network per martian type |
| `pull.ts` | Pull top-N network genomes into local population directory |
| `scheduler.ts` | Periodic push/pull cycle (default 5 min), unref'd timer |
| `index.ts` | Re-export barrel |

`tsc --noEmit` clean. `scheduler.start()` is idempotent.

### Phase 8 — leaderboard.html live data

`site/leaderboard.html` updated from static placeholder to live:
- Fetches `GET /v1/stats` for counters (total genomes, installs, evaluations)
- Fetches `GET /v1/genomes/top` for ranked genome table per selected type
- Dropdown to switch between all 8 martian types
- Graceful degradation — "server not reachable" message when API is down
- Zero frameworks, zero external JS, inline `<script>` only

---

## Phase 6 — Provision api.alienclaw.net

**Pending Bugsy's Hostinger access.** Steps:

1. DNS: Add A record `api.alienclaw.net → <VPS IP>` in Hostinger DNS panel
2. TLS: `certbot --nginx -d api.alienclaw.net` (Let's Encrypt)
3. Systemd service:
   ```ini
   [Service]
   ExecStart=/usr/bin/python3 -m alienclaw.api serve --port 8080
   Environment=ALIENCLAW_API_DATA_ROOT=/var/lib/alienclaw/api
   ```
4. Nginx reverse proxy: `proxy_pass http://127.0.0.1:8080`
5. Verify: `curl https://api.alienclaw.net/v1/health`

---

## Phase 7 — Dogfood (deferred to post-provision)

Once api.alienclaw.net is live, run:
```bash
PYTHONPATH=src python3 -c "
from alienclaw.api.auth import load_or_create_key, is_valid_machine_hash
from alienclaw.api.auth import generate_api_key
import urllib.request, json, hashlib

key = generate_api_key()
mh = hashlib.sha256(b'dogfood-machine').hexdigest()
r = urllib.request.urlopen(urllib.request.Request(
    'https://api.alienclaw.net/v1/install',
    data=json.dumps({'api_key': key, 'machine_hash': mh}).encode(),
    headers={'Content-Type': 'application/json'}, method='POST'))
print(json.loads(r.read()))
"
```

---

## Metrics

| Metric | Value |
| --- | --- |
| Python tests added | 17 (integration) + 29 (contract fixture) = 46 |
| TypeScript files added | 5 (sync module) |
| JSON fixture cases | 41 |
| tsc errors | 0 |
| Full suite: Python | 431 passed, 125 skipped |
| Commits in Packet 10 | 2 (Phase 3, Phase 4+5) |
