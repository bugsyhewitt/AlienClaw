# Architecture Finding — Packet 1

## Hypothesis going in

README describes five-layer (User → BossBot → AdvisorBot → CreatorBot → Specialist → Martian).
Canonical (locked) is three-layer governance (BossBot, AdvisorBot, CreatorBot) + ephemeral
Specialists + ephemeral Martians-as-genome-units. Find out what the code actually does.

---

## Evidence

### 4a — Fixed agents defined

`src/alienclaw/constants.ts:10`:
```typescript
export const TIER_A_AGENTS = ['BossBot', 'AdvisorBot', 'CreatorBot'] as const;
export type TierAAgent = typeof TIER_A_AGENTS[number];
```

`seed/agents/` contains exactly 3 subdirectories:
- `bossbot/`
- `advisorbot/`
- `creatorbot/`

**Verdict: Exactly 3 fixed Tier-A agents. No drift. Canonical.**

---

### 4b — Specialist vs Martian distinction

The code implements a clear, distinct two-tier below the governance layer:

**Specialists (Employees):** Defined in `src/alienclaw/agents/employee.ts`.
- Class `Employee` — campaign-scoped (line 56: `readonly campaignId?: string`)
- `buildSpecialist(spec, role, campaignId)` factory at line 223
- `disposeCampaign(campaignId)` at line 261 — disposed when campaign ends
- The ONLY interface to tools is `summonMartian()` (line 115)
- Cannot mutate genomes: `src/alienclaw/prompts/employee.soul.md:27`: "You CANNOT mutate Martian genomes or touch .ms files."

**Martians:** Defined via `.ms` genome files, loaded by `src/alienclaw/registry/ms-loader.ts`.
- `MartianSpec` type in `src/alienclaw/registry/ms-types.ts` — has genome field (256-char Base62)
- Executed by `src/alienclaw/msb/martian-executor.ts`
- Cannot recurse: `employee.soul.md`: "You CANNOT recurse — a Martian you summon cannot summon further Martian."
- Fitness reports routed to AdvisorBot + CreatorBot, NOT BossBot: `constants.ts:38`: `REPORT_RECIPIENTS = ['AdvisorBot', 'CreatorBot']`

**Verdict: Specialist/Martian distinction is fully implemented and correctly separated. Canonical.**

---

### 4c — Genome encoding and length

`src/alienclaw/registry/genome-codec.ts`:
- Line 18: `export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';`
- Line 20: `export const GENOME_LENGTH   = 256;`
- Line 21: `export const SECTION_SIZE    = 64;`
- Line 22: `export const SECTION_COUNT   = 4;`

Section layout (lines 24-29):
```
IDENTITY:  chars   0– 63 — Martian ID, generation, tool family
EXECUTION: chars  64–127 — flow type, retry config, performance mode
BEHAVIOR:  chars 128–191 — escalation policy, output contract
CHECKSUM:  chars 192–255 — 64-char FNV-1a hash of sections 0–2
```

Confirmed in `src/alienclaw/constants.ts:20-26`:
```typescript
export const GENOME_LENGTH        = 256;
export const GENOME_SECTION_COUNT = 4;
export const GENOME_SECTION_SIZE  = 64;
```

**No Base64 references found in src/. No 512-char references found in src/.**

**Verdict: 256-char Base62 genome, 4 sections × 64 chars, FNV-1a checksum. Exactly canonical.**

---

### 4d — Communication graph enforcement

`src/alienclaw/constants.ts:38`:
```typescript
export const REPORT_RECIPIENTS = ['AdvisorBot', 'CreatorBot'] as const;
```
BossBot is intentionally excluded from fitness reports. This matches the canonical rule: Martians/Specialists report to AdvisorBot+CreatorBot, not BossBot.

`src/alienclaw/comms/agent-channel.ts:30`:
```typescript
export interface AgentMessage {
  from:    TierAAgent;  // only BossBot | AdvisorBot | CreatorBot
  to:      TierAAgent;  // only BossBot | AdvisorBot | CreatorBot
  ...
}
```
The type system enforces that only Tier-A agents use AgentChannel. Specialists/Martians cannot send on AgentChannel.

`src/alienclaw/agents/bossbot.ts:278-285` (inside `schemeWithAdvisor`):
```typescript
agentChannel.send({ from: 'BossBot', to: 'AdvisorBot', kind: 'request', ... });
agentChannel.send({ from: 'AdvisorBot', to: 'BossBot', kind: 'response', ... });
```

`src/alienclaw/comms/agent-channel.ts:6`: "NEVER writes to stdout — AgentChannel is a structural gate, not a user-facing output"

`test/rule5-channel-isolation.test.ts` — vitest tests that directly verify UserChannel never sees AgentChannel messages.

**Verdict: Communication graph enforced by type system and runtime channel separation. Exactly canonical.**

---

### 4e — Meeseeks vs Martian terminology

```bash
grep -rn -i "meeseeks" src/ seed/ docs/  → 0 results
```

