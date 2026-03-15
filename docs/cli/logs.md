---
summary: "CLI reference for `alienclaw logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `alienclaw logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
alienclaw logs
alienclaw logs --follow
alienclaw logs --json
alienclaw logs --limit 500
alienclaw logs --local-time
alienclaw logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.
