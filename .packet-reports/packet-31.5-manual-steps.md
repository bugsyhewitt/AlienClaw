# Packet 31.5 — Manual Deployment Steps (Bugsy)

These steps require the Hostinger hPanel and cannot be done by the packet.
Do them in this exact order.

---

## Step 1 — Install tsx dependency

```bash
# In the alienclaw repo:
npm install
# This installs tsx (the TypeScript runtime for production) and other deps.
# commit the resulting package-lock.json if it's generated
```

## Step 2 — Create the MySQL database on Hostinger

In hPanel → Websites → alienclaw.net → Databases → Management:

1. Under "Create a New MySQL Database And Database User":
   - Database name: `leaderboard` (Hostinger prepends u881291242_ automatically)
   - Username: `api` (or similar)
   - Password: generate a strong password (≥16 chars, save it)
2. Click Create
3. Note the full database name: `u881291242_leaderboard` and username: `u881291242_api`

## Step 3 — Run the schema migration

In hPanel → Websites → alienclaw.net → Databases → phpMyAdmin:

1. Select the `u881291242_leaderboard` database
2. Click the "Import" tab
3. Choose file: `migrations/001_leaderboard.sql` from the repo
4. Click "Go" to run it
5. Verify: the `leaderboard_entries` table now exists with columns:
   `id`, `leaderboard_name`, `genome`, `martian_type`, `fitness`,
   `api_key_hash`, `submitted_at`, `submission_id`, `run_metadata`

**MySQL version note:** If you get an error about the CHECK constraint with REGEXP,
remove the `CONSTRAINT chk_leaderboard_name` block from the SQL (the application
validates names before the database; the CHECK is defense-in-depth).

## Step 4 — Set environment variables on Hostinger

In hPanel → Websites → alienclaw.net → Environment variables:

Add these variables:
```
ALIENCLAW_API_DATA_ROOT = /home/u881291242/alienclaw-data
ALIENCLAW_API_PORT      = 8080
ALIENCLAW_API_HOST      = 0.0.0.0
```

The `ALIENCLAW_API_DATA_ROOT` path must be writable. Use a path in your home
directory (not `/var/alienclaw` which is the server default — Hostinger shared
hosting won't have write access there).

## Step 5 — Deploy the TypeScript API

In hPanel → Websites → alienclaw.net → Deployments:

**If there's a placeholder Node.js app already deployed:**
1. Find it in the Deployments list
2. Delete / remove it (it's the confirmed throwaway placeholder)

**Deploy the AlienClaw API:**
1. Connect to GitHub: AlienTool/AlienClaw
2. Branch: main
3. Build command: `npm install` (installs tsx and all deps)
4. Start command: `npm start` (runs `tsx src/alienclaw/api/main.ts`)
5. Click Deploy
6. Wait for the deployment status to show "Running" or "Active"
7. Note the deployment URL/IP address (you'll need it for DNS in Step 6)

## Step 6 — Wire api.alienclaw.net DNS

In hPanel → Domains → alienclaw.net → DNS Zone:

Add a record:
- **If Hostinger gives you an IP address for the deployment:**
  - Name: `api`
  - Type: `A`
  - Value: `[the IP address]`
  - TTL: 3600

- **If Hostinger gives you a hostname for the deployment:**
  - Name: `api`
  - Type: `CNAME`
  - Value: `[the deployment hostname]`
  - TTL: 3600

DNS propagation takes up to 48 hours; usually much faster (minutes to hours).

## Step 7 — Verify the deployment

Once DNS has propagated:

```bash
curl https://api.alienclaw.net/v1/health
# Expected: {"status":"ok","version":"1.0.0","uptime_seconds":<N>}

curl "https://api.alienclaw.net/v1/genomes/top?martian_type=compute&n=5"
# Expected: {"martian_type":"compute","genomes":[],"total_for_type":0}

# Test name constraint (should return 400):
curl -X POST https://api.alienclaw.net/v1/install \
  -H "Content-Type: application/json" \
  -d '{"api_key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","machine_hash":"'$(python3 -c "print('a'*64)'")'}'
```

## Tell the packet executor when done

Provide:
1. The MySQL database name and host (from Step 2)
2. The deployment URL/status (from Step 5)
3. Confirmation the DNS record was added (from Step 6)

The live verification phase (Phase 7) then runs curl tests against
api.alienclaw.net.
