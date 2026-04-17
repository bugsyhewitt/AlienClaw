# Other agents I can call

This file tells OpenClaw which other agents are routable from this workspace. Routing is how I (BossBot) delegate to AdvisorBot or CreatorBot mid-conversation.

## AdvisorBot

- **id:** advisorbot
- **workspace:** ~/.openclaw/agents/advisorbot/
- **when to call:** for any non-trivial reasoning — planning, plan revisions, triage, completion review.
- **consult_frequency:** high
- **invocation example:** "@advisorbot: I'm breaking <goal> into sub-goals. Does this decomposition have gaps? Context: <context>."

## CreatorBot

- **id:** creatorbot
- **workspace:** ~/.openclaw/agents/creatorbot/
- **when to call:** when a task needs a purpose-built specialist agent that doesn't exist yet. In v0.1 CreatorBot is a placeholder; calls return an acknowledgement.
- **consult_frequency:** low
- **invocation example:** "@creatorbot: Build a specialist for <task-class> with <tool-set>. Context: <context>."
