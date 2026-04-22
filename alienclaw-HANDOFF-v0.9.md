> **NOTE:** This file describes the governance-engine design (see `src/alienclaw/`). It does not describe v0.1 runtime behavior.

# AlienClaw — Master Handoff Document v0.9
# For: New Claude chat session
# Status: v0.1.0 RELEASE CANDIDATE — feature complete, tree clean, tagged.

---

## THE ONE-LINE PITCH

AlienClaw is an overlay distribution on top of OpenClaw (MIT) that keeps 100% of its
engine and adds a governed multi-agent hierarchy on top — with a Martian execution
layer, genome-based evolution system, and community leaderboard at alienclaw.gg.

---

## REPO

- **AlienClaw source:** https://github.com/AlienTool/AlienClaw
- **OpenClaw upstream:** https://github.com/openclaw/openclaw
- **Mission Control (dashboard):** https://github.com/builderz-labs/mission-control
- **Repo location:** `C:\alienclaw` on Windows / `/mnt/c/alienclaw` in WSL2
- **Current tag:** `v0.1.0`

---

## ARCHITECTURE — CRITICAL

AlienClaw is an **overlay distribution**, not a fork and not a plugin.

```
openclaw/           ← clean, unmodified OpenClaw snapshot (never touch directly)
src/alienclaw/      ← AlienClaw agent hierarchy (our technology)
installer/          ← reskin script, verify script, install sequence
build/              ← assembled output (gitignored): copy + reskin + overlay + compile
```

### Assembly pipeline — `pnpm dist:all`

```
dist:copy     copies openclaw/ → build/
dist:reskin   applies openclaw→alienclaw text replacements + renames to build/
              (3,948 text changes across 7,930 files, 80 renames)
dist:overlay  copies src/alienclaw/ → build/src/alienclaw/
              also copies src/openclaw-patches/ → build/src/ (core patches)
pnpm build    TypeScript compile of everything together
dist:verify   confirms zero residual openclaw refs (10/10 checks pass)
```

All dist scripts delegate to explicit bash scripts in `installer/scripts/` to avoid
Windows cmd.exe/bash ambiguity in pnpm inline scripts.

### Absorbing a new OpenClaw version

1. Swap `openclaw/` with new snapshot
2. Run `pnpm dist:all`
3. Fix anything broken (check `src/openclaw-patches/` against new upstream)
4. Update `ALIENCLAW_VERSION`
5. Commit: `chore: update vendor/openclaw to <version>`

### Key files

- `ALIENCLAW_VERSION` — currently `2026.3.13` (pinned OpenClaw version)
- `package.json` — `name: alienclaw`, `version: 2026.3.7`, `bin: { alienclaw: alienclaw.mjs }`
- `installer/scripts/reskin.sh` — canonical record of every change made to OpenClaw
- `installer/scripts/verify.sh` — 10-check post-build validation
- `installer/scripts/copy-dist.sh` + `overlay-dist.sh` — explicit bash wrappers
- `src/openclaw-patches/cli/program/command-registry.ts` — only patched file (adds `run` command)

---

## FORK STRATEGY

> "We are just stealing their engine and putting a new vehicle on top."

- Keep **literally everything** from OpenClaw — all channels, all media, browser, TTS,
  wizard, iOS/Android apps, every extension, every provider
- **Reskin only at install time** via reskin.sh — never in committed source
- **Add on top:** the AlienClaw agent hierarchy + Martian layer
- Future OpenClaw updates flow in by swapping `openclaw/` vendor snapshot
- `--ignore-openclaw-updates` flag planned for a future installer release

---

## SESSION HISTORY NOTES

- User is on Windows with WSL2 Ubuntu (username: skynet, machine: SKYNET)
- GitHub account: AlienTool (alientool@proton.me)
- Repo is private at https://github.com/AlienTool/AlienClaw
- PowerShell does not support `&&` — use WSL2 bash or Git Bash for chained commands
- Claude Code is available and preferred for implementation work
- GitHub MCP connector not available in claude.ai
- Pre-commit hook skips oxlint/oxfmt gracefully on Windows (native bindings absent)
- Pre-commit hook uses stdin + xargs for file passing — safe for large vendor commits

