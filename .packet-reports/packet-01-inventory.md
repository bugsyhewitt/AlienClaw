# Packet 1 — File Inventory

Clone commit: 95e8748c856a85b79ca03e04f0ad93b382f80f4a (2026-04-22)
Total files (excl .git): 936

Language breakdown:
- TypeScript (.ts): 44
- Markdown (.md): 744
- Python (.py): 11
- JavaScript (.js): 6
- Shell (.sh): 9
- Other: 122

---

## Root-level files

| File | Size | Classification | Notes |
|------|------|---------------|-------|
| `README.md` | 2.4KB | DESCRIPTIVE | Accurate three-agent overview; matches code |
| `CLAUDE.md` | 2.8KB | DESCRIPTIVE | Hard rules for Claude Code; matches code reality |
| `VISION.md` | 4.6KB | DRIFT | Describes multi-platform product (iOS/Android/ClawHub/mcporter) — imported from OpenClaw with text reskin |
| `ROADMAP.md` | 29KB | ASPIRATIONAL | Labeled with NOTE at top saying "governance-engine design"; also doubles as bug tracker — fair mix |
| `AGENTS.md` | 2.4KB | DESCRIPTIVE | Agent routing config for Claude Code environment |
| `alienclaw-HANDOFF-v0.9.md` | 25KB | DRIFT | Describes OLD vendor+reskin architecture (openclaw/ vendor dir, build/ pipeline) — superseded by npm-install approach |
| `ALIENCLAW_VERSION` | 10 bytes | DESCRIPTIVE | Version string |
| `CHANGELOG.md` | 652KB | DRIFT | Enormous changelog — almost certainly imported OpenClaw changelog (reskinned) |
| `SECURITY.md` | 20KB | DRIFT | Large security policy likely from OpenClaw |
| `CONTRIBUTING.md` | 7.6KB | DRIFT | Contribution guidelines likely from OpenClaw |
| `LICENSE` | 1 byte | DESCRIPTIVE | Empty — needs content |
| `package.json` | 769 bytes | DESCRIPTIVE | AlienClaw-specific (private:true, no pnpm, correct scripts) |
| `tsconfig.json` | 321 bytes | DESCRIPTIVE | Standard TS config |
| `install.sh` | 11KB | DESCRIPTIVE | Installer; correct three-agent architecture; --dry-run supported |
| `docs.acp.md` | 5.1KB | UNCLEAR | ACP documentation — likely OpenClaw infrastructure, needs review |
| `.env.example` | 3KB | UNCLEAR | Lists env vars; may include OpenClaw-only vars |
| `.pre-commit-config.yaml` | 5.1KB | DRIFT | References detect-secrets, zizmor, pnpm-audit-prod — OpenClaw CI tooling |
| `.markdownlint-cli2.jsonc` | 975 bytes | UNCLEAR | Linting config |
| `.mailmap` | 1KB | DRIFT | Git author map for different project history |
| `.shellcheckrc` | 743 bytes | DESCRIPTIVE | Shell linting config |
| `.gitattributes` | 78 bytes | DESCRIPTIVE | Line-ending config |
| `.gitignore` | 2.2KB | DESCRIPTIVE | Ignores standard dirs |

---

## `src/alienclaw/` — Governance Engine

- File count: 38 (including README.md)
- Languages: TypeScript (37), Markdown (1)
- Apparent purpose: The AlienClaw governance engine. State machine, agent hierarchy, Martian registry, genome codec, CLI entry point, telemetry.
- Drift flag: **NONE** — this is canonical code

### Load-bearing TypeScript files

**`src/alienclaw/constants.ts`**
Defines `TIER_A_AGENTS = ['BossBot', 'AdvisorBot', 'CreatorBot']`, `GENOME_LENGTH = 256`, `GENOME_SECTION_COUNT = 4`, `GENOME_SECTION_SIZE = 64`, `MAX_MS_TOOLS = 4`, `REPORT_RECIPIENTS = ['AdvisorBot', 'CreatorBot']`. The canonical hard invariants in code form. Exactly canonical.

