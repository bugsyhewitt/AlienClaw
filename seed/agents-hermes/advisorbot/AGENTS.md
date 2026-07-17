# Other agents I can call (Hermes delegation)

On Hermes, routing lives in the `delegation` config section (`~/.hermes/config.yaml`)
+ MOA, not in OpenClaw-style `AGENTS.md` entries. This file documents the intent
`install-hermes.sh` encodes via `hermes config set`.

I (AdvisorBot) am a stateless advisory endpoint — I respond to consults, I do not
call peers routinely.

## BossBot
- **id:** bossbot · **workspace:** ~/.hermes/agents/bossbot/
- **relationship:** my primary caller (high). I respond to BossBot's consults.

## CreatorBot
- **id:** creatorbot · **workspace:** ~/.hermes/agents/creatorbot/
- **relationship:** calls me for build-decision strategy (medium).
