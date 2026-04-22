# AlienClaw — Three Wired OpenClaw Agents

AlienClaw v0.1 configures OpenClaw with three pre-wired agents that talk to each other automatically. You talk to **BossBot**, which consults **AdvisorBot** for strategic thinking and can summon **CreatorBot** for building specialists.

## Quick Start

```bash
# 1. Install OpenClaw (if not already installed)
npm install -g openclaw

# 2. Run OpenClaw's setup wizard
openclaw configure

# 3. Clone and install AlienClaw
git clone https://github.com/AlienTool/AlienClaw.git
cd AlienClaw
bash install.sh

# 4. Start chatting with BossBot
openclaw chat
```

## The Three Agents

| Agent | Role | Emoji |
|-------|------|-------|
| **BossBot** | Your executive — receives goals, breaks them down, delegates | 👽 |
| **AdvisorBot** | Strategist — consulted on every non-trivial decision | 🧠 |
| **CreatorBot** | Builder — writes specialist spec files on request | 🔧 |

BossBot consults AdvisorBot **frequently** — not just on big decisions. Ask it something and watch it delegate.

## Package Managers

If you have Homebrew, Scoop, or winget available:

```bash
# Homebrew (macOS/Linux)
brew install alienclaw   # after adding the AlienClaw tap

# Scoop (Windows)
scoop bucket add alienclaw https://github.com/AlienTool/scoop-alienclaw
scoop install alienclaw

# winget (Windows)
winget install AlienTool.AlienClaw
```

## Commands

```bash
openclaw chat                 # Start a chat with BossBot
openclaw agents list          # List all agents
bash install.sh --uninstall    # Remove AlienClaw agents (keeps OpenClaw)
bash install.sh --dry-run      # Preview what install.sh would do
```

## Uninstall

```bash
bash install.sh --uninstall
```

This removes the three AlienClaw agents from `~/.openclaw/agents/` but leaves OpenClaw and your OpenClaw config intact.

## Package Manager Installers

| File | Purpose |
|------|---------|
| `scripts/homebrew-formula.rb` | Homebrew formula |
| `scripts/scoop-alienclaw.json` | Scoop bucket manifest |
| `scripts/winget-alienclaw.yaml` | winget manifest |
| `scripts/install-alienclaw.ps1` | Standalone PowerShell installer |
| `scripts/abduction.mjs` | Cosmetic animation at install time |

## What v0.1 Ships

- 3 preconfigured OpenClaw agents with personality, identity, and routing
- An idempotent installer (`bash install.sh`) that leaves OpenClaw vanilla
- BossBot as the default agent, AdvisorBot consulted frequently, CreatorBot on standby

## What v0.1 Does NOT Ship

- A Martian/genome evolution system (parked in `experimental/governance-engine/`)
- A community leaderboard at alienclaw.net
- Architecture A's overlay pipeline (`pnpm dist:all`, `reskin.sh`) — those are parked too