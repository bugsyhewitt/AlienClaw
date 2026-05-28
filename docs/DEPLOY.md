# Deploying api.alienclaw.net

api.alienclaw.net runs as a Node.js Web App on Hostinger Business UK.

## Prerequisites

- SSH access: `ssh -p 65002 u881291242@82.29.191.62`
- Hostinger hPanel access at https://hpanel.hostinger.com
- `.env.hostinger` with production credentials (keep local, never commit)

## Build the deploy artifact

```bash
bash scripts/build-deploy.sh
```

This produces `/tmp/alienclaw-deploy.zip` (~8KB). The script:
- Pre-compiles `src/alienclaw/api/main.ts` with esbuild into `dist/main.js`
- Copies `server.js` (the LiteSpeed entry point — no top-level await)
- Writes a minimal `package.json` (mysql2 dependency only)
- Guards against top-level await in server.js (fails loudly if found)
- No `node_modules` — Hostinger installs them from `package.json` post-extract

## Upload to Hostinger

1. Log in to [hpanel.hostinger.com](https://hpanel.hostinger.com)
2. Navigate to **Websites → api.alienclaw.net → Node.js Apps**
3. Find the **Deployments** section and click **New deployment**
4. Select **Upload file** and upload `/tmp/alienclaw-deploy.zip`
5. Set entry file to `server.js` and Node.js version to 22.x
6. Click **Deploy**

## Verify after deploy

```bash
# Health check
curl https://api.alienclaw.net/v1/health

# Expected: {"status":"ok","version":"1.0.0","uptime_seconds":N}
```

If the app crashes with `ERR_REQUIRE_ASYNC_MODULE`: the deployed `server.js`
contains a top-level `await`. Run `scripts/build-deploy.sh` — it will fail with a
clear error if this is the case. See `docs/LESSONS_FROM_THE_ARC.md` Bug #16.

## Restart without redeploying

Touch the restart file over SSH:

```bash
ssh -p 65002 u881291242@82.29.191.62 \
  "touch ~/domains/api.alienclaw.net/nodejs/tmp/restart.txt"
```

Wait ~5–10 seconds, then verify health.

## Environment variables

The `ALIENCLAW_DB_URL` and other env vars are set in the hPanel Node.js Apps UI
under **Environment variables**. They are injected into the process at runtime —
not stored in any file on the VPS. The `.builds/config/.env` file on the server
is a read-only copy Hostinger maintains for reference.

Use `127.0.0.1` (not `localhost`) in `ALIENCLAW_DB_URL` — Node.js 17+ resolves
`localhost` to `::1` (IPv6), but the MySQL user grant is on `127.0.0.1` (IPv4).
See `docs/LESSONS_FROM_THE_ARC.md` Bug #17.

## SSH details

| Field | Value |
|-------|-------|
| Host | 82.29.191.62 |
| Port | 65002 |
| User | u881291242 |
| Auth | public key (add via hPanel → SSH Keys) |

## Production database

- Host: 127.0.0.1 (same VPS, accessible via TCP)
- DB name: u881291242_leaderboard
- DB user: u881291242_api
- Credentials: stored in `.env.hostinger` (local-only, gitignored)
- Tables: `installs`, `leaderboard_entries` (see `migrations/001_leaderboard.sql`)
