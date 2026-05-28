# Packet 35 — Verdict

**Status:** GREEN

## Summary
api.alienclaw.net is live. End-to-end submission persists to production MySQL. L5 closed.

## Phase results
- Phase 1 (branch + setup): PASS
- Phase 2 (inventory): PASS
- Phase 3 (MySQL DB + migration): PASS — DB: u881291242_leaderboard, tables: installs, leaderboard_entries
- Phase 4 (placeholder): N/A — no separate placeholder needed, deployment slot reused
- Phase 5 (artifact built): PASS — pre-compiled bundle via esbuild, zip 7.7KB, no node_modules
- Phase 6 (deployed): PASS — alienclaw-deploy-v8.zip, Node 22.x, entry: server.js
- Phase 7 (DNS): PASS — A records 147.79.72.20 + 88.223.87.6, propagated
- Phase 8 (live verification): PASS
  - Health check: 200 `{"status":"ok","version":"1.0.0"}`
  - Install: `{"status":"registered","install_id":"376896ea75bac737"}`
  - Submit: `{"submission_id":"sub_43d891","rank":1,"is_new_top":true}`
  - Row TESTBUGS in production MySQL: id=1, fitness=0.5, submitted_at=2026-05-28 15:58:16 ✓
  - Top leaderboard returns pure JSON, no URLs/executable strings ✓
  - Server-side validation active (rejects bad genome length) ✓
- Phase 9 (commit + push + PR): PASS

## Bugs found this packet
- **pnpm 11 broke onlyBuiltDependencies** — field moved out of package.json, now in pnpm.yaml or .npmrc. Fixed by pre-compiling TypeScript with esbuild instead, eliminating tsx/esbuild from runtime deps entirely.
- **LiteSpeed loads entry file via require()** — top-level `await` in server.js crashes with ERR_REQUIRE_ASYNC_MODULE. Fixed by removing top-level await.
- **localhost resolves to ::1 in Node.js** — MySQL user u881291242_api has no ::1 grant. Fixed by replacing @localhost/ with @127.0.0.1/ in the DB URL at startup.

## Production deployment record
- App: api.alienclaw.net Node.js Web App (Hostinger Business UK)
- Deployed zip: alienclaw-deploy-v8.zip (2026-05-28 10:16:06)
- Runtime: Node 22.18.0 (LiteSpeed lsnode)
- DB: u881291242_leaderboard @ 127.0.0.1
- DB user: u881291242_api
- Credentials: .env.hostinger (local-only, gitignored)
- SSH: u881291242@82.29.191.62 -p 65002

## L5 status
**CLOSED.** api.alienclaw.net reachable. Submission persists to MySQL. Trust model verified.

## Launch blocker scoreboard
- L1 Empty LICENSE: CLOSED (Packet 30)
- L2 No API key docs: CLOSED (Packet 30)
- L3 openclaw configure black box: CLOSED (Packet 30)
- L4 Broken install.sh: CLOSED (Packet 30.5)
- L5 Leaderboard placeholder: **CLOSED (Packet 35)**

## Outstanding for Bugsy
- Update ALIENCLAW_DB_URL env var in hPanel to use 127.0.0.1 (currently patched in server.js as a workaround — should be corrected in env vars UI)
- Back up .env.hostinger somewhere safe (1Password etc.) — production credentials