---

## 5-LAYER AGENT HIERARCHY

### TIER A — GOVERNANCE

**BossBot** (`MiniMax-M2.5`)
- Event-driven goal-pursuit engine, not a sequential task processor
- Receives goals conversationally, starts immediately without user approval gate
- Decomposes goals into sub-goals with AdvisorBot before any work starts
- Runs independent sub-goals in parallel; sequences dependent ones
- Adapts plan dynamically as he learns; flags changes to user
- Folds mid-execution user input into existing plan without losing momentum
- Reviews completion with AdvisorBot before surfacing to user for sign-off
- NEVER shares what AdvisorBot told him with CreatorBot, or vice versa
- Does NOT build agents or write genomes

**AdvisorBot** (`MiniMax-M2.5`)
- Stateful within a task per caller — separate session objects for BossBot and CreatorBot
- Sessions keyed `${callerId}::${taskId}` — structurally impossible to cross-contaminate
- Sessions destroyed on task completion
- Consulted at: goal decomposition, every Employee rebuild after failure, completion review
- DECIDES NOTHING. Wisdom on tap only.
- Persistence configurable: `off` / `per_task` (default) / `full`

**CreatorBot** (`MiniMax-M2.5-highspeed`)
- Silent. Janitorial. Works without narrating.
- Briefs himself from failure context BossBot provides
- Maintains two-lane queue: URGENT (interrupt BossBot immediately) / NOTABLE (flush at completion)
- SOLE authority over .ms genome files — no one else touches them

### TIER B — EXECUTION

**Employees** (`MiniMax-M2.5-highspeed`)
- Autonomous reasoners, purpose-built per domain
- Built by CreatorBot to BossBot's spec
- Select Martian from registry by tool_tags / fitness / compatibility
- CANNOT call tools directly — ever
- CANNOT mutate genomes

**Martian (.ms files)**
- NOT agents. Execution bots.
- Defined entirely by 256-char genome code
- Execute tools via .msb MartianBrain
- Fully terminate before returning control
- CANNOT spawn other Martian

---

## COMPLETED PHASES

### ✅ Phase 1 — The Reskin
- Moved to overlay model — reskin now applied at dist time via reskin.sh
- reskin.sh is idempotent, portable (bash 3.2+ / macOS, Linux, WSL2)
- Substitution map: OpenClaw→AlienClaw, OPENCLAW→ALIENCLAW, openclaw→alienclaw
- 3,948 text changes, 80 file renames, workspace ref normalization, mixed-case dirs
- `pnpm dist:all` verified clean: 10/10 checks pass, zero residual openclaw refs

### ✅ Phase 2A — Agent Identity Layer
21 files in `src/alienclaw/`. Zero type errors.

```
src/alienclaw/
├── index.ts
├── constants.ts
├── types.ts
├── agents/
│   ├── bossbot.ts
│   ├── advisorbot.ts
│   ├── creatorbot.ts
│   ├── employee.ts
│   └── agent-registry.ts
├── prompts/
│   ├── bossbot.soul.md
│   ├── advisorbot.soul.md
│   ├── creatorbot.soul.md
│   └── employee.soul.md
└── config/
    ├── alienclaw-config.ts
    └── defaults.ts
```

### ✅ Phase 2B — Governance Engine
Full state machine, 11 states, all transitions enforced.

```
src/alienclaw/
├── comms/
│   └── user-channel.ts
└── governance/
    ├── goal-manager.ts
    ├── task-manager.ts
    ├── escalation-handler.ts
    ├── completion-handler.ts
    ├── governance-loop.ts
    └── wiring/
        └── hierarchy-bootstrap.ts
```

Key: atomic goals.json, parallel sub-goal dispatch, crash recovery,
strike ladder, completion sign-off flow, verbosity modes.

