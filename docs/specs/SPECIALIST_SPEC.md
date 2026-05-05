---
spec: SPECIALIST_SPEC
version: "1.0"
status: locked
last-updated: 2026-05-05
---

# Specialist Specification

## Purpose and scope

A Specialist is an ephemeral subagent created by CreatorBot to run a single campaign.
Specialists carry campaign-specific domain knowledge, summon Martians for tool work,
accumulate results, deliver a brief campaign report to BossBot, and erase themselves.
They are not general-purpose agents — each Specialist is purpose-built for exactly one
campaign and lives only as long as that campaign runs.

Specialists do NOT carry a genome. (512-char Specialist evolution is explicitly
far-future per ROADMAP.md. In current scope, Specialists are instantiated from
templates, not evolved.)

This spec defines the 5-file directory structure, the lifecycle, the communication
contract, the persistence boundaries, and the template variables CreatorBot fills
when instantiating a Specialist. It synthesizes the SOUL.md pattern from the
`mergisi/awesome-openclaw-agents` agent template library with AlienClaw's existing
`seed/agents/` 5-file structure.

---

## Lifecycle

A Specialist passes through four phases:

### 1. Birth

BossBot finalizes a campaign plan (a Scheme) in consultation with AdvisorBot.
BossBot sends a campaign request to CreatorBot specifying the campaign ID, objective,
scope, allowed Martian tools, success criteria, and communication style preference.

CreatorBot:

1. Generates a unique `campaign_id` (format: `CAMP_<8-char-uppercase-alphanumeric>`)
2. Creates the directory `~/.alienclaw/specialists/<campaign_id>/`
3. Fills in the 5-file template (see File structure below)
4. Registers the Specialist in the governance loop's active-campaign set
5. Signals BossBot that the Specialist is ready

The Specialist is considered alive from the moment its directory is created.

### 2. Run

The Specialist reads its `CAMPAIGN.md` to understand the objective and scope.
It plans its execution within the campaign boundaries. It summons Martians by calling
`summonMartian(tag, task, context)` — the ONLY mechanism for tool execution.

The Specialist MUST update its `HEARTBEAT.md` at least every 5 minutes during active
work, replacing the last-updated timestamp and status line. BossBot polls this file
to monitor campaign progress.

The Specialist collects results from Martian executions. It MUST NOT bypass the
`summonMartian()` interface to call tools directly. Every tool call goes through a
Martian.

### 3. Report

When the campaign objective is achieved (or a hard failure occurred), the Specialist:

1. Writes a campaign report to `~/.alienclaw/reports/<campaign_id>.md` (this file
   survives erase; BossBot reads it)
2. Sends a report notification to BossBot via the governance comm channel
3. Waits for BossBot's acknowledgment (timeout: 60 seconds by default)
4. If BossBot acknowledges within the timeout: proceeds to Erase
5. If timeout expires without acknowledgment: logs the timeout in
   `~/.alienclaw/reports/<campaign_id>-erase-failed.md` and persists in a
   `STALLED` state for manual recovery

### 4. Erase

After BossBot's acknowledgment is received:

1. Deletes `~/.alienclaw/specialists/<campaign_id>/` and all contents
2. Deregisters from the governance loop's active-campaign set
3. Exits

The `~/.alienclaw/reports/<campaign_id>.md` file MUST NOT be deleted by the
Specialist. It belongs to BossBot's reporting namespace.

---

## File structure

A Specialist's directory contains exactly 5 files. No more, no fewer.

```
~/.alienclaw/specialists/<campaign_id>/
├── SOUL.md        — Specialist identity, personality, role
├── CAMPAIGN.md    — Campaign brief from BossBot
├── TOOLS.md       — Allowed Martian tool tags
├── MEMORY.md      — Working memory (transient, erased at erase)
└── HEARTBEAT.md   — Current status (updated periodically during run)
```

Note: `AGENTS.md` is deliberately absent. Specialists do not manage other agents.
The communication graph is enforced at the AlienClaw runtime layer, not at the
Specialist file level. A Specialist that attempted to send messages to AdvisorBot or
other Specialists directly would be blocked by the runtime.

