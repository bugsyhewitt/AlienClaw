---
summary: "CLI reference for `alienclaw tui` (terminal UI connected to the Gateway)"
read_when:
  - You want a terminal UI for the Gateway (remote-friendly)
  - You want to pass url/token/session from scripts
title: "tui"
---

# `alienclaw tui`

Open the terminal UI connected to the Gateway.

Related:

- TUI guide: [TUI](/web/tui)

Notes:

- `tui` resolves configured gateway auth SecretRefs for token/password auth when possible (`env`/`file`/`exec` providers).

## Examples

```bash
alienclaw tui
alienclaw tui --url ws://127.0.0.1:18789 --token <token>
alienclaw tui --session main --deliver
```