### ✅ Phase 3 — Martian Registry
Zero type errors. 35 files in src/alienclaw/.

```
src/alienclaw/
├── registry/
│   ├── genome-codec.ts       ← Base62 parse/validate/assemble, FNV checksum
│   ├── ms-types.ts           ← MartianSpec, GraveyardEntry, execution I/O types
│   ├── ms-loader.ts          ← read-only .ms file parser
│   ├── martian-registry.ts  ← in-memory registry singleton
│   ├── registry.ts           ← registry wrapper
│   ├── seed-installer.ts     ← copies seed files to ~/.alienclaw/registry/
│   └── index.ts
├── msb/
│   ├── msb-types.ts          ← MartianBrain type (conditioning text only)
│   ├── msb-loader.ts         ← .msb parser + per-process cache
│   ├── martian-executor.ts  ← executeMartian(), depth guard, retry/escalation
│   ├── tool-adapters.ts      ← wireToolAdapters(): web_search, url_fetch, file_read, file_write
│   ├── openclaw-tool-resolver.ts  ← bridge to OpenClaw tools (intentional name)
│   └── index.ts
├── registry-bootstrap.ts     ← wires registry + adapters at startup
└── wiring/
    └── hierarchy-bootstrap.ts ← Phase 5 CLI entry point (already wired)
```

Seed files at repo root:
```
seed/
├── ms/
│   ├── MS_WEB00001.ms    ← web_search + url_fetch Martian
│   ├── MS_FREAD0001.ms   ← file_read Martian
│   └── MS_FWRITE001.ms   ← file_write Martian
└── msb/
    ├── web_search.msb
    ├── url_fetch.msb
    ├── file_read.msb
    └── file_write.msb
```

### ✅ Architecture Restructure
- Moved from hard fork to overlay distribution
- openclaw/ = clean pinned snapshot, never modified
- pnpm dist:all pipeline confirmed working end-to-end
- build/ = assembled output, gitignored

### ✅ Phase 4 — Real LLM Calls
Provider layer: `@mariozechner/pi-ai` — `completeSimple(model, context, { apiKey })` +
`getModel(ALIENCLAW_PROVIDER, model)` + `getEnvApiKey(ALIENCLAW_PROVIDER)`.
No Anthropic SDK imported directly. Full provider compatibility maintained.
Provider: **MiniMax** (`minimax`). Models: `MiniMax-M2.5` (power), `MiniMax-M2.5-highspeed` (fast).
`ALIENCLAW_PROVIDER` constant in `constants.ts` is the single place to change provider.

- `agents/bossbot.ts` — `decompose()`, `classifyUserInput()`, `generateSubGoals()` — real LLM, JSON parsed
- `agents/advisorbot.ts` — `advise(req, taskId?)` — includes session history when `taskId` provided
- `governance/governance-loop.ts` — all 6 stub call sites updated
- `governance/escalation-handler.ts` — `advise()` + `writeFailforward()` telemetry wired
- `governance/completion-handler.ts` — `advise()` wired
- `agents/employee.ts` — `writeMartianReport()` fires after every Martian execution
- `telemetry/telemetry-writer.ts` — new file, writes JSON to `~/.alienclaw/registry/telemetry/<ISO-date>/`
  - `writeMartianReport()`, `writeFailforward()`, `writeAdvisory()`
- Build: clean. Zero type errors.

### ✅ Phase 5 — CLI
- `src/alienclaw/cli/args.ts` — plain Node argument parser, zero external deps
  - `parseCliArgs(argv)` → typed `CliCommand` union (`run` | `version` | `help` | `unknown`)
  - Handles `--verbose` / `--silent` flags, maps to `VerbosityMode`
- `src/alienclaw/cli/cli.ts` — thin lifecycle shell
  - Mutates `alienClawConfig.preferences.verbosity` before `bootstrap()` runs
  - Registers SIGINT / SIGTERM handlers via `process.once`
  - Calls `loop.submitGoal(goal)` then `await loop.start()`
