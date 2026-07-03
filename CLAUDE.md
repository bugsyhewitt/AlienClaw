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

## Operational notes for autonomous sessions

Hard-won rules for unattended agents working this repo (added 2026-07-03):

1. **Gate shell chains on exit codes, never `grep FAIL`** — grep exits 0 when it *finds* failures, and the chain marches on.
2. **`gh pr merge --delete-branch` lies when a worktree pins the local branch**: the merge succeeds, the exit code doesn't. Judge success by `gh pr view <n> --json state`; sweep leftover remote branches afterwards.
3. **pytest-green is not CI-green.** CI ruff-lints Python (100-char lines) in the `genome`/`brains`/`evolution` scopes only — run `ruff check src/alienclaw/{genome,brains,evolution}/ test/{genome,brains,evolution}/` before pushing (requirements-dev.txt pins ruff; use a venv).
4. **`cd` persists between shell calls.** Pin absolute paths or re-`cd` at the top of every compound command, especially around worktrees.
5. **Never deploy or submit without an explicit user go.** Live alienclaw.net is the separate `alienclaw-site` repo; the in-repo `site/` is retired and `scripts/deploy.sh` refuses without `ALIENCLAW_DEPLOY_LEGACY_SITE=1`. Genome submissions to api.alienclaw.net are user-triggered only.
6. **"Specialist" (capital S) is a banned identifier** in code/tests — wall-check fails CI. The layer is `Subagent`.
7. **Check open *and recently merged* PRs before starting ROADMAP items** — parallel sessions land work; don't duplicate an in-flight thread.
8. **Salvage dead agents before re-dispatching**: crashed worktree sessions (usage limits) leave committed or uncommitted work under `.claude/worktrees/` — ship it, don't rewrite it.
9. **No stray `*.test.*` files under `MEMORY/`** — vitest globs them; archive test files with a `.salvaged` suffix. Session PRDs are committed under `MEMORY/WORK/` per convention.
10. **No branch protection exists**: red checks don't block `gh pr merge`, so verify the 7 substantive checks pass yourself before merging anything.
