# Delegation & routing on Hermes (profiles + orchestrator)

Hermes routing is by **profile**, not OpenClaw-style `AGENTS.md` entries and not a
`delegation` config section (neither exists in Hermes). Each AlienClaw agent is a
Hermes profile at `~/.hermes/profiles/<name>/`, created by `install-hermes.sh` with
`hermes profile create <name> --description "<role>"`; the description drives the
orchestrator's routing. This file documents intent.

I (CreatorBot) work silently — I receive campaign schemes and build Subagents.

## BossBot
- **profile:** `bossbot` — `~/.hermes/profiles/bossbot/` — my primary caller.

## AdvisorBot
- **profile:** `advisorbot` — `~/.hermes/profiles/advisorbot/` — I consult it for build-decision strategy when a scheme is ambiguous (behavioral prose; no typed frequency key on Hermes).