**`src/alienclaw/registry/genome-codec.ts`**
256-char Base62 genome: `BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'`. 4 sections × 64 chars (IDENTITY, EXECUTION, BEHAVIOR, CHECKSUM). FNV-1a checksum auto-computed. `assembleGenome()` and `validateGenome()` are the public API. Exactly canonical.

**`src/alienclaw/agents/employee.ts`**
The Specialist layer. `Employee` class is campaign-scoped, ephemeral, created by CreatorBot. `buildSpecialist(spec, role, campaignId)` factory. `disposeCampaign(campaignId)` erases when campaign ends. `summonMartian(tag, task, context)` is the ONLY tool interface. Exactly canonical.

**`src/alienclaw/agents/bossbot.ts`**
BossBot. Reads SOUL from `prompts/bossbot.soul.md`. `schemeWithAdvisor()` implements the Boss→Advisor consultation loop. `draftScheme()` produces Campaign/Specialist breakdown. Routes all inter-agent messages through AgentChannel. Exactly canonical.

**`src/alienclaw/agents/advisorbot.ts`**
AdvisorBot. Stateless-per-consult reasoning endpoint. `advise()` method. No tools, no delegation. Exactly canonical.

**`src/alienclaw/agents/creatorbot.ts`**
CreatorBot. `buildSpecialistForRole()` creates Specialists. `buildSchemeSpecialists()` builds all campaigns. `spawnSubagent()` for async work. Scheduler for background jobs. Exactly canonical.

**`src/alienclaw/comms/agent-channel.ts`**
`AgentChannel` — private inter-agent communication, never writes to stdout, writes JSON audit files to `~/.alienclaw/registry/telemetry/`. `send()`, `history()`, `subscribe()` API. Enforces canonical channel isolation. Exactly canonical.

**`src/alienclaw/governance/governance-loop.ts`**
State machine with `VALID_TRANSITIONS` map. States: IDLE, SCHEMING, CREATOR_BUILDING, EXECUTING, AWAITING_ADVICE, CREATOR_INTERRUPT, AWAITING_USER_INPUT, REVIEWING_COMPLETION, AWAITING_USER_SIGNOFF, COMPLETE, ESCALATED. Full campaign lifecycle. Exactly canonical.

**`src/alienclaw/registry/martian-registry.ts`**, **`ms-loader.ts`**, **`ms-types.ts`**
Martian file format: `.ms` files with [GENOME], [TOOLS], [GRAVEYARD] sections. `MartianSpec` type. `bestForTool(tag)` selector. Fitness scoring. Exactly canonical.

**`src/alienclaw/registry/seed-installer.ts`**
Programmatically assembles seed Martian genomes using `assembleGenome()` — no hardcoded checksums. Installs to `~/.alienclaw/registry/ms/` and `~/.alienclaw/registry/msb/`. Exactly canonical.

**`src/alienclaw/wiring/hierarchy-bootstrap.ts`**
Wires all agents, starts CreatorBot scheduler, configures fitness update loop, genome audit. Returns `GovernanceLoop` ready to start. Exactly canonical.

---

## `seed/agents/` — Agent Workspace Files

- File count: 15 (5 files × 3 agents)
- Agents: bossbot, advisorbot, creatorbot — exactly 3 (canonical)
- Drift flag: NONE for agent structure; minor issues in TOOLS.md files

### bossbot/
| File | Status |
|------|--------|
| SOUL.md | KEEP-AS-IS — six rules correct, comm graph correct |
| AGENTS.md | KEEP-AS-IS — AdvisorBot high freq, CreatorBot medium freq |
| TOOLS.md | KEEP-WITH-EDITS — says "standard OpenClaw tool set", should reference AlienClaw Martian tools |
| HEARTBEAT.md | KEEP-AS-IS — reasonable periodic behaviors |
| MEMORY.md | KEEP-AS-IS — empty template, correct |

