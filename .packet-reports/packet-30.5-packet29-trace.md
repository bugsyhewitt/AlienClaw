# Packet 30.5 — Packet 29 Protocol Trace

## The question

Packet 29 was audit-only — its protocol said "modifies nothing except audit
reports under .packet-reports/". Did the Packet 29 commit modify code files?

## What the Packet 29 commit actually contains

`git show --name-status cf2376b1`:

```
A  .packet-reports/packet-29-bugs.md          ← audit report ✓
A  .packet-reports/packet-29-defaults.md       ← audit report ✓
A  .packet-reports/packet-29-environment.md    ← audit report ✓
A  .packet-reports/packet-29-gap-list.md       ← audit report ✓
A  .packet-reports/packet-29-helloworld-audit.md ← audit report ✓
A  .packet-reports/packet-29-hygiene-audit.md  ← audit report ✓
A  .packet-reports/packet-29-install-audit.md  ← audit report ✓
A  .packet-reports/packet-29-leaderboard-audit.md ← audit report ✓
A  .packet-reports/packet-29-legal-audit.md    ← audit report ✓
A  .packet-reports/packet-29-readme-audit.md   ← audit report ✓
A  .packet-reports/packet-29-report.md         ← audit report ✓
A  .packet-reports/packet-29-starting-commit.txt ← audit report ✓
A  MEMORY/WORK/20260516-120000_packet-29-launch-readiness-audit/PRD.md ← PRD ✓
A  src/alienclaw/governance/common/advisor-bot.ts    ← CODE FILE ✗
A  src/alienclaw/governance/common/boss-bot.ts       ← CODE FILE ✗
A  src/alienclaw/governance/common/comm-graph.ts     ← CODE FILE ✗
A  src/alienclaw/governance/common/completion-handler.ts ← CODE FILE ✗
A  src/alienclaw/governance/common/creator-bot.ts    ← CODE FILE ✗
A  src/alienclaw/governance/common/escalation-handler.ts ← CODE FILE ✗
A  src/alienclaw/governance/common/goal-loop.ts      ← CODE FILE ✗
A  src/alienclaw/governance/common/goal-manager.ts   ← CODE FILE ✗
A  src/alienclaw/governance/common/governance-loop.ts ← CODE FILE ✗
A  src/alienclaw/governance/common/index.ts          ← CODE FILE ✗
A  src/alienclaw/governance/common/logger.ts         ← CODE FILE ✗
A  src/alienclaw/governance/common/messages.ts       ← CODE FILE ✗
A  src/alienclaw/governance/common/random-genome.ts  ← CODE FILE ✗
A  src/alienclaw/governance/common/real-summon-adapter.ts ← CODE FILE ✗
A  src/alienclaw/governance/common/subagent.ts       ← CODE FILE ✗
A  src/alienclaw/governance/common/summon-adapter.ts ← CODE FILE ✗
A  src/alienclaw/governance/common/sync/client.ts    ← CODE FILE ✗
A  src/alienclaw/governance/common/sync/index.ts     ← CODE FILE ✗
A  src/alienclaw/governance/common/sync/pull.ts      ← CODE FILE ✗
A  src/alienclaw/governance/common/sync/push.ts      ← CODE FILE ✗
A  src/alienclaw/governance/common/sync/scheduler.ts ← CODE FILE ✗
A  src/alienclaw/governance/common/task-manager.ts   ← CODE FILE ✗
A  test/governance/subagent/heartbeat.test.ts        ← CODE FILE ✗
A  test/governance/subagent/memory-append.test.ts    ← CODE FILE ✗
A  test/governance/subagent/workspace.test.ts        ← CODE FILE ✗
```

## Finding

**PROTOCOL VIOLATED** — technically, but not by intent.

The Packet 29 `git add` was correctly scoped: it ran
`git add .packet-reports/packet-29-*.md MEMORY/WORK/.../PRD.md` which named
only the intended audit files. The `git add` did NOT specify governance files.

However, the governance/common/*.ts files were ALREADY STAGED in the git
index before Packet 29 began. They had been staged by Packets 14-23 (which ran
`git add` but never ran `git commit`). When Packet 29 ran `git commit`, it
committed all staged files — the 13 audit files it intended PLUS the 24 code
files that were pre-staged from prior packets.

**Verdict:** Packet 29's `git add` was correct. The `git commit` violated the
protocol by committing pre-staged files from prior packets. Packet 29 lacked
a pre-commit working-tree-clean check that would have caught this.

## Root cause of the leak

**Prior packets (14-23) staged files but did not commit them.** Each of these
packets ran `git add <their-files>` as part of their work, but their exit
sequences did not include `git commit`. The staging area accumulated 24 code
files across multiple packets. Any subsequent commit would sweep them.

This is a process-hygiene failure in the per-packet protocol, not a unique
Packet 29 failure. Packet 29 happened to be the first commit after this
accumulation.

## Process-hygiene lesson

Every packet's exit checklist must include:

1. `git status --porcelain` — confirms working tree contains only intended files
2. `git diff --staged --name-only` — confirms staging area contains ONLY the
   files this packet intends to commit
3. If staging area has unexpected files: either commit them attributed to their
   originating packet, or `git restore --staged <file>` to unstage them first

**The rule:** a packet commits EXACTLY the files it produced. If files from
prior packets are found staged, they are committed in a separate, attributed
commit BEFORE the current packet's commit, not swept in silently.
