# CLAUDE.md — AlienClaw

This file gives Claude Code context for working in this repo. Read it before any task.

## What AlienClaw is (short version)

AlienClaw is a thin add-on for OpenClaw (https://github.com/openclaw/openclaw, MIT). OpenClaw stays a vanilla npm install. AlienClaw's job is to configure three OpenClaw agents — **BossBot**, **AdvisorBot**, **CreatorBot** — with pre-written personalities and routing so they talk to each other automatically. BossBot is the user-facing agent and consults AdvisorBot frequently during any task.

## Repo layout

- `install.sh` — the installer. Installs OpenClaw via npm if missing, then provisions 3 agent workspaces under `~/.openclaw/agents/`.
- `seed/agents/bossbot/`, `seed/agents/advisorbot/`, `seed/agents/creatorbot/` — the per-agent workspace files (SOUL.md, IDENTITY.md, AGENTS.md, USER.md, TOOLS.md, HEARTBEAT.md, MEMORY.md) that the installer copies.
- `openclaw/` — was a vendored OpenClaw snapshot, now removed (v0.1 installs OpenClaw via npm). Kept as placeholder for reference only.
- `experimental/governance-engine/` — parked v0.2 work (Martian genomes, governance loop). Not shipped in v0.1. Do not touch unless asked.
- `docs/` — user-facing docs.
- `scripts/` — maintenance scripts.

## Hard rules for Claude Code

1. **Never add `agentId` to `agents.defaults` in `openclaw.json`.** OpenClaw 2026.4+ rejects `agentId` as invalid. Only set `agents.defaults.workspace` to the agent folder path.
2. **Never modify `~/.openclaw/openclaw.json` without backing it up first.** Use `cp "$HOME/.openclaw/openclaw.json" "$HOME/.openclaw/openclaw.json.backup-$(date +%s)"` before any write.
3. **Never use `env.argv`.** `env` is `process.env`; it has no `argv`. Use `process.argv`.
4. **Never ship TypeScript that the installer assumes is pre-built** unless the install step actually builds it. AlienClaw v0.1 ships plain markdown + plain Node; no TypeScript at runtime.
5. **Routing between agents happens via per-agent `AGENTS.md` files in each workspace.** Not via flat config entries. If you're tempted to register agents by adding JSON to `openclaw.json`, you are doing it wrong.
6. **BossBot must consult AdvisorBot often.** This is wired in two places: (a) BossBot's `SOUL.md` instructs it to consult on every non-trivial sub-task, and (b) BossBot's `AGENTS.md` lists AdvisorBot as a known agent with `consult_frequency: high`. Do not remove either.
7. **Shell scripts target bash 3.2+** (macOS default), Linux, and WSL2. No zsh-only syntax, no Bash 4+ features unless gated.

## Standard tasks

- "Install works" means: after `bash install.sh`, `openclaw agents list` shows exactly three agents (bossbot, advisorbot, creatorbot), and bossbot is marked default.
- "Routing works" means: in a bossbot session, asking "Consult AdvisorBot about X" produces a visible delegation to AdvisorBot and a returned response.
- Verification script lives at `scripts/verify-install.sh`. Run it after any change to `install.sh` or seed files.

## What v0.1 ships

- 3 preconfigured OpenClaw agents with personality, identity, and routing.
- An installer that is idempotent and leaves OpenClaw vanilla.
- BossBot-default, AdvisorBot consulted often, CreatorBot on standby for building new specialists when BossBot asks.

## What v0.1 does NOT ship

- The Martian genome evolution system (parked in `experimental/`).
- A separate `alienclaw` CLI (v0.1 uses `openclaw` directly; BossBot is just the default agent).
- A community leaderboard at alienclaw.net (future v0.2).

## When in doubt

Read `ALIENCLAW_REMEDIATION_PLAN.md` at the repo root. It explains the current state of the repo and the migration rationale.