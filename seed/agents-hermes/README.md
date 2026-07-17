# AlienClaw seed workspaces — Hermes variant

The Hermes-host counterpart of `seed/agents/` (OpenClaw). `install-hermes.sh`
provisions each agent as a Hermes **profile** under
`~/.hermes/profiles/{bossbot,advisorbot,creatorbot}/` (Hermes' multi-agent unit is
the profile — its own home dir — not an `agents/` folder).

The three agents and their behavior are identical to the OpenClaw version — only
the host integration differs. Per-file portability:

| File | Ports from OpenClaw? |
|------|----------------------|
| `SOUL.md` | ~as-is (Hermes loads it natively via `load_soul_md`); paths adapted to `~/.hermes/`. |
| `MEMORY.md` | as-is (Hermes has native memory + SessionDB). |
| `AGENTS.md` | **rewritten** — Hermes has no `AGENTS.md` peer routing and no `delegation` config section. Routing is by **profile description** (`hermes profile create <name> --description "<role>"`) read by Hermes' orchestrator. These files document the intended descriptions. |
| `TOOLS.md` | adapted — Hermes toolset names differ (`hermes tools`). |
| `HEARTBEAT.md` | note only — periodic behavior maps to `~/.hermes/cron/` jobs (Hermes-native cron). |

**Scaffold TODOs (deferred, need a live Hermes):** create the profiles via
`hermes profile create --description` and set the active one with
`hermes profile use bossbot`; author real `~/.hermes/cron/` jobs from
`HEARTBEAT.md`; map `TOOLS.md` names to Hermes toolsets. The AlienClaw hard rule
"BossBot consults AdvisorBot often" is preserved as **prose** in `SOUL.md`
(rule 2) — Hermes ships no config key that enforces consult frequency. See
`bossbot/AGENTS.md` and `docs/hermes-phase2-spec.md`.
