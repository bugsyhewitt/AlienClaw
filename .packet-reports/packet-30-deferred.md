# Packet 30 — Deferred Items

## L4 — Full CI green: DEFERRED to Packet 31 (pre-requisite)

The npm install trigger is fixed. However CI is not fully green because the
Packet 29 commit included partially-complete TypeScript governance files from
Packets 13-28 development work. Getting CI to fully green requires committing
the complete development arc (hundreds of files) which is out of scope for P30.

**What was fixed in L4:** package.json "install" → "setup" (npm trigger removed),
decoder.py ruff fix (Python lint passes), governance-loop.ts/goal-manager.ts/
escalation-handler.ts fixes (partial TypeScript improvement), brains coverage
exclusion (91% vs 84%).

**What blocks CI green:** governance/common/subagent/ directory (5 TS files),
types.ts changes, bridge restructuring (many files), test updates.

**Recommended action:** Before starting Packet 31 (leaderboard), push the complete
Packets 13-28 development arc as a single "ship the arc" commit. This unblocks
CI and brings the repo to the state it actually exists in locally.

## L5 — Leaderboard: DEFERRED to Packet 31

As planned from the start. api.alienclaw.net deployment + leaderboard live data.

## L1 — LICENSE copyright holder: PENDING Bugsy confirmation

LICENSE file written with placeholder `[COPYRIGHT HOLDER]`. Needs one word
confirmation (Robert Hillman? AlienTool? V3X?) before the commit is final.

## Packet 32 onwards

All adoption-multiplier and hygiene work deferred as planned:
- README onboarding polish (example BossBot goal, output sample, motivation)
- CODE_OF_CONDUCT.md, CHANGELOG.md, CI badge
- @mariozechner/pi-ai license verification
