<p align="center">
  <img src="https://i.imgur.com/k1pf0vC.png" alt="AlienClaw" width="680">
</p>

<h1 align="center">👽 AlienClaw</h1>

<p align="center">
  <strong>A self-evolving AI agent hierarchy that thinks at the top and executes at the edge.</strong>
</p>

<p align="center">
  <a href="https://github.com/AlienTool/AlienClaw/releases"><img src="https://img.shields.io/badge/version-v0.1.0-00FF5A?style=for-the-badge&labelColor=0a0a0a" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-00B43C?style=for-the-badge&labelColor=0a0a0a" alt="MIT License"></a>
  <a href="https://github.com/AlienTool/AlienClaw/actions"><img src="https://img.shields.io/badge/build-passing-00FF5A?style=for-the-badge&labelColor=0a0a0a" alt="Build"></a>
  <a href="alienclaw-HANDOFF-v0.9.md"><img src="https://img.shields.io/badge/vendor-OpenClaw%202026.4.11-78F5FF?style=for-the-badge&labelColor=0a0a0a" alt="Vendor"></a>
</p>

<br>

<p align="center">
  Three lean command agents plan and orchestrate — they never touch tools.<br>
  Purpose-built Specialists carry deep campaign knowledge and are disposed when the mission ends.<br>
  Martians execute at the edge, guided by 256-char genomes that evolve with every run.<br>
  Opt in to share fitness data and your agents benefit from every AlienClaw installation on Earth.
</p>

<br>

> *"Most agent frameworks give you one brain doing everything. AlienClaw gives you a chain of command — and that chain gets smarter every time it runs."*

---

## The Command Tier

AlienClaw's three Tier-A agents are permanently alive, LLM-backed, and **strictly forbidden from calling tools directly**. Their authority is to think, plan, and build — nothing more.

### 🧠 BossBot — The Executive

The one you talk to. BossBot receives your goal and immediately enters a **scheming phase** — it works with AdvisorBot to design a complete Scheme before a single task is dispatched. No improvisation. No premature execution. The plan is agreed first.

Once a Scheme is locked, BossBot hands it to CreatorBot with a clear mandate: *build these specialists.* After that, BossBot governs the campaign lifecycle: tracking progress, handling escalations, and surfacing the final result to you when AdvisorBot signs off. Stays lean by never tracking raw execution state directly.

### 🔭 AdvisorBot — The Strategist

Pure wisdom. AdvisorBot co-authors the Scheme with BossBot, stress-tests assumptions during planning, and receives every execution report that flows up from Specialists and Martians. It is the system's strategic memory in motion.

AdvisorBot is stateless between calls. It carries no accumulated context of its own — it receives structured reports, reasons over them precisely, and responds. This is intentional. Statelessness is what keeps AdvisorBot sharp: it cannot drift, accumulate bias, or conflate campaigns. Sessions are keyed per caller so context never leaks between concurrent goals.

### ⚙️ CreatorBot — The Builder

Silent, scheduled, and essential. CreatorBot runs on a heartbeat — auditing the Martian registry, validating genome checksums, maintaining a prioritized URGENT / NOTABLE queue. When a Scheme arrives, CreatorBot reads the specialist roles and **builds every agent the campaign needs**: the right domain, the right tools, the right campaign knowledge baked directly into each Specialist's identity.

CreatorBot is the sole authority over `.ms` genome files. No other agent can write them. When campaigns end, CreatorBot disposes their specialists and reclaims the slot. The workforce stays exactly as large as the active mission requires — no more.

---

## Campaigns & Specialists

When BossBot and AdvisorBot agree on a Scheme, they're not producing a task list. They're producing a **campaign blueprint** — a structured plan that maps out every Campaign needed to reach the goal, the dependency edges between them, and exactly what kind of Specialist each Campaign requires.

**A Campaign is a cohesive, bounded unit of work.** "Build the data pipeline." "Write and validate the API layer." "Deploy and verify production." Campaigns execute in parallel where their dependencies allow, in sequence where they don't.

Each Campaign gets its own **Specialists** — agents created from scratch by CreatorBot, carrying deep, campaign-specific knowledge injected directly into their soul at construction time. A Specialist for a deployment campaign knows everything about that deployment: what tools are available, what success looks like, what failure means, and which Martians it is authorised to summon.

**Specialists are temporary by design.** They exist for the duration of their campaign and nothing more. When the campaign ends, they are disposed. This is not a limitation — it's the architecture. Purpose-built agents with bounded scope are more capable within that scope than generalist agents trying to know everything. And when they're gone, they take their context with them. No drift. No contamination. Every campaign starts clean.

The only way a Specialist can interact with the outside world is to **summon a Martian**.

---

## The Martian System

Here is where AlienClaw becomes genuinely different from anything else you've seen.

At the execution edge are **Martians** — lightweight, disposable execution primitives that actually call tools, run code, and interact with systems. A Martian has no planning capability, no long-term memory, and no authority to spawn further agents. It receives a task, runs the tools it was built for, and returns a result.