### SOUL.md

The Specialist's identity file, instantiated from the SOUL.md pattern used across
the OpenClaw ecosystem (grounded in `mergisi/awesome-openclaw-agents` templates).

Structure:

```markdown
# <Specialist_ID> — <Role>

<One sentence describing what this Specialist does and why it exists for this campaign.>

## Core Identity

- **Role:** <specific campaign role, e.g., "Research Specialist for hacker-news campaign">
- **Campaign:** <campaign_id>
- **Domain:** <domain, e.g., "web research and content extraction">
- **Communication style:** <terse | verbose | structured — from BossBot preference>
- **Created by:** CreatorBot
- **Lifecycle:** Ephemeral — erases when campaign <campaign_id> ends

## Responsibilities

<numbered list of this campaign's specific responsibilities>

## Knowledge base

<campaign-specific domain knowledge injected by CreatorBot:
 articles, context, prior research, scope definitions, etc.>

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

The SOUL.md MUST include the campaign_id in the Core Identity section. The `Rules`
section MUST include all five communication-graph constraints verbatim.

### CAMPAIGN.md

The campaign brief, written by CreatorBot from BossBot's campaign request.

```markdown
# Campaign Brief — <campaign_id>

## Objective

<Clear statement of what this campaign must accomplish. Specific, measurable.>

## Scope

<What is IN scope — exactly what the Specialist should work on.>
<What is OUT of scope — explicit boundaries to prevent scope creep.>

## Success criteria

<How "done" is defined. What output or result constitutes campaign completion.>

## Constraints

<Hard limits: time budget (if any), resource limits, forbidden operations.>

## Allowed Martian tools

<List of tool tags from TOOLS.md. The Specialist MUST NOT summon tools not listed here.>

## Deliverables

<What the campaign report must include. Format requirements.>

## Background context

<Any relevant context from BossBot/AdvisorBot planning that helps the Specialist
understand the larger goal this campaign serves.>
```

### TOOLS.md

The explicit allowlist of Martian tool tags this Specialist may summon.
CreatorBot selects from the registered Martian pool based on campaign needs.

```markdown
# Tools — <campaign_id>

The following Martian tool tags are authorised for this campaign.
Do not summon tools not on this list.

## Authorised tags

- web_search
- url_fetch
- file_read

## Rationale

<One sentence per tool explaining why each was included for this campaign.>
```

The Specialist MUST treat this list as an allowlist. Any `summonMartian()` call with
a tag not in this file MUST be preceded by an escalation to BossBot requesting
authorization. Evidence for this pattern: `src/alienclaw/agents/employee.ts:59`
defines `authorisedTags: ReadonlySet<string>` and `src/alienclaw/agents/employee.ts:180-184`
enforces tag validation before summoning.

### MEMORY.md

The Specialist's transient working memory during the campaign. Starts empty.
Updated freely by the Specialist as it accumulates research, partial results,
decisions, and failure notes.

```markdown
# Memory — <campaign_id>

<!-- Specialist appends working notes here during the campaign. -->
<!-- This file is DELETED at campaign erase. Do not put anything here -->
<!-- that needs to survive the campaign. Use the campaign report instead. -->

---

<!-- Format: dated entries in reverse chronological order -->
```

MEMORY.md is the Specialist's scratch pad. Its contents are not structured — the
Specialist may write whatever is useful for its own working context. The file is
erased with the campaign directory.

### HEARTBEAT.md

A status file that BossBot polls to monitor campaign progress without interrupting
the Specialist. The Specialist MUST update it at least every 5 minutes during
active work.

```markdown
# Heartbeat — <campaign_id>

## Status

**State:** <RUNNING | STALLED | COMPLETE | FAILED>
**Last updated:** <ISO timestamp>
**Progress:** <brief human-readable status, e.g., "Fetched 14/20 articles">

## Recent activity

<Last 3 actions taken, most recent first>
- <action 3>
- <action 2>
- <action 1>

## Blockers

