# Packet 11 — Defaults

## Three architectural decisions logged (per spec)

### 1. On-disk during campaign, deleted on erase

Files exist for the lifetime of the campaign. `birth()` creates them; `erase()` deletes
the entire `~/.alienclaw/specialists/<campaign_id>/` directory. This means:
- A campaign's workspace is debuggable while running (`cat ~/.alienclaw/specialists/<id>/MEMORY.md`)
- After erase, no workspace files remain on disk
- The campaign report (`~/.alienclaw/reports/<campaign_id>.md`) is NOT deleted — it belongs to BossBot

### 2. Markdown files, not JSON/YAML

All 5 files are `.md`. When Specialists eventually get LLM backing, the file contents
go directly into prompts. Markdown is human-readable, LLM-readable, grep-able without
parsing. JSON/YAML would force serialize/deserialize cycles and lose the prose-as-substrate
property that makes LLM backing tractable.

### 3. HEARTBEAT.md is the mutable status file; MEMORY.md accumulates

Per SPECIALIST_SPEC.md (locked):
- HEARTBEAT.md: mutable markdown status file, rewritten on each state change. BossBot polls it.
- MEMORY.md: append-only at the entry level. Sections can be rewritten via rewriteMemorySection().

The initial packet proposal (JSONL append-only HEARTBEAT) was not adopted because it
conflicts with the locked spec's definition. See addendum for details.

## Default values

| Setting | Default | Configured by |
| --- | --- | --- |
| Workspace base dir | `~/.alienclaw/specialists/` | `SpecialistOptions.specialistsBaseDir` |
| Workspace dir mode | 0700 | Hardcoded in `birth()` |
| Activities kept in memory | 10 max | Hardcoded in Specialist class |
| Activities shown in HEARTBEAT | 3 | Hardcoded in `buildHeartbeatMd()` |
| Campaign ID format | UUID (from CampaignRequestMessage) | CreatorBot / messaging layer |
