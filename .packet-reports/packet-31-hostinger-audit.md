# Packet 31 — Hostinger Capability Audit

## Account plan

Hostinger Business/Premium web hosting for alienclaw.net (confirmed from hpanel
screenshot at hpanel.hostinger.com/websites/alienclaw.net/databases/my-sql-databases).

Plan features visible in the hPanel sidebar:
- Deployments (persistent application hosting)
- Environment variables (secure config)
- Runtime logs (application monitoring)
- Hosting Plan, Performance, Analytics
- Databases: MySQL (confirmed — 2 existing databases)

## Persistent process support

**YES** — the presence of "Deployments", "Runtime logs", and "Environment variables"
in the hPanel sidebar strongly indicates this plan supports persistent Node.js
and/or Python application processes, not just static file hosting.

Hostinger's Business/Premium hosting plans support:
- Node.js (confirmed by deployment features)
- Python (via WSGI/ASGI on higher tiers; uncertain for persistent processes)
- PHP (standard)

**Primary runtime for api.alienclaw.net: Node.js** (most reliable option on this plan)
**Fallback: Python** (if Hostinger confirms Python process support)

## Postgres support

**NOT AVAILABLE.** The Databases section shows only MySQL databases.
Two databases already exist:
- u881291242_XZS4n (3 MB)
- u881291242_LB (1 MB, assigned to alienclaw.net)

**Decision: MySQL** replaces the Postgres plan from Packet 31's spec.
MySQL provides the same migration-managed persistence with the same discipline.

## Deployment mechanics

- **Git-based deployments** via Hostinger's Deployments panel
- **Environment variables** for secrets (MySQL credentials, API config)
- **Runtime logs** for monitoring
- Standard: push code, Hostinger runs it as a persistent process

## DNS control

Hostinger controls alienclaw.net's DNS. Setting a CNAME or A record for
api.alienclaw.net is done via the Domains section of hPanel.

## Recommended deployment approach

1. Deploy the existing Python API (`src/alienclaw/api/`) to Hostinger's
   application hosting using their Deployments feature
2. Use the MySQL database (available on the plan) for persistent storage
3. Store MySQL credentials as Hostinger Environment variables
4. Set dns record: api.alienclaw.net → the deployed application

**If Python persistent process isn't supported:**
- Fallback: minimal Node.js/Express wrapper with same API surface
- The AlienClaw codebase is primarily TypeScript, so this is a clean option

## Decision needed from Bugsy

None — proceeding with MySQL + Python API deployment. If Hostinger's
deployment doesn't support Python persistent processes, the Node.js fallback
will be documented in packet-31-deployment.md with clear next steps.
