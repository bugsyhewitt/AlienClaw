---
spec: SUBAGENT_FILE_FORMAT_v1_3_ADDENDUM
version: "1.3"
status: implementation-notes
supersedes: SPECIALIST_FILE_FORMAT_v1_1_ADDENDUM
implements: SUBAGENT_SPEC v2.0
last-updated: 2026-05-07
---

# Subagent File Format Addendum v1.3

Implementation notes for the TypeScript `Subagent` class (Packet 17).
Supersedes `SPECIALIST_FILE_FORMAT_v1_1_ADDENDUM.md` (which used the prior "Specialist" name).

---

## Rename summary (Packet 17)

- Class: `Specialist` → `Subagent`
- Workspace directory: `~/.alienclaw/specialists/<id>` → `~/.alienclaw/subagents/<id>`
- Workspace file: `TOOLS.md` → `MARTIANS.md`
- Interface fields: `allowedTools` → `allowedMartians`, `specialistsBaseDir` → `subagentsBaseDir`

All architectural semantics from the v1.1 addendum carry forward. Only names changed.

---

## MARTIANS.md — replaces TOOLS.md

Format: Markdown with `## Authorised tags` and `## Rationale` sections listing allowed Martian types.

Written at birth from `SubagentBrief.allowedMartians`. Immutable during campaign.

Example content:
```markdown
# Martians — CAMP_001

The following Martian types are authorised for this campaign.
Do not summon Martians not on this list.

## Authorised tags

- compute_alone
- fetch_then_parse

## Rationale

### compute_alone
Included for this campaign.

### fetch_then_parse
Included for this campaign.
```

---

## HEARTBEAT.md — format unchanged

The HEARTBEAT.md format from v1.1 (markdown status file, rewritten on each update) is preserved unchanged. Event names in log strings will evolve to reference Martian types but the file format is stable.

---

## Workspace lifecycle

Identical to v1.1: birth → running → finalized → erased. The erase step deletes the workspace directory at `~/.alienclaw/subagents/<campaign_id>/` entirely.
