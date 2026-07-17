# Other agents I can call (Hermes delegation)

On Hermes, routing lives in the `delegation` config section (`~/.hermes/config.yaml`)
+ MOA, not in OpenClaw-style `AGENTS.md` entries. This file documents the intent
`install-hermes.sh` encodes via `hermes config set`.

I (CreatorBot) work silently — I receive campaign schemes and build Subagents.

## BossBot
- **id:** bossbot · **workspace:** ~/.hermes/agents/bossbot/
- **relationship:** my primary caller (medium). I receive campaign schemes and report completion.

## AdvisorBot
- **id:** advisorbot · **workspace:** ~/.hermes/agents/advisorbot/
- **delegation:** high — I call AdvisorBot for build-decision strategy when a scheme is ambiguous.
