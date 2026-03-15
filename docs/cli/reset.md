---
summary: "CLI reference for `alienclaw reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `alienclaw reset`

Reset local config/state (keeps the CLI installed).

```bash
alienclaw reset
alienclaw reset --dry-run
alienclaw reset --scope config+creds+sessions --yes --non-interactive
```
