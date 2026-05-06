# Packet 11 — Specialist File Formats

All 5 files use Markdown format per SPECIALIST_SPEC.md. Files are written atomically
(sibling tmp + rename within the workspace directory). Workspace directory has mode 0700.

---

## SOUL.md

**Written by:** CreatorBot at Specialist birth  
**Mutability:** Immutable after birth  
**Purpose:** Specialist identity — who it is, what it does, its rules

```markdown
# CAMP_XXXXXXXX — <role>

<one-sentence purpose for this campaign>

## Core Identity

- **Role:** <role>
- **Campaign:** CAMP_XXXXXXXX
- **Domain:** <domain>
- **Communication style:** terse | verbose | structured
- **Created by:** CreatorBot
- **Lifecycle:** Ephemeral — erases when campaign CAMP_XXXXXXXX ends

## Responsibilities

1. <first responsibility from campaign brief>
2. <...>

## Knowledge base

<domain knowledge from CreatorBot's brief>

## Rules

- You NEVER speak to the user directly. Only BossBot does.
- You NEVER speak to AdvisorBot. Your planning is your own.
- You NEVER speak to other Specialists.
- You summon Martians for ALL tool work — no direct tool calls.
- You update HEARTBEAT.md every 5 minutes during active work.
- When your campaign ends, you write a report and wait for BossBot's ack.
- After ack, you erase yourself completely.

## Summoning protocol

Before calling summonMartian():
1. State what specific tool operation you need
2. Confirm the tag is in your TOOLS.md allowlist
3. Construct context with all required variables
4. Evaluate the result — don't pass through blindly
5. If no Martian exists for the work you need: escalate to BossBot

## Fail-forward protocol

If a Martian exhausts its retry budget and returns FAILURE:
- First failure: try an alternative approach if one exists
- Second failure: log in MEMORY.md and continue with available data
- Third failure on same operation: include in campaign report as a gap;
  do not block campaign completion for one failed data point
```

---

## CAMPAIGN.md

**Written by:** CreatorBot at Specialist birth  
**Mutability:** Immutable after birth  
**Purpose:** Campaign brief — objective, scope, success criteria

```markdown
# Campaign Brief — CAMP_XXXXXXXX

## Objective

<what this campaign must accomplish — specific, measurable>

## Scope

<what is IN scope>
<what is OUT of scope>

## Success criteria

<how "done" is defined>

## Constraints

<hard limits: time budget, forbidden operations>

## Allowed Martian tools

- <tool_1>
- <tool_2>

## Deliverables

<what the campaign report must include>

## Background context

<relevant context from BossBot/AdvisorBot planning>
```

---

## TOOLS.md

**Written by:** CreatorBot at Specialist birth  
**Mutability:** Immutable after birth  
**Purpose:** Explicit allowlist of Martian types this Specialist may summon

```markdown
# Tools — CAMP_XXXXXXXX

The following Martian tool tags are authorised for this campaign.
Do not summon tools not on this list.

## Authorised tags

- <tool_1>
- <tool_2>

## Rationale

### <tool_1>
<one sentence explaining why this tool is needed for this campaign>
```

---

## MEMORY.md

**Written by:** Specialist (via `recordResult()` and direct appends)  
**Mutability:** MUTABLE — sections append freely during campaign  
**Purpose:** Transient working memory; DELETED at erase (does not survive campaign)

```markdown
# Memory — CAMP_XXXXXXXX

<!-- Specialist appends working notes here during the campaign. -->
<!-- This file is DELETED at campaign erase. Do not put anything here -->
<!-- that needs to survive the campaign. Use the campaign report instead. -->

---

<!-- Format: dated entries in reverse chronological order -->
```

After Martians are summoned, `recordResult()` appends entries chronologically AFTER the `---` divider:

```markdown
## Summon 1 — <martian_type> (<ISO timestamp>)

- **Summon ID:** <uuid prefix>
- **Input:** <inputs summary>
- **Genome:** <first 16 chars>...
- **Fitness:** <value>
- **OK:** <true|false>
- **Output:** <output summary>
```

Sections accumulate; nothing is deleted from MEMORY.md.

---

## HEARTBEAT.md

**Written by:** Specialist (via `updateHeartbeat()`)  
**Mutability:** MUTABLE — status sections rewritten on each update  
**Purpose:** BossBot polling file — current state, progress, recent activity

Implementation note: The packet instructions proposed JSONL append-only semantics for
HEARTBEAT.md. SPECIALIST_SPEC.md (locked) defines HEARTBEAT.md as a markdown status
file that BossBot polls by reading Status/Last-updated fields. This implementation
follows the locked spec. See docs/specs/SPECIALIST_FILE_FORMAT_v1_1_ADDENDUM.md.

```markdown
# Heartbeat — CAMP_XXXXXXXX

## Status

**State:** RUNNING
**Last updated:** <ISO timestamp>
**Progress:** <brief human-readable status>

## Recent activity

- <most recent action>
- <second most recent>
- <third most recent>

## Blockers

None
```

At birth, State=RUNNING, Progress="Born — awaiting first Martian summon".
After each Martian result, progress and activity are updated.
On `finalize()`, State changes to COMPLETE or FAILED.
HEARTBEAT.md is the LAST file written before the workspace is deleted.

---

## Who writes what when

| File | Written at | Updated when | By |
| --- | --- | --- | --- |
| SOUL.md | birth | never | CreatorBot → Specialist |
| CAMPAIGN.md | birth | never | CreatorBot → Specialist |
| TOOLS.md | birth | never | CreatorBot → Specialist |
| MEMORY.md | birth (empty) | recordResult(), summon events | Specialist |
| HEARTBEAT.md | birth | each state change | Specialist |
