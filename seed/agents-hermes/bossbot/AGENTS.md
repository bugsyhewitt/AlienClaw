# Other agents I can call (Hermes delegation)

On Hermes, agent-to-agent routing is NOT expressed with OpenClaw-style `AGENTS.md`
peer entries. It lives in the Hermes **`delegation`** config section
(`~/.hermes/config.yaml`) plus MOA (`hermes_cli/moa_cmd.py`). This file records the
intent that `install-hermes.sh` must encode into that delegation config via
`hermes config set` — it is documentation of the required wiring, not the wiring
mechanism itself.

The AlienClaw hard rule stands on both hosts: **BossBot consults AdvisorBot often.**
It is wired in SOUL.md (behavioral) AND here (routing) — do not drop either.

## AdvisorBot
- **id:** advisorbot
- **workspace:** ~/.hermes/agents/advisorbot/
- **delegation:** high — for any non-trivial reasoning (planning, plan revisions, triage, completion review, campaign design).
- **hermes config (target):** `delegation.peers.advisorbot.frequency = high`

## CreatorBot
- **id:** creatorbot
- **workspace:** ~/.hermes/agents/creatorbot/
- **delegation:** medium — when a task needs a purpose-built Subagent; BossBot delivers the campaign scheme, CreatorBot builds it.
- **hermes config (target):** `delegation.peers.creatorbot.frequency = medium`