- `src/alienclaw/cli/register.run.ts` — Commander registration
  - `registerRunCommand(program)` — follows `register.agent.ts` pattern exactly
  - `alienclaw run "<goal>" [--verbose | --silent]`
  - Lazy-imports `cli.ts` inside `.action()` handler
- `src/openclaw-patches/cli/program/command-registry.ts` — wired into `coreEntries` array
  - `{ name: "run", description: "Run the AlienClaw agent hierarchy toward a goal" }`
  - Dynamically imports `../../alienclaw/cli/register.run.js`
- Output boundary: `~/.alienclaw/workspace/output/` — enforced by existing `file_write` adapter (unchanged)
- Build: clean. Zero type errors.

### ✅ Post-Phase-5 Fixes & Cleanup
- `installer/scripts/overlay-dist.sh` — extended to also copy `src/openclaw-patches/` into
  `build/src/`, so patches to OpenClaw core files survive `dist:all`
- Soul file paths fixed in all 4 agents — bundled output is in `dist/`, so paths must be
  `../src/alienclaw/prompts/` not `../prompts/`
- `seed/ms/*.ms` — block-7 checksums recomputed; all 3 pass `validateGenome()`
- `seed/msb/` — deduplicated to underscore-only names (`file_read`, `file_write`, `web_search`, `url_fetch`)
- `seed-installer.ts` — `overwrite` defaults to `true` so updated seeds always propagate on reinstall
- `git-hooks/pre-commit` — probes oxlint/oxfmt; skips silently on Windows (no native bindings)
  - Now uses stdin + xargs for file passing — safe for large vendor commits (ARG_MAX fix)
- `installer/setup/first-run.mjs` — fixed: `provider`/`verbosity` write to `preferences.json` not
  `alienclaw.json`; `verbosityMap[0]` corrected from `'quiet'` → `'silent'`

### ✅ Phase 6 — Installer (completed 2026-03-14)
- **`installer/animation/abduction.mjs`** — alien abduction ASCII art install sequence
  - Full braille + ANSI starfield animation, pulsing ship, tractor beam, phase labels
  - Confirmed working on Windows (exit 0, 1.5MB ANSI output)
  - WSL2 test requires Node installed in WSL2 (`nvm install --lts`)
- **`installer/setup/first-run.mjs`** — 4-step interactive first-run wizard
  - Step 1: Mission directories (creates all `~/.alienclaw/` subdirs with animated ticks)
  - Step 2: AI provider selection (Anthropic / MiniMax / OpenAI / Ollama / Other)
  - Step 3: Verbosity preference (silent / normal / verbose)
  - Step 4: Evolution Network opt-in — anonymous genome fitness sharing with alienclaw.gg
    - Named opt-in: full leaderboard access, community genome upgrades, cross-swarm boosts
    - Anonymous opt-in: contribute fitness data without linking to identity
    - Opt-out: stay fully local, no data leaves machine
  - Writes provider + verbosity to `~/.alienclaw/preferences.json` (not alienclaw.json)
  - Writes evolutionOptIn, setupComplete, setupCompletedAt to preferences.json
  - API key written to `~/.alienclaw/.env` (mode 0600, never to repo .env)
  - Displays ALIENCLAW ONLINE banner on completion

### ✅ Vendor Update — OpenClaw 2026.3.8 → 2026.3.13 (2026-03-14)
- Replaced `openclaw/` with v2026.3.13-1 (tagged 2026-03-14)
- **SECURITY: absorbed GHSA-5wcw-8jjv-m286** — WebSocket cross-site hijacking fix (2026.3.11)
  - Gateway/WebSocket: enforce browser origin validation for all browser-originated connections
    regardless of proxy headers in `trusted-proxy` mode
- Dashboard v2 with modular overview/chat/config/agent/session views (2026.3.12)
- Control UI fast-mode toggles, OpenAI/GPT-5.4 request shaping (2026.3.12)
- Android Play distribution cleanup, iOS first-run welcome pager (2026.3.13)
- No changes to `src/openclaw-patches/` required — all 5 patch dependencies unchanged
- `pnpm dist:all` 10/10 PASS after update

