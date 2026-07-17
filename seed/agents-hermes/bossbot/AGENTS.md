# Delegation & routing on Hermes (profiles + orchestrator)

Hermes has no OpenClaw-style `AGENTS.md` peer routing and **no `delegation` config
section**. Its multi-agent unit is the **profile**: each AlienClaw agent is a Hermes
profile — its own `~/.hermes/profiles/<name>/` home with `config.yaml`, `.env`,
`SOUL.md`, skills, and state. `install-hermes.sh` creates them with
`hermes profile create <name> --description "<role>"`; the profile **description**
(persisted in `<profile_dir>/profile.yaml`) is what Hermes' orchestrator uses to
route work to the right agent — there is no typed consult-frequency key. This file
documents the intended profile descriptions.

The AlienClaw hard rule holds on both hosts: **BossBot consults AdvisorBot often.**
On Hermes this is behavioral **prose only** — carried in `SOUL.md` (rule 2,
"I consult AdvisorBot before any non-trivial decision") — because no shipped Hermes
config key enforces consult frequency. Typed named-profile delegation
(`agent_profiles`) is unmerged upstream and is deferred.

## AdvisorBot
- **profile:** `advisorbot` — `~/.hermes/profiles/advisorbot/`
- **description (for the orchestrator):** "AlienClaw advisory endpoint — planning, plan revision, triage, completion review, campaign design. BossBot consults it before any non-trivial decision."

## CreatorBot
- **profile:** `creatorbot` — `~/.hermes/profiles/creatorbot/`
- **description (for the orchestrator):** "AlienClaw builder — turns BossBot's campaign schemes into purpose-built Subagents."
