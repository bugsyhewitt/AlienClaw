# Packet 1 Recon Report

**Status:** COMPLETE
**Started:** 2026-05-05T16:40Z / **Finished:** 2026-05-05T17:45Z / **Duration:** ~65 minutes
**Clone commit:** 95e8748c856a85b79ca03e04f0ad93b382f80f4a (2026-04-22 15:36 EDT)

---

## Executive Summary

The AlienClaw three-agent governance engine in `src/alienclaw/` is fully canonical and matches Bugsy's locked architecture exactly: three fixed Tier-A agents (BossBot/AdvisorBot/CreatorBot), ephemeral Specialists (the `Employee` class), ephemeral Martians with a 256-char Base62 genome (4 sections × 64 chars), an enforced communication graph, and zero remaining Meeseeks references. The core code is KEEP-AS-IS.

The repo also contains a large volume of OpenClaw content that was imported during a prior architecture phase (when AlienClaw vendored OpenClaw's source and reskinned it). That vendor+reskin approach was abandoned (commit 11c4ed2e, ~93 commits ago). The vendor and build directories were removed, but the surrounding OpenClaw infrastructure — 52 skill directories, 44 docs pages, VISION.md (describing iOS/Android companion apps and ClawHub), a 652KB CHANGELOG.md, CI workflows that reference `apps/android/`, `apps/macos/`, and `pnpm` commands that don't exist — was not cleaned up. This content is DRIFT, not aspirational: it actively misrepresents what AlienClaw is.

The `openclaw` npm package exists (version 2026.5.4, published 8 hours before this recon). The install path works. `alienclaw.net` is live on Hostinger. All 8 open PRs are from dependabot targeting paths that don't exist; they should all be closed.

---

## Phase 1 — Pre-flight

| Check | Result |
|-------|--------|
| git version | 2.53.0 ✓ |
| node version | v22.22.1 ✓ |
| npm version | 9.2.0 ✓ |
| Clone target empty | Directory did not exist ✓ |
| `.packet-reports/` created | ✓ |

Note: `.packet-reports/` was created before cloning, which caused `git clone` to fail (non-empty target). Worked around with `git init` + `git fetch` inside the existing directory. See `packet-01-bugs.md`.

---

## Phase 2 — Clone and Inventory

Repository cloned from `github.com/AlienTool/AlienClaw` to `~/Desktop/alienclaw/`.
Branch: `main` (set up to track `origin/main`).
Tag present: `v0.1.0`.

**Remote branches beyond main:**
- 8 dependabot branches (matching the 8 open PRs)
- 1 `remediation/v0.1-install-rework`

**File counts (excl .git):**
- Total: 936 files
- TypeScript: 44 | Python: 11 | JavaScript: 6 | Shell: 9 | Markdown: 744

744 markdown files is explained by `skills/` (52 SKILL.md files + subscripts) and `docs/` (44 entries × multiple pages each). This is OpenClaw documentation bulk.

**Load-bearing file summaries:** See `packet-01-inventory.md`.

**Documentation classification:**
| File | Classification | Reason |
|------|---------------|--------|
| README.md | DESCRIPTIVE | Accurately describes three-agent system |
| CLAUDE.md | DESCRIPTIVE | Hard rules match code |
| AGENTS.md | DESCRIPTIVE | Agent routing for Claude Code context |
| VISION.md | DRIFT | Describes iOS/Android companion apps, ClawHub, mcporter — OpenClaw vision |
| ROADMAP.md | ASPIRATIONAL (marked) | NOTE at top; bug tracker + forward-looking design |
| alienclaw-HANDOFF-v0.9.md | DRIFT | Old vendor+reskin architecture; superseded |
| CHANGELOG.md | DRIFT | 652KB — OpenClaw's full changelog |
| SECURITY.md | DRIFT | 20KB OpenClaw security policy |
| CONTRIBUTING.md | DRIFT | OpenClaw contributing guide |
| docs.acp.md | UNCLEAR | ACP docs — needs review in Packet 2 |

---

## Phase 3 — Install Path Verification

**Step 1 — npm package existence:**
`openclaw` exists on npm registry.
- Version: 2026.5.4 (latest); 2026.5.4-beta.3 (beta)
- Published: 8 hours ago by GitHub Actions (automated release)
- License: MIT
- Dependencies: 58
- Versions: 143 (active project with frequent releases)
- Weekly downloads: not checked
- **INSTALL PATH IS NOT BROKEN AT STEP 1.**

**Step 2 — install.sh inspection:**
- 280 lines, bash 3.2+ compatible
- Supports `--dry-run`, `--uninstall`, `--help`
- Checks for seed dir before running (exits with helpful error if not cloned)
- Creates `~/.openclaw/agents/{bossbot,advisorbot,creatorbot}/`
- Copies `seed/agents/<agent>/*` → `~/.openclaw/agents/<agent>/`
- Sets BossBot as default agent by writing to `~/.openclaw/openclaw.json`
- Backs up existing openclaw.json before modifying (per CLAUDE.md rule)
- NO `agentId` in agent defaults (per CLAUDE.md rule)
- Destructive operations: creates agent workspace directories, backs up and modifies openclaw.json

**Step 3 — dry-run:**
```
==> Checking for OpenClaw: [dry-run] Skipping version check
==> Provisioning AlienClaw agents:
    bossbot → /home/xil/.openclaw/agents/bossbot ✓
    advisorbot → /home/xil/.openclaw/agents/advisorbot ✓
    creatorbot → /home/xil/.openclaw/agents/creatorbot ✓
==> Setting BossBot as default
    [dry-run] Would backup openclaw.json and set workspace to bossbot
```
Dry-run completed cleanly. No errors.

**Step 4 — installer/ directory:**
- `installer/install.sh` — thin wrapper calling `../install.sh`. KEEP.
- `installer/scripts/copy-dist.sh` — copies `openclaw/` → `build/`. `openclaw/` doesn't exist. Dead code. ARCHIVE.
- `installer/scripts/reskin.sh` — complex brand-reskin script for old vendor pipeline. Not invoked by install.sh. ARCHIVE.

**Install path verdict: FUNCTIONAL.** `npm install -g openclaw` → `bash install.sh` works as described. The install.sh correctly embodies the three-agent canonical architecture.

---

## Phase 4 — Architecture A vs B Finding

**See `packet-01-architecture-finding.md` for full evidence.**

Summary:
- The code implements Architecture B (canonical) precisely
- `src/alienclaw/` is correct: 256-char Base62 genome, 4×64 sections, IDENTITY/EXECUTION/BEHAVIOR/CHECKSUM
- Three fixed Tier-A agents; `TierAAgent` type enforces the boundary
- Specialists = ephemeral Employee instances, campaign-scoped, dispose on campaign end
- Martians = genome files (`.ms`), executed by martian-executor.ts, fitness-reported to AdvisorBot+CreatorBot (not BossBot)
- Communication graph enforced by type system (TierAAgent) and AgentChannel
- Zero Meeseeks references anywhere

The "five-layer" hypothesis was not confirmed. The README already describes the canonical architecture correctly. Drift is in the surrounding imported OpenClaw content, not in the architecture description or the code.

---

## Phase 5 — Agent File Salvage Assessment

| Agent | File | Coherence | Quality | Disposition | Rationale |
|-------|------|-----------|---------|-------------|-----------|
| bossbot | SOUL.md | matches | thoughtful | KEEP-AS-IS | Six rules correct, comm graph correct, no-impersonation rules |
| bossbot | AGENTS.md | matches | good | KEEP-AS-IS | AdvisorBot high freq, CreatorBot medium freq — canonical |
| bossbot | TOOLS.md | partial | adequate | KEEP-WITH-EDITS | Says "standard OpenClaw tool set" — should say Martian execution |
| bossbot | HEARTBEAT.md | matches | good | KEEP-AS-IS | Proactive AdvisorBot check-ins; graceful fallback |
| bossbot | MEMORY.md | matches | good | KEEP-AS-IS | Empty template, correct |
| advisorbot | SOUL.md | matches | excellent | KEEP-AS-IS | Stateless, advisory-only, no tools, signs off on completion |
| advisorbot | AGENTS.md | matches | good | KEEP-AS-IS | Receives BossBot and CreatorBot consults |
| advisorbot | TOOLS.md | matches | good | KEEP-AS-IS | Explicitly "no tools" |
| advisorbot | HEARTBEAT.md | matches | adequate | KEEP-AS-IS | Check HEARTBEAT.md content before confirming |
| advisorbot | MEMORY.md | matches | good | KEEP-AS-IS | Empty template |
| creatorbot | SOUL.md | matches | excellent | KEEP-AS-IS | Six rules, sole genome author, disposal responsibility |
| creatorbot | AGENTS.md | matches | good | KEEP-AS-IS | Routing correct |
| creatorbot | TOOLS.md | partial | weak | KEEP-WITH-EDITS | "file write tool only, writes to ~/.openclaw/…" — path wrong, description doesn't mention .ms genome files |
| creatorbot | HEARTBEAT.md | matches | adequate | KEEP-AS-IS | Check HEARTBEAT.md content |
| creatorbot | MEMORY.md | matches | good | KEEP-AS-IS | Empty template |

**No non-canonical agents found in `seed/agents/`.** Exactly three agent directories: bossbot, advisorbot, creatorbot.

---

## Phase 6 — PR Triage

All 8 PRs are from `dependabot[bot]`. None are human code contributions.

| PR | Author | Updated | Type | Recommendation | Reason |
|----|--------|---------|------|----------------|--------|
| #10 | dependabot | 2026-04-22 | Android dep bump | CLOSE-STALE | `apps/android/` doesn't exist in main |
| #7 | dependabot | 2026-04-15 | actions/create-github-app-token bump | CLOSE-STALE | CI workflows are OpenClaw infrastructure; should be rebuilt |
| #6 | dependabot | 2026-04-15 | actions/checkout bump | CLOSE-STALE | Same |
| #5 | dependabot | 2026-04-15 | docker/login-action bump | CLOSE-STALE | Docker release workflow is OpenClaw infrastructure |
| #4 | dependabot | 2026-04-15 | actions/upload-artifact bump | CLOSE-STALE | Same as #6 |
| #3 | dependabot | 2026-04-15 | actions/setup-node bump | CLOSE-STALE | Same as #6 |
| #2 | dependabot | 2026-04-22 | macOS Swift dep bump | CLOSE-STALE | `apps/macos/` doesn't exist in main |
| #1 | dependabot | 2026-04-15 | Swabble Swift dep bump | CLOSE-STALE | `Swabble/` doesn't exist in main |

**Recommended bulk action:** Close all 8. None can be merged — target paths don't exist.

Note: PRs #1, #2, #10 reference `apps/android/`, `apps/macos/`, and `Swabble/` — these must have been created from an earlier state of the repo (or a different repo) when those directories existed. They are now permanently non-mergeable.

---

## Phase 7 — alienclaw.net Status

| Check | Result |
|-------|--------|
| `dig alienclaw.net` | 147.79.120.193, 92.112.198.234 (two IPs, Hostinger) |
| `dig www.alienclaw.net` | CNAME → www.alienclaw.net.cdn.hstgr.net, resolves to 77.37.76.209, 147.79.120.148 |
| `dig api.alienclaw.net` | **No record — DNS not configured** |
| HTTPS status | HTTP/2 200 (live, serves content) |
| HTTP redirect | 301 → HTTPS (correct) |
| Last-Modified | Sun, 22 Mar 2026 (about 6 weeks before this recon) |
| Platform header | `hostinger` |
| Registrar | Hostinger operations, UAB |
| Expiry | 2027-03-21T18:30:45Z |
| Name servers | NS1.DNS-PARKING.COM, NS2.DNS-PARKING.COM |

**Summary:** `alienclaw.net` is live and serving HTTPS content (not a placeholder page). Whatever is currently there was last modified ~6 weeks ago. `api.alienclaw.net` has no DNS record — this is expected since the API server (Packet 10) hasn't been built yet.

---

## Decisions Bugsy needs to make in Packet 2

See `packet-01-decisions-needed.md` for the full decision checklist. Key urgencies:

1. **D8 (CI rebuild)** — highest urgency. `ci.yml` fails on every push. Even a minimal typecheck + install-smoke CI should be in Packet 2.
2. **D2c (VISION.md replacement)** — VISION.md completely misrepresents AlienClaw. Should be replaced.
3. **D1 (OpenClaw content strategy)** — archive/ vs delete vs curate. Scopes most of Packet 2.
4. **D4 (Close all 8 PRs)** — mechanical, should happen in Packet 2.
5. **Everything else** — deferrable.

---

## Risks and Unknowns

- **`alienclaw.net` serves real content** from 2026-03-22. Unknown what it contains. Packet 9 landing page work should check this before overwriting.
- **`openclaw` releases very frequently** (version 2026.5.4 published 8 hours before this recon). AlienClaw's install.sh does not pin a specific openclaw version. A breaking upstream release could break AlienClaw without warning.
- **`remediation/v0.1-install-rework` branch** exists on origin. Not explored in this recon. May contain relevant work-in-progress.
- **`test/git-hooks-pre-commit.test.ts`** — not read in detail. May be AlienClaw-specific or OpenClaw infrastructure. Should be reviewed in Packet 2.
- **CI `install-smoke.yml`** — may already contain a valid AlienClaw smoke test. Review before rebuilding CI.
- **`SECURITY.md` (20KB)** — large security policy. May contain partially applicable content. Review before replacing.
- **`docs.acp.md`** — ACP is the Agent Client Protocol. May be relevant to AlienClaw's inter-agent communication design.

---

## Recommended Packet 2 Scope

The evidence suggests Packet 2 should focus on: (1) close all 8 PRs, (2) replace the broken ci.yml with minimal AlienClaw-specific CI (typecheck + install-smoke), (3) replace VISION.md with an AlienClaw-accurate vision statement, (4) move OpenClaw-only content (skills/, docs/, CHANGELOG.md, SECURITY.md, CONTRIBUTING.md, installer/scripts/copy-dist.sh + reskin.sh, test/fixtures/) to `archive/`, and (5) fix the two TOOLS.md files (bossbot + creatorbot). The src/alienclaw/ code needs no changes — it's canonical.