### ✅ v0.1 Beta — Smoke Test Confirmed (2026-03-09)
End-to-end run: `node alienclaw.mjs run "list the files in the current directory" --verbose`

```
[SeedInstaller] Installed ms/MS_FREAD0001.ms
[SeedInstaller] Installed ms/MS_FWRITE001.ms
[SeedInstaller] Installed ms/MS_WEB00001.ms
[SeedInstaller] Installed msb/file_read.msb
[SeedInstaller] Installed msb/file_write.msb
[SeedInstaller] Installed msb/url_fetch.msb
[SeedInstaller] Installed msb/web_search.msb
[AlienClaw] New goal received: "list the files in the current directory"
[AlienClaw:verbose] State: IDLE → DECOMPOSING | User submitted goal
→ BossBot.decompose() hit MiniMax API — real LLM call confirmed
```

Every layer confirmed working:
- Commander registration → `alienclaw run` command resolved ✓
- `bootstrap()` → GovernanceLoop constructed ✓
- SeedInstaller → all seeds installed to `~/.alienclaw/registry/` ✓
- GovernanceLoop state machine → `IDLE → DECOMPOSING` ✓
- `--verbose` flag propagated through config → UserChannel ✓
- BossBot → real LLM call dispatched via `@mariozechner/pi-ai` → MiniMax ✓
- `MINIMAX_API_KEY` read from `.env` ✓

Provider: MiniMax (`MINIMAX_API_KEY` in `.env`, gitignored).

---

## CURRENT STUBS

None. All LLM calls are real. All phases complete.

---

## REMAINING BUILD PHASES

**None.** v0.1.0 is feature complete and tagged.

---

## NEXT — Post v0.1.0

These are the priorities for v0.2.0 and beyond, in rough order:

### alienclaw.gg Leaderboard
- Server-side genome fitness aggregation
- Named and anonymous participation tiers (opt-in captured at install time)
- Cross-swarm intelligence: top-performing genomes propagate to opted-in installs
- Web dashboard at alienclaw.gg

### Mission Control Reskin
- WebSocket dashboard on port 18789
- AlienClaw color scheme (replace OpenClaw defaults)
- `onTransition` hooks already in place in governance-loop.ts
- Integration with live sub-goal/Martian status

### Employee Genomes
- Extend genome system to Employee layer (currently Martian-only)
- Employee genome encodes domain specialization, tool preference, escalation tolerance
- CreatorBot writes both Employee and Martian genomes

### Report Codes
- Structured telemetry codes for Martian outcomes (currently raw JSON)
- Format: `MS_<TYPE>_<CODE>` — e.g. `MS_EXEC_001`, `MS_FAIL_404`
- Feed into leaderboard + community fitness sharing

### Windows Native Installer
- Single `.exe` wrapping Node + AlienClaw — no Node pre-install required
- Bundles the alien abduction animation as part of install sequence
- NSIS or WiX toolchain
- Code-signed for SmartScreen bypass

### Mobile Companion App
- Lightweight iOS/Android app for monitoring and approving BossBot escalations
- Push notification for Strike 3 / user sign-off requests
- Built on existing OpenClaw iOS/Android infrastructure (already in repo)
- No full agent capability on mobile — desktop is the brain

---

## RUNTIME DIRECTORY STRUCTURE

```
~/.alienclaw/
├── alienclaw.json               ← system config (auto-created by OpenClaw)
├── preferences.json             ← user preferences (auto-created by first-run wizard)
├── .env                         ← API keys (mode 0600, written by first-run wizard)
├── workspace/
│   ├── goals.json               ← BossBot working memory, atomic writes
│   └── output/                  ← task outputs land here
└── registry/
    ├── ms/                      ← MS_<8charID>.ms files
    ├── msb/                     ← <tool_name>.msb files
    ├── lineage/
    │   └── lineage.json
    └── telemetry/
        └── <ISO-date>/
            ├── <report_code>.json
            ├── failforward_<timestamp>.json
            └── advisory_<taskId>.json
```

