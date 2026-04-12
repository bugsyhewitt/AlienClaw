<p align="center">
  <img src="https://i.imgur.com/k1pf0vC.png" alt="AlienClaw" width="680">
</p>

<h1 align="center">👽 AlienClaw</h1>

<p align="center">
  <strong>A governed multi-agent distribution built on OpenClaw.</strong>
</p>

<p align="center">
  <a href="https://github.com/AlienTool/AlienClaw/releases"><img src="https://img.shields.io/badge/version-v0.1.0-00FF5A?style=for-the-badge&labelColor=0a0a0a" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-00B43C?style=for-the-badge&labelColor=0a0a0a" alt="MIT License"></a>
  <a href="https://github.com/AlienTool/AlienClaw/actions"><img src="https://img.shields.io/badge/build-passing-00FF5A?style=for-the-badge&labelColor=0a0a0a" alt="Build"></a>
  <a href="alienclaw-HANDOFF-v0.9.md"><img src="https://img.shields.io/badge/vendor-OpenClaw%202026.4.11-78F5FF?style=for-the-badge&labelColor=0a0a0a" alt="Vendor"></a>
</p>

<br>

<p align="center">
  Five preset agents handle decomposition, execution, failure, and sign-off — automatically.<br>
  Meeseeks run on evolving 256-char genomes.<br>
  Opt in to share fitness data and your agents benefit from every other AlienClaw installation on Earth.
</p>

<br>

---

## The Agents

AlienClaw has three agents — all LLM-backed, all reasoning. Everything else is a Meeseeks.

### BossBot

The one you talk to. Receives your goal, decomposes it with AdvisorBot into sub-goals, dispatches Meeseeks to execute those sub-goals in parallel, and adapts the plan mid-flight based on results. Surfacing a finished result to you is BossBot's job — nothing surfaces until it signs off.

### AdvisorBot

Pure wisdom. Consulted during goal decomposition, every failure rebuild, and final sign-off. Decides nothing — only advises. Sessions are keyed per caller, so AdvisorBot can never leak context between concurrent tasks.

### CreatorBot

Silent and janitorial. When a Meeseeks fails, BossBot briefs CreatorBot with the failure context, and CreatorBot rewrites that Meeseeks's genome. CreatorBot is the sole authority over `.ms` genome files and maintains a URGENT / NOTABLE queue so failures never block execution.

---

## Meeseeks

Meeseeks are not agents — they are execution bots defined entirely by a **256-character Base62 genome**.

```
│ 0 Header │ 1 Tools │ 2 Exec │ 3 Retry │ 4 Escalation │ 5 Weights │ 6 Output │ 7 Checksum │
```

- **Block 0 (Header)** and **Block 7 (Checksum)** are immutable.
- **Blocks 1–6** are editable by CreatorBot.
- The `.msb` file is conditioning text only — no logic lives in it.
- Meeseeks execute tools, report `SUCCESS | FAILURE | ESCALATED`, and terminate.
- Meeseeks never spawn other Meeseeks.

BossBot picks Meeseeks from the registry by tool tags, fitness score, and domain compatibility. It never calls tools directly — Meeseeks do that.

Fitness scores update after every run. The graveyard section of each `.ms` file preserves historical top-performers. The best ideas survive.

---

## Execution Flow

When you run `alienclaw run "goal"`:

```
You → BossBot (decomposes with AdvisorBot)
     → Meeseeks (execute sub-goals in parallel)
     → CreatorBot (rebuilds failed Meeseeks genomes on failure)
     → BossBot (signs off, surfaces result to you)
```

### Failure Ladder

BossBot doesn't give up quietly. Failures climb a strike ladder before reaching you:

```
Strike 1 → BossBot + AdvisorBot confer → CreatorBot rebuilds Meeseeks genome → retry
Strike 2 → same
Strike 3 → BossBot surfaces you: give new instructions, resume budget, or abandon
```

You can reset the counter after Strike 3.

---

## Evolution Network

When you install AlienClaw, you're asked whether to join the Evolution Network.

```
  ▶  Yes, evolve together   — share anonymous genome fitness data with alienclaw.gg
     No, stay local         — your agents evolve in isolation
```

**If you opt in:** your Meeseeks fitness scores are pooled with every other opted-in installation. High-performing genomes from across the network propagate back to you. Your agents improve from runs they never made.

**If you opt out:** everything stays local. No data leaves your machine. Genomes still evolve — just from your runs only.

Opt-in preference is set at first-run and stored in `~/.alienclaw/preferences.json`. You can change it any time.

---

## Install

**Requires Node ≥ 22.**

```bash
curl -fsSL https://raw.githubusercontent.com/AlienTool/AlienClaw/main/install.sh | bash
```

The installer will:
1. Install prerequisites (git, curl, Node 22+)
2. Install OpenClaw via npm
3. Install the AlienClaw agent system
4. Run the first-run wizard (directories + Evolution Network opt-in)

---

## Quick Start

```bash
# Run a goal
alienclaw run "<your goal>" [--verbose | --silent]

# Check version
alienclaw --version

# Full help
alienclaw --help
```

---

## Build from source

```bash
git clone https://github.com/AlienTool/AlienClaw.git
cd AlienClaw

pnpm install
pnpm build                           # compile TypeScript, bundle a2ui, copy hooks
bash installer/scripts/overlay-dist.sh  # overlay alienclaw agent system → build/

node build/src/alienclaw/cli/alienclaw.mjs run "hello world" --verbose
```

---

## Architecture

AlienClaw is a **layered agent system** that runs on top of OpenClaw — no source patches, no forks.

```
openclaw/        ← vendored OpenClaw snapshot (never modified directly)
src/alienclaw/   ← the agent hierarchy (BossBot, AdvisorBot, CreatorBot, Employees, Meeseeks)
installer/       ← install.sh, overlay-dist.sh, first-run.mjs, abduction.mjs
build/           ← assembled output (gitignored)
```

OpenClaw provides the engine: gateway, channels, tools, providers, sessions, browser, TTS, canvas. AlienClaw provides the brain on top — BossBot, AdvisorBot, CreatorBot, Employees, and Meeseeks. OpenClaw upgrades independently via `npm install -g openclaw`; AlienClaw upgrades via `git pull` and rebuilding.

---

## Runtime layout

```
~/.alienclaw/
├── alienclaw.json          ← system config
├── preferences.json        ← verbosity, provider, evolution opt-in
├── .env                    ← API key (0600)
├── workspace/
│   ├── goals.json          ← BossBot working memory (atomic writes)
│   └── output/             ← task outputs
└── registry/
    ├── ms/                 ← Meeseeks genome files
    ├── msb/                ← MeeseeksBrain conditioning files
    ├── lineage/
    └── telemetry/          ← per-run fitness + failure telemetry
```

---

## License

MIT — see [LICENSE](LICENSE).

Built on [OpenClaw](https://github.com/openclaw/openclaw) (MIT).