<Any current blockers. Empty if none.>
```

BossBot reads HEARTBEAT.md on a polling interval (default: every 2 minutes). If
`Last updated` is more than 10 minutes stale and the state is not COMPLETE, BossBot
treats the campaign as STALLED and surfaces a notification to the user.

---

## Template variables

CreatorBot fills these variables when generating a Specialist's 5 files:

| Variable | Format | Description |
| --- | --- | --- |
| `{{campaign_id}}` | `CAMP_<8 chars>` | Unique campaign identifier |
| `{{campaign_brief}}` | Prose | The user goal, refined by Boss+Advisor planning |
| `{{campaign_scope}}` | Prose | Explicit in-scope and out-of-scope boundaries |
| `{{allowed_tools}}` | Tag list | Subset of registered Martian tool tags |
| `{{success_criteria}}` | Prose | What "done" looks like, measurably |
| `{{deliverables}}` | Prose | What the campaign report must include |
| `{{communication_style}}` | `terse / verbose / structured` | From BossBot's user preference |
| `{{background_context}}` | Prose | Relevant context from Boss+Advisor planning |
| `{{role}}` | Prose | Campaign-specific role title |
| `{{domain}}` | Prose | Campaign domain (e.g., "web research") |
| `{{knowledge_base}}` | Prose | Domain knowledge baked in at birth |
| `{{martian_tags}}` | Tag list | Same as allowed_tools, formatted for SOUL.md |

---

## Communication contract

Specialists are subject to strict communication constraints enforced by the runtime.

**Inbound** (Specialist may receive):

- Campaign brief from CreatorBot at birth (written to CAMPAIGN.md)
- Martian execution results (returned by `summonMartian()`)

**Outbound** (Specialist may send):

- `summonMartian(tag, task, context)` — the only tool interface
- Campaign report → `~/.alienclaw/reports/<campaign_id>.md` + governance notification to BossBot

**Forbidden** (Specialist MUST NOT):

- Send messages directly to AdvisorBot
- Send messages directly to other Specialists
- Send messages directly to the user
- Call tools without going through `summonMartian()`
- Receive fitness reports directly (fitness goes Martian → AdvisorBot + CreatorBot)

Evidence: `src/alienclaw/constants.ts:38` defines `REPORT_RECIPIENTS = ['AdvisorBot', 'CreatorBot']`
— BossBot explicitly excluded. `src/alienclaw/agents/employee.ts:115-167` shows
`summonMartian()` as the only tool interface.

---

## Persistence boundaries

| Location | Survives campaign erase? | Owner |
| --- | --- | --- |
| `~/.alienclaw/specialists/<campaign_id>/` | **NO** — deleted at erase | Specialist |
| `~/.alienclaw/reports/<campaign_id>.md` | **YES** | BossBot |
| `~/.alienclaw/reports/<campaign_id>-erase-failed.md` | **YES** | Specialist / manual recovery |
| Martian fitness data (`registry/telemetry/`) | **YES** | AdvisorBot + CreatorBot |

The Specialist MUST write its report before erasing. The report is the only artifact
that survives. If the Specialist crashes before writing the report, recovery is manual.

---

## Concurrency

Multiple Specialists MAY run concurrently for different campaigns. They are fully
isolated by `campaign_id` directory. They do NOT share state, files, or memory.

A single campaign MUST have at most one Specialist running at a time. CreatorBot
enforces this at instantiation — it will not create a second Specialist for a
`campaign_id` that already has an active Specialist directory.

---

## Failure modes

| Failure | What happens | Recovery |
| --- | --- | --- |
| Specialist crashes mid-campaign | Directory persists; heartbeat goes stale | BossBot detects stale heartbeat, surfaces to user, manual recovery |
| Report write fails | Heartbeat shows COMPLETE, report missing | BossBot detects missing report; manual recovery with backup from MEMORY.md |
| BossBot ack timeout (60s) | Specialist writes erase-failed log, enters STALLED state | Manual: check erase-failed log, confirm BossBot received report, trigger erase manually |
| Martian unavailable for required tool | `summonMartian()` returns FAILURE with "no active Martian" | Specialist escalates to BossBot via campaign report gap |
| Campaign exceeds time budget | BossBot sends termination signal | Specialist writes partial report, proceeds to erase |

---

## Worked example

Campaign: "Summarize the top 10 most-discussed stories on Hacker News today."

```
~/.alienclaw/specialists/CAMP_HN7K2P9Q/
├── SOUL.md
├── CAMPAIGN.md
├── TOOLS.md
├── MEMORY.md
└── HEARTBEAT.md
```

**SOUL.md** (excerpt):

```markdown
# CAMP_HN7K2P9Q — HN Research Specialist