---

## USER PREFERENCES (preferences.json)

```json
{
  "provider": "minimax",
  "verbosity": "normal",
  "advisorPersistence": "per_task",
  "evolutionOptIn": true,
  "setupComplete": true,
  "setupCompletedAt": "<ISO timestamp>"
}
```

- `provider`: provider ID selected at first-run (`anthropic` / `minimax` / `openai` / `ollama` / `other`)
- `verbosity`: `silent` / `normal` / `verbose`
- `advisorPersistence`: `off` / `per_task` (default) / `full`
- `evolutionOptIn`: `true` / `false` — genome fitness sharing with alienclaw.gg

---

## .ms FILE FORMAT

```
# MS_WEB00001
# description: Web research Martian
# generation: 1
# status: active
# fitness: 0.00

[TOOLS]
1. web_search      → web_search.msb
2. url_fetch       → url_fetch.msb

[GENOME]
<256 chars of Base62>

[GRAVEYARD]
# Top performing historical genomes. Restored by CreatorBot only.
# format: <fitness_score> <generation> <genome>
```

---

## GENOME BLOCK LAYOUT

| Block | Chars | Name | Mutable |
|---|---|---|---|
| 0 | 0–31 | Header | NO |
| 1 | 32–63 | Tool Declaration | yes |
| 2 | 64–95 | Execution Flow | yes |
| 3 | 96–127 | Retry Logic | yes |
| 4 | 128–159 | Escalation | yes |
| 5 | 160–191 | Performance Weights | yes |
| 6 | 192–223 | Output Contract | yes |
| 7 | 224–255 | Checksum | NO |

Only CreatorBot mutates blocks 1–6. Blocks 0 and 7 never change.
Genome is always exactly 256 chars, Base62 (0-9, A-Z, a-z).

---

## .msb FILE FORMAT

```
TOOL: web_search
VERSION: 1.0

CAPABILITIES:
[what the tool can do]

LIMITATIONS:
[hard limits]

FAILURE MODES:
[how it fails, what retry should do]

BEST PRACTICES:
[optimal usage patterns]

EXECUTION ORDER:
1. step one
2. step two

OUTPUT CONTRACT:
{ json schema }
```

Lives at `~/.alienclaw/registry/msb/<tool_name>.msb`.
One file per tool, shared across all Martian using that tool.
MSB is conditioning text only — never control logic (hard invariant).

---

## MODEL ASSIGNMENTS

| Agent | Model | Tier |
|---|---|---|
| BossBot | `MiniMax-M2.5` | A |
| AdvisorBot | `MiniMax-M2.5` | A |
| CreatorBot | `MiniMax-M2.5-highspeed` | A |
| Employees | `MiniMax-M2.5-highspeed` (configurable) | B |
| Martian | none — execution bots only | B |

To change provider: update `ALIENCLAW_PROVIDER` in `src/alienclaw/constants.ts`. One place.

---

## HARD INVARIANTS (never violate)

