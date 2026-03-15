---
summary: "CLI reference for `alienclaw devices` (device pairing + token rotation/revocation)"
read_when:
  - You are approving device pairing requests
  - You need to rotate or revoke device tokens
title: "devices"
---

# `alienclaw devices`

Manage device pairing requests and device-scoped tokens.

## Commands

### `alienclaw devices list`

List pending pairing requests and paired devices.

```
alienclaw devices list
alienclaw devices list --json
```

### `alienclaw devices remove <deviceId>`

Remove one paired device entry.

```
alienclaw devices remove <deviceId>
alienclaw devices remove <deviceId> --json
```

### `alienclaw devices clear --yes [--pending]`

Clear paired devices in bulk.

```
alienclaw devices clear --yes
alienclaw devices clear --yes --pending
alienclaw devices clear --yes --pending --json
```

### `alienclaw devices approve [requestId] [--latest]`

Approve a pending device pairing request. If `requestId` is omitted, AlienClaw
automatically approves the most recent pending request.

```
alienclaw devices approve
alienclaw devices approve <requestId>
alienclaw devices approve --latest
```

### `alienclaw devices reject <requestId>`

Reject a pending device pairing request.

```
alienclaw devices reject <requestId>
```

### `alienclaw devices rotate --device <id> --role <role> [--scope <scope...>]`

Rotate a device token for a specific role (optionally updating scopes).

```
alienclaw devices rotate --device <deviceId> --role operator --scope operator.read --scope operator.write
```

### `alienclaw devices revoke --device <id> --role <role>`

Revoke a device token for a specific role.

```
alienclaw devices revoke --device <deviceId> --role node
```

## Common options

- `--url <url>`: Gateway WebSocket URL (defaults to `gateway.remote.url` when configured).
- `--token <token>`: Gateway token (if required).
- `--password <password>`: Gateway password (password auth).
- `--timeout <ms>`: RPC timeout.
- `--json`: JSON output (recommended for scripting).

Note: when you set `--url`, the CLI does not fall back to config or environment credentials.
Pass `--token` or `--password` explicitly. Missing explicit credentials is an error.

## Notes

- Token rotation returns a new token (sensitive). Treat it like a secret.
- These commands require `operator.pairing` (or `operator.admin`) scope.
- `devices clear` is intentionally gated by `--yes`.
- If pairing scope is unavailable on local loopback (and no explicit `--url` is passed), list/approve can use a local pairing fallback.
