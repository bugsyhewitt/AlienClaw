# AlienClaw seed workspaces — Hermes variant

The Hermes-host counterpart of `seed/agents/` (OpenClaw). Provisioned by
`install-hermes.sh` into `~/.hermes/agents/{bossbot,advisorbot,creatorbot}/`.

The three agents and their behavior are identical to the OpenClaw version — only
the host integration differs. Per-file portability:

| File | Ports from OpenClaw? |
|------|----------------------|
| `SOUL.md` | ~as-is (Hermes loads it natively via `load_soul_md`); paths adapted to `~/.hermes/`. |
| `MEMORY.md` | as-is (Hermes has native memory + SessionDB). |
| `AGENTS.md` | **rewritten** — Hermes routing is the `delegation` config section + MOA, not OpenClaw AGENTS.md entries. These files document the delegation intent `install-hermes.sh` sets via `hermes config set`. |
| `TOOLS.md` | adapted — Hermes toolset names differ (`hermes tools`). |
| `HEARTBEAT.md` | note only — periodic behavior maps to `~/.hermes/cron/` jobs (Hermes-native cron). |

**Scaffold TODOs (deferred to the live-wiring phase):** encode the delegation
config from each `AGENTS.md`; author real `~/.hermes/cron/` jobs from
`HEARTBEAT.md`; map `TOOLS.md` names to Hermes toolsets. The AlienClaw hard rule
"BossBot consults AdvisorBot often" must be preserved in the Hermes delegation
config — see `bossbot/AGENTS.md`.
