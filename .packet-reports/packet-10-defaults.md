# Packet 10 — Defaults

## API Server defaults

| Parameter | Default | Env var / flag |
| --- | --- | --- |
| Host | `0.0.0.0` | `--host` |
| Port | `8080` | `--port` |
| Data root | `~/.alienclaw/api-data/` | `ALIENCLAW_API_DATA_ROOT` |
| MSB directory | `seed/msb/` | `--msb-dir` |

## Sync scheduler defaults

| Parameter | Default | Constructor option |
| --- | --- | --- |
| Interval | 5 minutes | `intervalMs` |
| Push top-N per type | 5 | `pushTopN` |
| Pull top-N per type | 10 | `pullTopN` |

## Rate limit defaults

| Parameter | Default |
| --- | --- |
| Submissions per hour | 100 |
| Window | 3600 seconds (rolling) |

## API key defaults

| Parameter | Default |
| --- | --- |
| Key length | 43 chars |
| Alphabet | Base62 (0-9, A-Z, a-z) |
| Machine hash | 64 lowercase hex chars (SHA-256 of machine identifier) |
