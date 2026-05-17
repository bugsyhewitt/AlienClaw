# Packet 31 — Deployment Record

## Status: AWAITING BUGSY EXECUTION

The code is complete and pushed (360e6b97). The deployment to Hostinger
requires Bugsy's direct involvement (Hostinger account access, DNS control).

---

## What needs to happen (step by step)

### Step 1: Set up the MySQL database for the leaderboard

In Hostinger hPanel → Websites → alienclaw.net → Databases:

1. Create a new MySQL database:
   - Name: `u881291242_leaderboard` (or similar)
   - User: create a dedicated user with password
2. Open phpMyAdmin for the new database
3. Run `migrations/001_leaderboard.sql` in phpMyAdmin's SQL tab

**Note on MySQL compatibility:** The migration uses `REGEXP` in the CHECK
constraint. If the Hostinger MySQL version doesn't support CHECK constraints
with REGEXP (MySQL < 8.0.16), remove the CONSTRAINT and rely on application-
level validation only.

### Step 2: Set environment variables in Hostinger

In hPanel → Websites → alienclaw.net → Environment variables, add:

```
ALIENCLAW_DB_URL=mysql://USER:PASSWORD@HOST/DATABASE
ALIENCLAW_API_DATA_ROOT=/home/u881291242/alienclaw-data
ALIENCLAW_API_PORT=8080
```

Where USER, PASSWORD, HOST, DATABASE are from the MySQL database created above.

If MySQL integration isn't available yet, use flat-file storage instead:
- Set only `ALIENCLAW_API_DATA_ROOT` pointing to a writable directory
- The API server defaults to flat-file storage automatically

### Step 3: Deploy the TypeScript API (Packet 31.5 — replaces Python)

**Note:** The Python API was ported to TypeScript in Packet 31.5. The API is now
TypeScript (Node.js). The deployment instructions below are updated accordingly.

In hPanel → Websites → alienclaw.net → Deployments:

1. Connect to the GitHub repo (github.com/AlienTool/AlienClaw)
2. Branch: main
3. Run `npm install` (installs tsx and other deps)
4. Start command: `npm start` (runs `tsx src/alienclaw/api/main.ts`)
5. Set environment variables: ALIENCLAW_API_DATA_ROOT, ALIENCLAW_API_PORT

The API runs on Node.js (no Python required). See packet-31.5-manual-steps.md
for exact Hostinger-panel steps.

### Step 4: Set DNS for api.alienclaw.net

In hPanel → Domains → alienclaw.net → DNS Zone:

Add an A record:
- Name: `api`
- Type: A
- Value: [the IP address of the deployed API server]
- TTL: 3600

Or a CNAME record if using a PaaS:
- Name: `api`
- Type: CNAME
- Value: [the PaaS URL, e.g., `alienclaw-api.onrender.com`]

### Step 5: Verify

```bash
curl https://api.alienclaw.net/v1/health
# Expected: {"status": "ok", "version": "...", "uptime_seconds": ...}

curl "https://api.alienclaw.net/v1/genomes/top?martian_type=compute&n=5"
# Expected: {"martian_type": "compute", "genomes": [], "total_for_type": 0}
```

---

## Alternative: Use Render.com (faster than Hostinger for Python APIs)

If Hostinger doesn't support persistent Python processes:

1. Sign up at render.com (free tier available)
2. Connect github.com/AlienTool/AlienClaw
3. Create a Web Service: Python, start command `PYTHONPATH=src python3 -m alienclaw.api`
4. Add environment variables in Render's dashboard
5. In Hostinger DNS, add CNAME: `api` → `alienclaw-api.onrender.com`

Render's free tier sleeps after 15 minutes of inactivity — fine for v1 when
traffic is low. The first request after sleep takes ~30s. This is acceptable
for a community leaderboard.

---

## Current state

- Code: committed and pushed (360e6b97)
- CI: running on GitHub Actions
- Database: MySQL schema in migrations/001_leaderboard.sql (ready to run)
- DNS for api.alienclaw.net: not yet set (HTTP 000 in Packet 29 audit)
- API server: not yet deployed

L5 is PARTIAL — code is complete and correct; deployment awaits Bugsy's
execution of the steps above.