What makes Martians extraordinary is how they're defined — and how they evolve.

### Genomes

Every Martian is defined by a **256-character Base62 genome** — a compact, machine-readable fingerprint encoding its complete behavioral identity:

```
│ IDENTITY (64) │ EXECUTION (64) │ BEHAVIOR (64) │ CHECKSUM (64) │
```

- **IDENTITY** — What domain this Martian owns, what tools it operates, who created its lineage
- **EXECUTION** — How it approaches tool calls, retry logic, escalation thresholds
- **BEHAVIOR** — Reasoning style, output format, failure handling preferences
- **CHECKSUM** — Cryptographic integrity block, detected by CreatorBot's scheduled genome audit

Two Martians with different genomes, running identical tools on identical tasks, will behave differently. The genome *is* the agent. The `.msb` conditioning file provides context — no logic lives there.

### Fitness and the Evolution Network

Every time a Martian runs, its performance is measured. Success rate. Retry count. Escalation frequency. Output quality. These outcomes feed a **fitness score** that CreatorBot tracks across the Martian's lineage.

High-fitness genomes are preserved and propagated. Low-fitness genomes are flagged, quarantined, or rewritten. The Martian population evolves — not through random mutation, but through **selection pressure applied by real-world execution data**.

This is machine learning without a training loop. The system learns by running.

When you install AlienClaw, you're asked whether to join the Evolution Network:

```
  ▶  Yes, evolve together   — share anonymous genome fitness data with alienclaw.gg
     No, stay local         — your Martians evolve in isolation
```

**If you opt in:** your Martian fitness scores are pooled with every other opted-in installation worldwide. High-performing genomes propagate back to you. Your agents improve from runs they never made — the collective execution history of the entire AlienClaw network working in your favor.

**If you opt out:** everything stays local. No data leaves your machine. Genomes still evolve — just from your runs only.

Opt-in preference is set at first-run and stored in `~/.alienclaw/preferences.json`. You can change it any time.

### Intentional Summoning

Specialists don't passively pick a Martian from a registry. They **summon** — intentionally, explicitly, with full awareness of why. Before any summon, a Specialist must answer four questions:

1. What specific operation do I need performed?
2. Which Martian tag covers that operation?
3. What context does the Martian need to succeed?
4. What is my acceptance criterion for the result?

Only then does the summon happen. The Specialist evaluates the result. If it fails, it decides: retry with different context, summon a different tag, or escalate. The Specialist owns the outcome — the Martian just runs the tool.

This distinction matters. Passive registry lookups produce passive agents. Intentional summoning produces agents that reason about their tools.

---

## Execution Flow

When you run `alienclaw run "goal"`:

```
You → BossBot + AdvisorBot (scheme together)
     → Scheme → CreatorBot (builds Specialists for each Campaign)
     → GovernanceLoop (dispatches Campaigns in dependency order)
     → Specialists (summon Martians intentionally)
     → Martians (execute tools, return results)
     → Reports → AdvisorBot + CreatorBot (BossBot sees summaries only)
     → Fitness data → Martian genome evolution
     → BossBot (signs off, surfaces result to you)
```

### Failure Ladder

The system doesn't give up quietly. Failures climb a strike ladder before reaching you:

```
Strike 1 → AdvisorBot consults → CreatorBot rebuilds Specialist → retry Campaign
Strike 2 → same
Strike 3 → BossBot surfaces to you: give new instructions, resume budget, or abandon
```

You can reset the counter after Strike 3.

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
src/alienclaw/   ← the agent hierarchy
│  agents/       ←   BossBot, AdvisorBot, CreatorBot, Specialists (Employees)
│  governance/   ←   GovernanceLoop, GoalManager, TaskManager, Escalation, Completion
│  registry/     ←   MartianRegistry, genome codec, .ms file loader
│  msb/          ←   MartianBrain executor, tool adapters
│  telemetry/    ←   per-run fitness + genome telemetry
│  prompts/      ←   agent souls (bossbot, advisorbot, creatorbot, employee)
installer/       ← install.sh, overlay-dist.sh, first-run.mjs, abduction.mjs
build/           ← assembled output (gitignored)
```

OpenClaw provides the engine: gateway, channels, tools, providers, sessions, browser, TTS, canvas. AlienClaw provides the brain on top — the full agent hierarchy from executive command down to Martian execution and genome evolution. OpenClaw upgrades independently via `npm install -g openclaw`; AlienClaw upgrades via `git pull` and rebuilding.

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
    ├── ms/                 ← Martian genome files (.ms)
    ├── msb/                ← MartianBrain conditioning files (.msb)
    ├── lineage/            ← genome ancestry + fitness history
    └── telemetry/          ← per-run fitness + failure telemetry
```

---

## License

MIT — see [LICENSE](LICENSE).

Built on [OpenClaw](https://github.com/openclaw/openclaw) (MIT).