Purpose-built to fetch, read, and summarize today's top Hacker News discussions.

## Core Identity

- **Role:** Research Specialist for HN daily summary campaign
- **Campaign:** CAMP_HN7K2P9Q
- **Domain:** Web research and content summarization
- **Communication style:** structured
- **Created by:** CreatorBot
- **Lifecycle:** Ephemeral — erases when campaign CAMP_HN7K2P9Q ends

## Responsibilities

1. Search for today's top Hacker News stories using web_search
2. Fetch the HN threads for the top 10 by score using url_fetch
3. Extract key discussion points from each thread
4. Write a structured summary report with: title, score, URL, 3-sentence summary
5. Deliver report to BossBot and erase

## Rules

- You NEVER speak to the user directly. Only BossBot does.
[... etc ...]
```

**CAMPAIGN.md** (excerpt):

```markdown
# Campaign Brief — CAMP_HN7K2P9Q

## Objective

Find the top 10 most-discussed stories on Hacker News today and produce
a structured summary of each.

## Success criteria

A report containing exactly 10 stories, each with: title, HN URL, score,
comment count, and a 3-sentence plain-language summary of the discussion.

## Allowed Martian tools

- web_search (find the top stories)
- url_fetch (read HN thread pages)
```

**Campaign report** (`~/.alienclaw/reports/CAMP_HN7K2P9Q.md`):

```markdown
# Campaign Report — CAMP_HN7K2P9Q

**Status:** COMPLETE
**Completed:** 2026-05-05T20:45:00Z
**Duration:** 8 minutes

## Summary

10 stories found and summarized. 2 url_fetch calls failed (403 on external
articles) — those stories summarized from HN comments only.

## Stories

### 1. "AlienClaw genome evolution beats baseline on web-crawl tasks"
- **Score:** 847 | **Comments:** 234
- **URL:** https://news.ycombinator.com/item?id=...
- **Summary:** Researchers report a 3x reduction in tool calls per task after
  100 generations of genome evolution. Discussion centers on whether the
  fitness function incentivizes correctness sufficiently. Several commenters
  note the community genome network mechanism as the novel contribution.

[... 9 more stories ...]

## Gaps

- stories 4 and 7: external article URLs returned 403; summarized from HN
  discussion only
```

---

## Defaults chosen during specification

See `packet-03-defaults.md` for the consolidated defaults list.

Key defaults in this spec:

- **BossBot ack timeout**: 60 seconds (configurable in client settings)
- **Heartbeat update interval**: every 5 minutes during active work
- **BossBot stale-heartbeat threshold**: 10 minutes
- **BossBot poll interval**: every 2 minutes
- **5-file structure** (no AGENTS.md): synthesized from seed/agents/ pattern
- **Campaign ID format**: `CAMP_<8-char-uppercase-alphanumeric>`

---

## What is NOT in this spec

- **Specialist genome** (512-char): explicitly far-future per ROADMAP.md; no genome
  at the Specialist layer in current scope
- **Specialist evolution**: requires Specialist genomes; far-future
- **CreatorBot's template selection logic**: how CreatorBot decides which SOUL.md
  template to use for a given campaign domain; CreatorBot's internal logic, lands in
  Packet 6
- **Multi-Specialist coordination within a single campaign**: out of scope; campaigns
  have one Specialist each in current architecture
- **Specialist-to-Specialist messaging**: forbidden by the communication graph; not
  specced because it MUST NOT happen
