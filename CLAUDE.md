# CLAUDE.md — AlienClaw

This file gives Claude Code context for working in this repo. Read it before any task.

## What AlienClaw is

AlienClaw is an overlay distribution on [OpenClaw](https://github.com/openclaw/openclaw). OpenClaw is installed via npm. AlienClaw configures three OpenClaw agents — **BossBot**, **AdvisorBot**, **CreatorBot** — with pre-written SOULs and AGENTS routing so they coordinate automatically. BossBot is the only agent the user talks to.

## Repo layout

- `install.sh` — the installer. Provisions 3 agent workspaces under `~/.openclaw/agents/`.
- `seed/agents/bossbot/`, `seed/agents/advisorbot/`, `seed/agents/creatorbot/` — per-agent workspace files (SOUL.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, MEMORY.md) that the installer copies.
- `src/alienclaw/` — the governance engine: state machine, Martian registry, genome codec, CLI entry point.
- `installer/` — install scripts.
- `skills/` — bundled skills.
- `docs/` — user-facing documentation.
- `test/` — test suite.

## Hard rules for Claude Code

1. **Never add `agentId` to `agents.defaults` in `openclaw.json`.** OpenClaw 2026.4+ rejects `agentId` as invalid. Only set `agents.defaults.workspace` to the agent folder path.
2. **Never modify `~/.openclaw/openclaw.json` without backing it up first.** Use `cp "$HOME/.openclaw/openclaw.json" "$HOME/.openclaw/openclaw.json.backup-$(date +%s)"` before any write.
3. **Never use `env.argv`.** `env` is `process.env`; it has no `argv`. Use `process.argv`.
4. **Routing between agents happens via per-agent `AGENTS.md` files in each workspace.** Not via flat config entries.
5. **BossBot must consult AdvisorBot often.** Wired in two places: BossBot's `SOUL.md` instructs it to consult on every non-trivial decision, and BossBot's `AGENTS.md` lists AdvisorBot with `consult_frequency: high`. Do not remove either.
6. **Shell scripts target bash 3.2+** (macOS default), Linux, and WSL2. No zsh-only syntax, no Bash 4+ features unless gated.

## Standard tasks

- "Install works" means: after `bash install.sh`, `openclaw agents list` shows exactly three agents (bossbot, advisorbot, creatorbot), and bossbot is the default.
- "Routing works" means: in a bossbot session, asking "Consult AdvisorBot about X" produces a visible delegation to AdvisorBot and a returned response.

## What AlienClaw ships

- 3 preconfigured OpenClaw agents with SOUL, routing, and tool configuration.
- Governance engine (`src/alienclaw/`) with Martian genome registry and state-machine agent loop.
- An idempotent installer that leaves OpenClaw vanilla.
- BossBot as default, AdvisorBot consulted frequently, CreatorBot building specialists on request.

## What AlienClaw does NOT ship

- A community leaderboard at alienclaw.gg (future v0.2).
