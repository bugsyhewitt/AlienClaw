# Packet 31.6 — Operator Install Audit

## Verdict: CONFIRMED DATABASE-FREE

Operators who install AlienClaw are never asked to set up a database.
The line is firm: the server (api.alienclaw.net) runs MySQL; operators run on files.

---

## What was checked

### install.sh
- Provisions three OpenClaw agent workspaces under `~/.openclaw/agents/`.
- Copies SOUL.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, MEMORY.md from `seed/agents/`.
- Sets `bossbot` as the default agent.
- **No database references. No MySQL. No DB setup step.**

### README.md
- Documents installation via `bash install.sh`.
- Documents API key generation (`openclaw api-key create`).
- Documents BossBot usage.
- **No instruction asks operators to set up a database.**

### docs/ directory
- `docs/MATHEMATICAL_FOUNDATIONS.md` line 469 mentions "database backend: SQLite or similar"
  in a theoretical section about Subagent evolution storage options (future work).
  This is not an operator instruction — it describes a potential future internal
  storage format for the evolution engine, not something operators install or run.
- `docs/ARCHITECTURE.md`, `docs/LESSONS_FROM_THE_ARC.md`, `docs/specs/` — none
  contain any instruction for operators to set up a database.

### CreatorBot / leaderboard_check
- The leaderboard submission artifact that `leaderboard_check` writes is a plain
  local file (`~/.openclaw/agents/bossbot/leaderboard_submission.json` or similar).
- No database involved on the operator side.

---

## Storage split — confirmed

| Layer     | Storage    | Who runs it          |
|-----------|------------|----------------------|
| API server | MySQL (via `ALIENCLAW_DB_URL`) | Bugsy's Hostinger — server side only |
| Operator  | Local files | Operator's machine — no database |

---

## Corrections made

None required. The operator install path is clean. No documentation was found
that asks operators to set up a database.