### advisorbot/
| File | Status |
|------|--------|
| SOUL.md | KEEP-AS-IS — stateless, advisory-only, no tools, exactly canonical |
| AGENTS.md | KEEP-AS-IS — receives BossBot and CreatorBot consults |
| TOOLS.md | KEEP-AS-IS — explicitly states "no tools" |
| HEARTBEAT.md | (see advisorbot/HEARTBEAT.md) |
| MEMORY.md | (see advisorbot/MEMORY.md) |

### creatorbot/
| File | Status |
|------|--------|
| SOUL.md | KEEP-AS-IS — six rules, sole builder, genome author |
| AGENTS.md | KEEP-AS-IS — correct routing |
| TOOLS.md | KEEP-WITH-EDITS — says "file write tool only, writes to ~/.openclaw/agents/creatorbot/specialists/". Path should be ~/.alienclaw/ and description should reflect Martian .ms file creation |
| HEARTBEAT.md | (see creatorbot/HEARTBEAT.md) |
| MEMORY.md | (see creatorbot/MEMORY.md) |

---

## `seed/ms/` and `seed/msb/` — Martian Seeds

- `seed/ms/`: 3 reference .ms files (MS_FREAD0001, MS_FWRITE001, MS_WEB00001)
- `seed/msb/`: 4 .msb brain files (file_read, file_write, url_fetch, web_search)
- Status: KEEP-AS-IS — these are reference templates; actual genomes computed by seed-installer.ts

---

## `installer/`

- `install.sh` — wrapper that calls ../install.sh. Thin convenience copy. KEEP-AS-IS
- `scripts/copy-dist.sh` — copies `openclaw/` vendor → `build/`. `openclaw/` doesn't exist. ARCHIVE
- `scripts/reskin.sh` — brand reskin script for vendor+build pipeline. That pipeline no longer exists. ARCHIVE

---

## `skills/` — 52 skill directories

Apparent purpose: Skills for use within the OpenClaw/AlienClaw CLI. Includes: 1password, apple-notes, apple-reminders, bear-notes, discord, slack, spotify-player, github, notion, obsidian, tmux, weather, etc.

These are OpenClaw skills imported from the OpenClaw ecosystem. They were NOT built for the AlienClaw three-agent governance architecture. Each directory contains a `SKILL.md` file.
- Drift flag: **DRIFT** — these describe OpenClaw skill ecosystem; the AlienClaw README and CLAUDE.md do not describe them as part of AlienClaw's scope

---

## `docs/` — 44 entries

Apparent purpose: Documentation website source. Includes: `auth-credential-semantics.md`, `channels/`, `concepts/`, `cli/`, `platforms/`, `plugins/`, `gateway/`, `design/`, `debug/`, `logging.md`, `network.md`, `perplexity.md`, `pi.md`, etc.

These are OpenClaw documentation files. The paths reference `docs.alienclaw.ai` (a website that may or may not exist). The content describes OpenClaw features (channels, gateways, plugins) not relevant to the three-agent governance engine.
- Drift flag: **DRIFT** — OpenClaw docs, not AlienClaw three-agent docs

---

## `test/`

- `rule5-channel-isolation.test.ts` — tests Rule 5 (AgentChannel isolation). Imports from `src/alienclaw/`. KEEP-AS-IS — this is a real, meaningful test for the canonical architecture.
- `git-hooks-pre-commit.test.ts` — likely OpenClaw infrastructure test. Needs review.
- `fixtures/` — contains hooks-install/, plugins-install/, and other OpenClaw test fixtures. Likely ARCHIVE candidates.

---

## `.github/`

- `workflows/ci.yml` — describes OpenClaw CI with macOS/Android/iOS/Windows jobs, `pnpm build`, `pnpm test`. References `apps/macos/`, `apps/android/`, `apps/ios/` (none exist). **DRIFT** — this CI is not for AlienClaw.
- `workflows/install-smoke.yml` — likely has AlienClaw relevance (smoke test for install.sh)
- Other workflows — likely OpenClaw infrastructure

---

## `scripts/`

Not fully explored. Contains build scripts likely from OpenClaw.

---

## `assets/`

Not explored. Likely images/logos.

---

## `git-hooks/`

Not explored. Pre-commit hook scripts.
