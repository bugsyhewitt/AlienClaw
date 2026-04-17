# AlienClaw Agents — Spec

This file documents the three AlienClaw agents that the installer provisions in any OpenClaw instance. Each is a standard OpenClaw agent workspace under `~/.openclaw/agents/<id>/`.

## BossBot (id: bossbot, default: true)

- **Role:** User-facing executive. Receives goals conversationally. Breaks them down. Governs end-to-end.
- **Consults AdvisorBot:** on every non-trivial decision — goal decomposition, plan adjustments, completion review, failure triage.
- **Summons CreatorBot:** when a task needs a new specialist agent built from scratch (v0.2+ feature; in v0.1, CreatorBot is a placeholder that replies with an acknowledgement).
- **Does not call tools directly for complex tasks.** Delegates to AdvisorBot for thinking, CreatorBot for building.
- **Workspace:** `~/.openclaw/agents/bossbot/`
- **Seed files:** `seed/agents/bossbot/`

## AdvisorBot (id: advisorbot, default: false)

- **Role:** Strategic consultant. Pure reasoning. Does not call tools. Does not act.
- **Called by:** BossBot (frequently), CreatorBot (occasionally).
- **Stateless between calls.** Does not carry accumulated context — receives a brief, reasons, responds, forgets.
- **Workspace:** `~/.openclaw/agents/advisorbot/`
- **Seed files:** `seed/agents/advisorbot/`

## CreatorBot (id: creatorbot, default: false)

- **Role:** Silent builder. In v0.1, a placeholder. In v0.2+, builds purpose-built Specialists when BossBot requests.
- **Called by:** BossBot.
- **Does not initiate conversation.**
- **Workspace:** `~/.openclaw/agents/creatorbot/`
- **Seed files:** `seed/agents/creatorbot/`

## Routing

Each agent's `AGENTS.md` (inside its own workspace) lists the other two. That is how OpenClaw wires inter-agent calls. The seed files ship with this routing pre-configured.

## Default agent

BossBot is set as the default agent at install time by writing `agents.defaults.agentId = "bossbot"` (or equivalent per installed OpenClaw version — verify with `openclaw --help` before writing) into `~/.openclaw/openclaw.json`.

## The previously-default OpenClaw agent

At install time, any pre-existing default agent (typically under `~/.openclaw/workspace/` or `~/.openclaw/agents/main/`) is **moved to `~/.openclaw/agents/_archived_main_<timestamp>/`**, not deleted. Users can restore it manually if they want to revert.
