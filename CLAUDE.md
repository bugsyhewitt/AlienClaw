# AlienClaw — Claude Code Rules

**P14. Evolutionary AI-agent infra. Alfred WSL2. Packet-based. MIT open source. FULLY WALLED.**

## Commands

```bash
# Tests
pnpm test

# Build + deploy
scripts/build-deploy.sh

# Run packet
./run-packet.sh

# Regen seed genomes (after codec change)
node scripts/regen-seed-genomes.mjs
```

## Don't

- NEVER add LLM calls to Martian execution (Martians = pure genome-symbolic, zero LLM)
- NEVER call the bottom layer "Meeseeks" (use "Martians")
- NEVER call Subagents "Specialists" in new code/docs
- NEVER reference 5-layer architecture (superseded; 3-layer is canonical: TOP/MIDDLE/BOTTOM)
- NEVER let the user talk to AdvisorBot or CreatorBot directly (BossBot = only user-facing agent)
- NEVER trust client-reported fitness — use hardenedFetch + validateLeaderboardResponse
- NEVER change genome length from 256 chars (leaderboard live; orphans shipped genomes)
- NEVER deploy to DigitalOcean (Hostinger only)
- NEVER run directly on Windows bare metal (WSL2 only on Alfred)
- NEVER reference V3X, Pho3nix, music, or any other Bugsy project in AlienClaw materials (FULL WALL)
- NEVER use the Anthropic harness (packet-based execution only)

## Architecture Quick Reference

```
TOP:    BossBot → AdvisorBot + CreatorBot (LLM, no genome)
MIDDLE: Subagents (ephemeral, LLM, built by CreatorBot)
BOTTOM: Martians (ephemeral, 256-char Base62, NO LLM)

Fitness: correctness × 1/(1 + 0.1 × max(0, tool_calls − slot_count))
```

## Verification Plan

1. `pnpm test` — runs vitest (430 passed, 34 skipped) + pytest (756 passed, 125 skipped) = 1,186 passed; must exit 0
2. CI: GREEN on bugsyhewitt/AlienClaw
3. Martian execution: confirm no LLM calls in martian-executor.ts path
4. Communication graph: user prompt reaches BossBot only; fitness reports bypass BossBot
5. Leaderboard: test submit via hardenedFetch → validateLeaderboardResponse → submitFromFile
6. Wall: grep for V3X/Pho3nix/music/meeseeks/specialist in new code → zero hits

## Context

Full spec: TELOS-IDENTITY.md, TELOS-STATE.md, TELOS-STACK.md, TELOS-CANON.md  
Packet contract: .claude-code/packet-contract.md  
Locked decisions: .claude-code/locked-decisions.md