1. Only CreatorBot may write or mutate `.ms` genome files
2. Employees never call tools directly — always via Martian
3. No nested Martian execution (max depth = 1)
4. Genome is always exactly 256 chars, 8 blocks × 32 chars
5. Blocks 0 (header) and 7 (checksum) are immutable
6. Martian execution is synchronous: SUCCESS | FAILURE | ESCALATED
7. `.msb` MartianBrain is conditioning text only — never control logic
8. Employees do not interpret genome directly
9. No Martian spawning other Martian
10. Tools cannot call other tools
11. Escalation to Tier A requires BossBot authorization
12. CreatorBot does not initiate conversation — works silently
13. AdvisorBot decides nothing — advises BossBot and CreatorBot independently
14. AdvisorBot sessions for BossBot and CreatorBot are always separate objects
15. BossBot never passes AdvisorBot's exact words to CreatorBot — summarizes direction only
16. Invalid state machine transitions throw — they are bugs, not recoverable errors
17. goals.json is always written atomically (tmp → lock → rename → release)
18. All LLM calls route through OpenClaw's provider abstraction — never SDK directly
19. `provider` and `verbosity` are AlienClaw preferences — write to `preferences.json`,
    never to `alienclaw.json` (OpenClaw's config file rejects unknown keys)

---

## OPENCLAW SOURCE STRUCTURE (relevant parts)

Key dirs in `src/` (in build/ after dist:overlay):
- `src/gateway/` — WebSocket server (Mission Control, port 18789)
- `src/agents/` — agent prompt system
- `src/agents/tools/` — all tools: web-search.ts, web-fetch.ts, etc.
- `src/providers/` — Anthropic, OpenAI, Ollama, Minimax, etc. — USE THIS for LLM calls
- `src/sessions/` — session management
- `src/config/` — config layer
- `src/memory/` — memory plugin
- `src/cli/` — CLI wiring
- `src/security/` — auth and permissions
- `skills/` — 52 bundled skills
- `src/alienclaw/` — AlienClaw overlay (added by dist:overlay)

Key facts:
- TypeScript ESM monorepo, Node 22+ required
- Build: `pnpm install` + `pnpm build` (run inside build/ after dist:overlay)
- Full build from scratch: `pnpm dist:all` from repo root
- Config home: `~/.alienclaw` (env: `ALIENCLAW_HOME`)
- Binary: `alienclaw.mjs` (root shim) or `build/alienclaw.mjs` (full built dist)
- Gateway port: 18789 (keep)
- Version format: `YYYY.M.D`

---

## GOVERNANCE DESIGN DECISIONS (locked)

### Goal flow
1. User tells BossBot goal conversationally
2. BossBot + AdvisorBot decompose independently; BossBot synthesizes into goals.json
3. BossBot starts immediately — no user approval gate
4. Independent sub-goals run in parallel; BossBot sequences by dependency
5. BossBot adapts plan dynamically, flags changes to user
6. Mid-session user input folds into existing plan
7. On completion: BossBot + AdvisorBot agree → user signs off

### Escalation ladder (per task)
- **Strike 1:** BossBot + AdvisorBot confer → CreatorBot rebuilds Employee → retry
- **Strike 2:** Same as Strike 1
- **Strike 3:** User surfaced. Options: new instructions / resume budget / abandon
  After Strike 3, user can input resume budget — strikeCount resets, ladder restarts

### State machine (11 states)
```
IDLE → DECOMPOSING → EXECUTING → REVIEWING_COMPLETION → AWAITING_USER_SIGNOFF → COMPLETE → IDLE
                  ↕           ↕
          AWAITING_ADVICE  CREATOR_BUILDING
                           CREATOR_INTERRUPT
                           AWAITING_USER_INPUT
                           ESCALATED
```
Invalid transitions throw — they are bugs, not recoverable errors.

### AdvisorBot briefing rule
BossBot never passes AdvisorBot's exact words to CreatorBot.
BossBot summarizes the direction. CreatorBot decides the spec himself.

---

## WHAT v0.1.0 SHIPS

- All 5 agents running (BossBot, AdvisorBot, CreatorBot, Employees, Martian)
- Full Tier A governance loop active with real LLM calls (MiniMax)
- `web_search` + `file_read` + `file_write` Martian with real .ms and .msb files
- Genome codec + .ms registry + graveyard working
- Evolution/fitness tracking (JSON telemetry)
- CLI entry: `alienclaw run "<goal>" [--verbose | --silent]`
- Output to `~/.alienclaw/workspace/output/`
- Alien abduction installer animation + 4-step first-run wizard
- Evolution Network opt-in (named / anonymous / local)
- OpenClaw 2026.3.13 vendor — includes GHSA-5wcw-8jjv-m286 security patch
- **NOT in v0.1.0:** report codes, leaderboard website, Mission Control reskin,
  Windows native installer, Employee genomes, mobile companion app