A recent commit confirms the rename is done:
```
b76bd83e rename: complete Meeseeks → Martian across codebase and docs
```

The current code uses "Martian" and "martian" exclusively throughout:
- `martian-executor.ts`, `martian-registry.ts`, `ms-types.ts` (ms = Martian Spec)
- `msb` = Martian Stub Brain
- `MS_WEB00001`, `MS_FREAD0001`, `MS_FWRITE001` — Martian Spec IDs

**Verdict: Rename is 100% complete. CURRENT throughout. No OBSOLETE or CONFLICTING references found.**

---

## Synthesis

The code most closely resembles: **Architecture B (3-layer canonical)**. Confidence: **HIGH**.

Evidence cited:
- `constants.ts:10-11` — exactly 3 Tier-A agents
- `genome-codec.ts:18-22` — 256-char Base62, 4×64 sections
- `employee.ts:223-264` — Specialists are ephemeral, campaign-scoped, disposed at campaign end
- `ms-types.ts:11-35` — Martians have genome field, fitness score, graveyard
- `constants.ts:38` — fitness reports excluded from BossBot
- `agent-channel.ts:30` — TierAAgent type gate on inter-agent comms
- `seed/agents/` — exactly 3 directories, no "specialist/" or "meeseeks/" peer
- Commit b76bd83e — Meeseeks→Martian rename complete

The README's diagram ("User → BossBot → AdvisorBot (consult)...") already describes the canonical architecture correctly. The README is NOT five-layer — it accurately reflects the code.

**The "five-layer" hypothesis was not confirmed.** The README itself is canonical. The drift lives elsewhere (skills/, docs/, VISION.md, CHANGELOG.md, CI workflows) — not in the core architectural description.

---

## Salvage assessment

| Code area | Disposition | Rationale |
|-----------|-------------|-----------|
| `src/alienclaw/` (all 38 files) | **KEEP-AS-IS** | Exactly canonical — genome codec, agents, registry, governance loop all correct |
| `seed/agents/*/SOUL.md` (all 3) | **KEEP-AS-IS** | Six rules correct, role descriptions match canonical architecture |
| `seed/agents/*/AGENTS.md` (all 3) | **KEEP-AS-IS** | Routing correct |
| `seed/agents/bossbot/TOOLS.md` | **KEEP-WITH-EDITS** | Says "standard OpenClaw tool set" — should reference Martian execution instead |
| `seed/agents/creatorbot/TOOLS.md` | **KEEP-WITH-EDITS** | Says "file write tool only, writes to ~/.openclaw/…" — path should be ~/.alienclaw/ |
| `seed/agents/*/HEARTBEAT.md` | **KEEP-AS-IS** | Reasonable; graceful fallback if OpenClaw doesn't support it |
| `seed/agents/*/MEMORY.md` | **KEEP-AS-IS** | Empty templates; correct |
| `seed/ms/`, `seed/msb/` | **KEEP-AS-IS** | Reference templates + MSB brains; correct |
| `install.sh` | **KEEP-AS-IS** | Correct, dry-run works |
| `installer/install.sh` | **KEEP-AS-IS** | Thin wrapper; fine |
| `installer/scripts/copy-dist.sh` | **ARCHIVE** | References non-existent openclaw/ vendor dir |
| `installer/scripts/reskin.sh` | **ARCHIVE** | For old vendor+reskin pipeline; that pipeline is gone |
| `test/rule5-channel-isolation.test.ts` | **KEEP-AS-IS** | Real test for canonical architecture |
| `test/git-hooks-pre-commit.test.ts` | **ARCHIVE** | OpenClaw infrastructure test |
| `test/fixtures/` | **ARCHIVE** | OpenClaw test fixtures |
| `skills/` (52 dirs) | **ARCHIVE-OR-MOVE** | OpenClaw skills, not AlienClaw governance skills |
| `docs/` (44 entries) | **ARCHIVE-OR-REPLACE** | OpenClaw documentation |
| `VISION.md` | **REPLACE** | OpenClaw vision (iOS/Android/ClawHub); not AlienClaw's vision |
| `CHANGELOG.md` | **ARCHIVE** | 652KB OpenClaw changelog |
| `SECURITY.md` | **REVIEW-THEN-REPLACE** | Likely OpenClaw; may have salvageable sections |
| `CONTRIBUTING.md` | **REVIEW-THEN-REPLACE** | Likely OpenClaw |
| `alienclaw-HANDOFF-v0.9.md` | **ARCHIVE** | Old vendor+reskin architecture; superseded |
| `.github/workflows/ci.yml` | **REPLACE** | Describes OpenClaw CI with apps/android, apps/macos, pnpm commands; not valid for AlienClaw |
| `.github/workflows/docker-release.yml` | **REVIEW** | Likely irrelevant |
| `.github/workflows/install-smoke.yml` | **KEEP-WITH-EDITS** | May be relevant; references install.sh smoke test |
| `.pre-commit-config.yaml` | **REVIEW** | References OpenClaw tooling |
