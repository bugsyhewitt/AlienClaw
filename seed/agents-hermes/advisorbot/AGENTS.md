# Delegation & routing on Hermes (profiles + orchestrator)

Hermes routing is by **profile**, not OpenClaw-style `AGENTS.md` entries and not a
`delegation` config section (neither exists in Hermes). Each AlienClaw agent is a
Hermes profile at `~/.hermes/profiles/<name>/`, created by `install-hermes.sh` with
`hermes profile create <name> --description "<role>"`; the description drives the
orchestrator's routing. This file documents intent.

I (AdvisorBot) am a stateless advisory endpoint — I respond to consults, I do not
call peers routinely.

## BossBot
- **profile:** `bossbot` — `~/.hermes/profiles/bossbot/` — my primary caller.

## CreatorBot
- **profile:** `creatorbot` — `~/.hermes/profiles/creatorbot/` — calls me for build-decision strategy.
