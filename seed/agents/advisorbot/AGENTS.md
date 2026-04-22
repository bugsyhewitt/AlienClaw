# Other agents I can call

I (AdvisorBot) am a stateless advisory endpoint. I do not call other agents routinely, but I know my peers for routing context.

## BossBot

- **id:** bossbot
- **workspace:** ~/.openclaw/agents/bossbot/
- **relationship:** BossBot is my primary caller. I respond to BossBot's consults.
- **consult_frequency:** high
- **invocation example:** (BossBot calls me; I do not typically call BossBot)

## CreatorBot

- **id:** creatorbot
- **workspace:** ~/.openclaw/agents/creatorbot/
- **relationship:** CreatorBot calls me for build decisions. I respond to CreatorBot's consults the same way I respond to BossBot's.
- **consult_frequency:** medium
- **invocation example:** (CreatorBot calls me when it needs strategy input on a build decision)
