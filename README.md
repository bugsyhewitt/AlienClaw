# AlienClaw — Three Agents, One Mission

AlienClaw is an overlay distribution on [OpenClaw](https://github.com/openclaw/openclaw) that adds a governed multi-agent hierarchy. You talk to **BossBot** — it coordinates everything else behind the scenes.

## Quick Start

```bash
# 1. Install OpenClaw
npm install -g openclaw

# 2. Configure OpenClaw
openclaw configure

# 3. Install AlienClaw
git clone https://github.com/AlienTool/AlienClaw.git
cd AlienClaw
bash install.sh

# 4. Talk to BossBot
openclaw chat
```

## The Three Agents

| Agent | Role |
|-------|------|
| **BossBot** 👽 | The only agent you talk to. Receives your goal, breaks it into campaigns, delegates. |
| **AdvisorBot** 🧠 | Stateless strategist. BossBot and CreatorBot consult it before major decisions. |
| **CreatorBot** 🔧 | Silent builder. Constructs Specialists per campaign, authors Martian genome files. |

**BossBot consults AdvisorBot before any non-trivial decision.** This is baked into both its SOUL and its AGENTS routing — it can't be bypassed by accident.

## How It Works

```
You → BossBot → AdvisorBot (consult)
           ↓
      CreatorBot → builds Specialist per campaign
           ↓
      Specialist → uses Martian execution agents (Martians)
           ↓
      Fitness reports → AdvisorBot + CreatorBot
           ↓
      AdvisorBot signs off → BossBot surfaces result to you
```

BossBot, AdvisorBot, and CreatorBot share a private inter-agent channel the user never sees.

## Martian Genome System

Martians are execution agents defined by 256-char Base62 genome files. CreatorBot evolves low-fitness genomes over time. The genome registry lives at `~/.alienclaw/registry/`.

## Commands

```bash
openclaw chat                  # Start a chat with BossBot
openclaw agents list            # List all agents
bash install.sh --dry-run      # Preview what install would do
bash install.sh --uninstall    # Remove AlienClaw agents (keeps OpenClaw)
```

## Project Structure

```
seed/agents/           # Per-agent workspace files (SOUL, AGENTS, TOOLS, HEARTBEAT, MEMORY)
src/alienclaw/         # Governance engine: state machine, Martian registry, CLI
installer/             # Install scripts
skills/                # Bundled skills
docs/                  # Documentation
```

## Uninstall

```bash
bash install.sh --uninstall
```

Removes the three AlienClaw agents from `~/.openclaw/agents/` but leaves OpenClaw and your config intact.
