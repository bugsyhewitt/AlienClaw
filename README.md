**v0.1 scope:** AlienClaw v0.1 is the OpenClaw configuration layer that ships three wired agents (BossBot, AdvisorBot, CreatorBot). The genome evolution and Meeseeks execution layer described below is v0.2 material and currently parked under `experimental/`. Install v0.1 with `bash install.sh`.

# AlienClaw Remediation Bundle

Drop-in replacement files for the AlienClaw v0.1 remediation.
Pair this with `ALIENCLAW_REMEDIATION_PLAN.md` (the full playbook).

## What's in this bundle

| File in bundle                           | Goes to (relative to repo root)              |
|------------------------------------------|----------------------------------------------|
| `install.sh`                             | `install.sh`  *(overwrite)*                  |
| `alienclaw.mjs`                          | `alienclaw.mjs`  *(overwrite)*               |
| `CLAUDE.md`                              | `CLAUDE.md`  *(overwrite, was empty)*        |
| `AGENTS.md`                              | `AGENTS.md`  *(overwrite, was wrong file)*   |
| `scripts/verify-install.sh`              | `scripts/verify-install.sh`  *(new)*         |
| `experimental/governance-engine/README.md` | `experimental/governance-engine/README.md`  *(new, after moving parked code here)* |
| `seed/agents/bossbot/*.md` (7 files)     | `seed/agents/bossbot/`  *(new)*              |
| `seed/agents/advisorbot/*.md` (7 files)  | `seed/agents/advisorbot/`  *(new)*           |
| `seed/agents/creatorbot/*.md` (7 files)  | `seed/agents/creatorbot/`  *(new)*           |

## Order of operations (for the Claude Code agent)

Follow Parts 0 → 11 of `ALIENCLAW_REMEDIATION_PLAN.md`. The files here replace the "write this file with this content" blocks in the plan — copy each file directly instead of hand-typing from the spec.

## Quick copy (assuming bundle is extracted at `/tmp/alienclaw-bundle/` and repo is at `$REPO`)

```bash
cp /tmp/alienclaw-bundle/install.sh              "$REPO/install.sh"
cp /tmp/alienclaw-bundle/alienclaw.mjs           "$REPO/alienclaw.mjs"
cp /tmp/alienclaw-bundle/CLAUDE.md               "$REPO/CLAUDE.md"
cp /tmp/alienclaw-bundle/AGENTS.md               "$REPO/AGENTS.md"

mkdir -p "$REPO/scripts"
cp /tmp/alienclaw-bundle/scripts/verify-install.sh "$REPO/scripts/verify-install.sh"

mkdir -p "$REPO/experimental/governance-engine"
cp /tmp/alienclaw-bundle/experimental/governance-engine/README.md "$REPO/experimental/governance-engine/README.md"

mkdir -p "$REPO/seed/agents"
cp -r /tmp/alienclaw-bundle/seed/agents/* "$REPO/seed/agents/"

chmod +x "$REPO/install.sh" "$REPO/scripts/verify-install.sh"
```

After copying: do the `git mv` of parked code into `experimental/governance-engine/` per Part 6 Step 3 of the plan.

## Sanity checks

```bash
# 21 seed files, 7 per agent × 3 agents
find seed/agents -name '*.md' | wc -l     # expect 21

# Bundle totals 28 files
find . -type f | wc -l                     # expect 28 (including this README)
```
