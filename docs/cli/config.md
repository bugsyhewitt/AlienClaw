---
summary: "CLI reference for `alienclaw config` (get/set/unset/file/validate)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `alienclaw config`

Config helpers: get/set/unset/validate values by path and print the active
config file. Run without a subcommand to open
the configure wizard (same as `alienclaw configure`).

## Examples

```bash
alienclaw config file
alienclaw config get browser.executablePath
alienclaw config set browser.executablePath "/usr/bin/google-chrome"
alienclaw config set agents.defaults.heartbeat.every "2h"
alienclaw config set agents.list[0].tools.exec.node "node-id-or-name"
alienclaw config unset tools.web.search.apiKey
alienclaw config validate
alienclaw config validate --json
```

## Paths

Paths use dot or bracket notation:

```bash
alienclaw config get agents.defaults.workspace
alienclaw config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
alienclaw config get agents.list
alienclaw config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--strict-json` to require JSON5 parsing. `--json` remains supported as a legacy alias.

```bash
alienclaw config set agents.defaults.heartbeat.every "0m"
alienclaw config set gateway.port 19001 --strict-json
alienclaw config set channels.whatsapp.groups '["*"]' --strict-json
```

## Subcommands

- `config file`: Print the active config file path (resolved from `ALIENCLAW_CONFIG_PATH` or default location).

Restart the gateway after edits.

## Validate

Validate the current config against the active schema without starting the
gateway.

```bash
alienclaw config validate
alienclaw config validate --json
```
