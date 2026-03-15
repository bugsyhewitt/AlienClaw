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
  <a href="alienclaw-HANDOFF-v0.9.md"><img src="https://img.shields.io/badge/vendor-OpenClaw%202026.3.13-78F5FF?style=for-the-badge&labelColor=0a0a0a" alt="Vendor"></a>
</p>

<br>

<p align="center">
  Five preset agents handle decomposition, execution, failure, and sign-off — automatically.<br>
  Meeseeks run on evolving 256-char genomes.<br>
  Opt in to share fitness data and your agents benefit from every other AlienClaw installation on Earth.
</p>

<br>

---

## The Hierarchy

AlienClaw runs a five-layer agent system the moment you issue a goal. You don't configure it — it's already wired.

<br>

<table>
<thead>
<tr>
<th align="center">Agent</th>
<th align="center">Tier</th>
<th>Role</th>
</tr>
</thead>
<tbody>
<tr>
<td align="center"><strong>BossBot</strong></td>
<td align="center">A — Governance</td>
<td>Receives your goal, decomposes it with AdvisorBot, dispatches sub-goals in parallel, adapts the plan mid-flight, and folds your input without losing momentum. Reviews completion before surfacing to you.</td>
</tr>
<tr>
<td align="center"><strong>AdvisorBot</strong></td>
<td align="center">A — Governance</td>
<td>Stateful within each task. Consulted at decomposition, every failure rebuild, and sign-off. Decides nothing — pure wisdom on tap. Sessions are keyed per caller; cross-contamination is structurally impossible.</td>
</tr>
<tr>
<td align="center"><strong>CreatorBot</strong></td>
<td align="center">A — Governance</td>
<td>Silent and janitorial. Briefs itself from BossBot's failure context and rebuilds Employees. Sole authority over <code>.ms</code> genome files. Maintains an URGENT / NOTABLE queue so it never blocks execution.</td>
</tr>
<tr>
<td align="center"><strong>Employees</strong></td>
<td align="center">B — Execution</td>
<td>Purpose-built autonomous reasoners, one per domain. Built by CreatorBot to BossBot's spec. Select Meeseeks from the registry by tool tags, fitness, and compatibility. Never call tools directly.</td>
</tr>
<tr>
<td align="center"><strong>Meeseeks</strong></td>
<td align="center">B — Execution</td>
<td>Not agents. Execution bots defined entirely by a 256-char genome. Execute tools, report <code>SUCCESS | FAILURE | ESCALATED</code>, and terminate. Never spawn other Meeseeks.</td>
</tr>
</tbody>
</table>

<br>

### Escalation ladder

BossBot doesn't give up quietly. Failures climb a strike ladder before they reach you:

```
Strike 1 → BossBot + AdvisorBot confer → CreatorBot rebuilds Employee → retry
Strike 2 → same
Strike 3 → you are surfaced: give new instructions, resume budget, or abandon
```

After Strike 3 you can reset the counter and the ladder restarts.

---

## Meeseeks & Genomes

Every Meeseeks is defined by a **256-character Base62 genome** — 8 blocks of 32 chars each. Blocks encode tool declaration, execution flow, retry logic, escalation behavior, performance weights, and output contract. Block 0 (header) and Block 7 (checksum) are immutable. Blocks 1–6 are CreatorBot's domain.

```
│ 0 Header │ 1 Tools │ 2 Exec │ 3 Retry │ 4 Escalation │ 5 Weights │ 6 Output │ 7 Checksum │
```

Meeseeks don't carry prompt logic — they carry a genome. The `.msb` MeeseeksBrain file is conditioning text only. Control logic lives in the executor, not the file.

Fitness scores update after every run. CreatorBot reads them. The graveyard in each `.ms` file preserves top historical genomes. The best ideas survive.

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
npm install -g alienclaw@latest
# or
pnpm add -g alienclaw@latest
```

On first run, the setup wizard creates your `~/.alienclaw/` directory structure, writes your API key, sets verbosity, and walks you through the Evolution Network opt-in.

```bash
alienclaw run "summarise the last 7 days of my emails"
alienclaw run "find all TODO comments in this repo and open issues for each" --verbose
alienclaw run "monitor my server CPU every 5 minutes and alert me if it spikes"
```

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
pnpm dist:all      # copy vendor → build, reskin, overlay, compile, verify

node build/alienclaw.mjs run "hello world" --verbose
```

`pnpm dist:all` runs the full assembly pipeline: copy the pinned OpenClaw vendor snapshot → apply the AlienClaw reskin → overlay the agent hierarchy → TypeScript compile → 10-check verification. It exits 0 or it tells you exactly what failed.

---

## Architecture

AlienClaw is an **overlay distribution**, not a fork.

```
openclaw/        ← pinned OpenClaw vendor snapshot (never modified)
src/alienclaw/   ← the agent hierarchy (BossBot, AdvisorBot, CreatorBot, Employees, Meeseeks)
installer/       ← reskin.sh, verify.sh, abduction.mjs, first-run.mjs
build/           ← assembled output (gitignored)
```

OpenClaw provides the engine: gateway, channels, tools, providers, sessions, browser, TTS, canvas. AlienClaw provides the brain on top. Upstream updates flow in by swapping the `openclaw/` snapshot and running `pnpm dist:all`.

Current vendor: **OpenClaw 2026.3.13** — includes security patch [GHSA-5wcw-8jjv-m286](https://github.com/openclaw/openclaw/security/advisories/GHSA-5wcw-8jjv-m286) (WebSocket origin validation, 2026.3.11).

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
