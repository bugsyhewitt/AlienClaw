# Packet 7 Report — Convergence: Specialists + Real Summon Bridge + Fitness

**Started from:** `a38ec90b` (ci: run governance tests with coverage threshold)
**Completed:** 2026-05-06
**Commits in packet:** 7

---

## Phases completed

| Phase | Deliverable | Commit |
| --- | --- | --- |
| 2 | `docs/specs/SUMMON_BRIDGE_SPEC.md` — JSON-over-stdio bridge, locked v1.0 | `4741b435` |
| 3 | Python fitness module (`src/alienclaw/fitness/`) — 10 tests | `17b9ddeb` |
| 4 | Python bridge server + 8 tool runners (`src/alienclaw/bridge/`) | `a0a3af90` |
| 5 | TypeScript `RealMartianSummonAdapter` + 4 integration tests | `041473e2` |
| 6 | Specialist layer + `random-genome.ts` + updated `creator-bot.ts` | `c1b9cb12` |
| 7 | 25-case bridge fixture + Python runner + TypeScript subprocess runner | `b0649b05` |
| 8 | `docs/LESSONS_FROM_THE_ARC.md` retrospective | `27833661` |

---

## New files

**Python:**
- `src/alienclaw/fitness/__init__.py`, `types.py`, `function.py`
- `src/alienclaw/bridge/__init__.py`, `__main__.py`, `server.py`
- `src/alienclaw/bridge/runners/__init__.py`, `types.py`, `registry.py`
- `src/alienclaw/bridge/runners/compute.py`, `extract_json.py`, `file_read.py`,
  `file_write.py`, `http_get.py`, `search_text.py`, `url_fetch.py`, `web_search.py`
- `test/fitness/test_fitness.py`
- `test/bridge/__init__.py`, `test/bridge/test_bridge_fixture.py`

**TypeScript:**
- `src/alienclaw/governance/real-summon-adapter.ts`
- `src/alienclaw/governance/random-genome.ts`
- `src/alienclaw/governance/specialist.ts`
- `test/governance/real-summon-adapter.test.ts`
- `test/bridge/ts-bridge-fixture.test.ts`

**Spec:**
- `docs/specs/SUMMON_BRIDGE_SPEC.md`
- `test/fixtures/bridge-fixture.json` (25 cases)

**Docs:**
- `docs/LESSONS_FROM_THE_ARC.md`

---

## Test counts added in this packet

| Suite | Tests |
| --- | --- |
| `test/fitness/test_fitness.py` | 10 Python |
| `test/bridge/test_bridge_fixture.py` | 50 Python (125 skipped — by design) |
| `test/governance/real-summon-adapter.test.ts` | 4 TypeScript |
| `test/bridge/ts-bridge-fixture.test.ts` | 75 TypeScript |
| **Total new** | **139** |

---

## Architecture established

### Summon bridge (SUMMON_BRIDGE_SPEC v1.0)
- JSON-over-stdio: TypeScript sends one JSON line to stdin, reads one from stdout
- One `python3 -m alienclaw.bridge` subprocess per summon (stateless)
- Security: non-shell spawn, inputs via JSON only, `ALIENCLAW_PYTHON_BIN` env override
- 8 error codes: `MALFORMED_REQUEST`, `VERSION_MISMATCH`, `INVALID_GENOME`,
  `UNKNOWN_MARTIAN_TYPE`, `TOOL_RUNNER_FAILED`, `PAYLOAD_TOO_LARGE`, `TIMEOUT`, `INTERNAL`
- Timeout: SIGTERM → 5s grace → SIGKILL

### Fitness function
- `fitness = correctness × (1 / max(1, tool_calls))`
- Error → fitness = 0.0 always
- `formula_version = "v1.0"` in every response

### Specialist layer
- `Specialist` wraps a single campaign: holds genome, summons one Martian, erases
- `randomGenome(idTag, seed)` in TypeScript generates valid 256-char Base62 genomes
- `CreatorBot` now uses `Specialist` instead of summoning directly
- Specialists are ephemeral: `erase()` called after campaign completes

---

## Pre-existing failure (not introduced in Packet 7)

`test/rule5-channel-isolation.test.ts` — 1 test failing:
"agentChannel.history() returns messages between agent pairs"

This failure predates Packet 7 (present in commit `209cbc75`). Not investigated
or modified in this packet.
