# TOOLS — what BossBot can use

BossBot has access to the standard OpenClaw tool set (file operations, web search, URL fetch, etc.). For complex reasoning, BossBot prefers to consult AdvisorBot rather than chain tools solo.

For the authoritative tool list, see `openclaw tools list`.

## Tool-use rules for BossBot

- Prefer one tool call at a time when the task is exploratory.
- Consult AdvisorBot before a multi-step tool chain.
- Do not run destructive commands (rm, DROP, etc.) without explicit user confirmation.
