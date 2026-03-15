---
summary: "CLI reference for `alienclaw agents` (list/add/delete/bindings/bind/unbind/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `alienclaw agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
alienclaw agents list
alienclaw agents add work --workspace ~/.alienclaw/workspace-work
alienclaw agents bindings
alienclaw agents bind --agent work --bind telegram:ops
alienclaw agents unbind --agent work --bind telegram:ops
alienclaw agents set-identity --workspace ~/.alienclaw/workspace --from-identity
alienclaw agents set-identity --agent main --avatar avatars/alienclaw.png
alienclaw agents delete work
```

## Routing bindings

Use routing bindings to pin inbound channel traffic to a specific agent.

List bindings:

```bash
alienclaw agents bindings
alienclaw agents bindings --agent work
alienclaw agents bindings --json
```

Add bindings:

```bash
alienclaw agents bind --agent work --bind telegram:ops --bind discord:guild-a
```

If you omit `accountId` (`--bind <channel>`), AlienClaw resolves it from channel defaults and plugin setup hooks when available.

### Binding scope behavior

- A binding without `accountId` matches the channel default account only.
- `accountId: "*"` is the channel-wide fallback (all accounts) and is less specific than an explicit account binding.
- If the same agent already has a matching channel binding without `accountId`, and you later bind with an explicit or resolved `accountId`, AlienClaw upgrades that existing binding in place instead of adding a duplicate.

Example:

```bash
# initial channel-only binding
alienclaw agents bind --agent work --bind telegram

# later upgrade to account-scoped binding
alienclaw agents bind --agent work --bind telegram:ops
```

After the upgrade, routing for that binding is scoped to `telegram:ops`. If you also want default-account routing, add it explicitly (for example `--bind telegram:default`).

Remove bindings:

```bash
alienclaw agents unbind --agent work --bind telegram:ops
alienclaw agents unbind --agent work --all
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.alienclaw/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
alienclaw agents set-identity --workspace ~/.alienclaw/workspace --from-identity
```

Override fields explicitly:

```bash
alienclaw agents set-identity --agent main --name "AlienClaw" --emoji "🦞" --avatar avatars/alienclaw.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "AlienClaw",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/alienclaw.png",
        },
      },
    ],
  },
}
```
