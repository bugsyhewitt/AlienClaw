# AlienClaw

Open-source agent infrastructure built around an evolutionary genome system.
You give BossBot a goal. It coordinates everything else behind the scenes.

**Status:** active development. Core architecture is in place. Genome evolution
loop and community network are in flight. See [ROADMAP.md](./ROADMAP.md).

## What is AlienClaw

AlienClaw is an overlay distribution on [OpenClaw](https://github.com/openclaw/openclaw).
Three fixed governance agents coordinate silently. You talk to one of them.

You give BossBot a goal in natural language. BossBot consults AdvisorBot
to refine the plan, then asks CreatorBot to build a Specialist tailored to
the campaign. The Specialist runs the campaign — when it needs a tool, it
summons a Martian. The Martian executes one task, reports its fitness, and
erases itself. The Specialist gives a brief campaign report to BossBot and
erases itself when the campaign ends.

Martians are defined by 256-character Base62 genomes. The genomes mutate,
crossover, and compete on fitness. CreatorBot evolves the local genome
population over time. The community genome network (in development) syncs
top-performing genomes globally so efficient agents propagate.

## Architecture

```
User
  ↓
BossBot ←→ AdvisorBot         (planning consults, every non-trivial decision)
  ↓
CreatorBot                    (builds Specialists per campaign)
  ↓
Specialist                    (ephemeral, custom-built per campaign)
  ↓
Martian                       (ephemeral, defined by 256-char Base62 genome)
  ↓
[result returns up the stack; fitness reported to AdvisorBot + CreatorBot]
```

Communication graph (enforced in `src/alienclaw/`):

- User talks only to BossBot
- BossBot consults AdvisorBot for every non-trivial decision
- BossBot delegates campaigns to CreatorBot
- CreatorBot creates Specialists; Specialists summon Martians
- Martians return data to Specialist; Specialists report to BossBot
- Martians report fitness to AdvisorBot and CreatorBot (not BossBot)
- Specialists and Martians self-erase when their work is done

| Layer | Agents | Lifecycle | Genome |
| --- | --- | --- | --- |
| Governance | BossBot, AdvisorBot, CreatorBot | Persistent | No |
| Campaign | Specialists | Ephemeral — per campaign | No (current scope) |
| Tool execution | Martians | Ephemeral — per tool task | Yes — 256-char Base62 |

## Before You Start: API Key

AlienClaw's agents call an LLM to think. You need an API key from at least one
of these providers:

| Provider | Environment variable |
| --- | --- |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` |
| OpenAI (GPT) | `OPENAI_API_KEY` |
| Google (Gemini) | `GEMINI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |

Set the variable in your shell before running anything:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # or whichever provider you use
```

If you skip this, `openclaw configure` will complete but BossBot will fail to
respond when you first chat. The error will say something like `No model provider
configured` or `API key missing`. See [.env.example](./.env.example) for the full
list of supported variables.

## Quick Start

```bash
# 1. Install OpenClaw (npm prerequisite)
npm install -g openclaw

# 2. Configure OpenClaw
openclaw configure

# 3. Install AlienClaw
git clone https://github.com/bugsyhewitt/AlienClaw.git
cd AlienClaw
bash install.sh

# 4. Talk to BossBot
openclaw chat
```

### What `openclaw configure` asks

Step 2 opens an interactive setup wizard. Here is what it covers:

**Gateway location** — choose *Local (this machine)*. This is the default; just
press Enter.

**Model provider** — this is where you set your API key. Select your provider
(Anthropic, OpenAI, Gemini, etc.) and paste the key when prompted. If you already
set the environment variable above, the wizard will detect it automatically.

**Other sections** (workspace, web, daemon, channels) — safe to skip on first run.
Press Ctrl+C or answer the "skip?" prompts to move past them.

To configure only the model/API key without going through all sections:

```bash
openclaw configure --section model
```

Preview the installer without running it: `bash install.sh --dry-run`

Uninstall (leaves OpenClaw and your config intact): `bash install.sh --uninstall`

## Project Structure

```
src/alienclaw/     Governance engine: agents, registry, genome codec, CLI
seed/agents/       Per-agent workspace files (SOUL, AGENTS, TOOLS, HEARTBEAT, MEMORY)
seed/ms/           Martian Spec reference files
seed/msb/          Martian brain files (tool execution logic)
installer/         Install scripts
test/              Tests
.github/           CI workflows
```

## Documentation

- [VISION.md](./VISION.md) — what AlienClaw is for and why
- [ROADMAP.md](./ROADMAP.md) — what is done, in flight, and next
- [CLAUDE.md](./CLAUDE.md) — rules for Claude Code contributors
- [SECURITY.md](./SECURITY.md) — security policy

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). One PR per issue; clean commit messages;
no bundled unrelated changes.

## License

See [LICENSE](./LICENSE).
