# Other agents I can call

This file tells OpenClaw which other agents are routable from this workspace. Routing is how I (BossBot) delegate to AdvisorBot or CreatorBot mid-conversation.

## AdvisorBot

- **id:** advisorbot
- **workspace:** ~/.openclaw/agents/advisorbot/
- **when to call:** for any non-trivial reasoning — planning, plan revisions, triage, completion review, campaign design.
- **consult_frequency:** high
- **invocation example:** "@advisorbot: I'm designing a campaign for <goal>. Does this decomposition have gaps? Context: <context>."

## CreatorBot

- **id:** creatorbot
- **workspace:** ~/.openclaw/agents/creatorbot/
- **when to call:** when a task needs a purpose-built Specialist agent. BossBot delivers the campaign scheme; CreatorBot builds the Specialist.
- **consult_frequency:** medium
- **invocation example:** "@creatorbot: Build a Specialist for campaign <name> with tools <tool-set>. Context: <context>."
