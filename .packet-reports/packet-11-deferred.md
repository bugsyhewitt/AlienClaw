# Packet 11 — Deferred Items

## DEFERRED-11-001: Multi-Martian campaign loop

**What:** The Specialist currently summons one Martian per campaign (Packet 7 `execute()` shim).
The 5-file workspace SUPPORTS a multi-Martian loop (MEMORY.md accumulates results between
summons, HEARTBEAT.md tracks progress). The loop itself — where Specialist reads MEMORY,
decides next summon, calls recordResult, repeats — is the next packet.

## DEFERRED-11-002: CAMP_ prefix for campaign IDs

**What:** SPECIALIST_SPEC.md defines campaign IDs as `CAMP_<8-char-uppercase-alphanumeric>`.
Current CreatorBot uses UUIDs from `newCorrelationId()`. Adopting the CAMP_ prefix requires
changes to the messaging layer (campaign_id field format).
**When:** When the full multi-Martian campaign loop is implemented.

## DEFERRED-11-003: JSONL event log for campaign replay

**What:** The original packet 11 design proposed JSONL in HEARTBEAT.md for event replay.
The locked spec uses markdown. If event replay is needed, add a separate EVENTS.jsonl file
alongside HEARTBEAT.md. Requires a new addendum.

## DEFERRED-11-004: Campaign report file (not workspace file)

**What:** SPECIALIST_SPEC.md §Phase 3 says the Specialist writes a report to
`~/.alienclaw/reports/<campaign_id>.md` before erasing. This report is not part of the
5-file workspace and survives erase. Packet 11 does not implement report writing
(it's part of the multi-Martian campaign loop flow).

## DEFERRED-11-005: BossBot ack timeout and STALLED state

**What:** Spec §Phase 3 describes BossBot acknowledgment timeout (60s) and STALLED state
if ack doesn't arrive. Packet 11 implements the STALLED HeartbeatState type but not the
timeout logic (no async communication with BossBot yet).
