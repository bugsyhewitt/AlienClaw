# Roadmap

What is done, in flight, and next. Updated as work lands.

Legend:

- Done — landed in main, tested
- In flight — active work, may be incomplete in main
- Next — on the queue, scope-locked, not started
- Future — explicitly not near-term; may change as the project learns

---

## Done

- Core architecture (src/alienclaw/): three fixed agents with enforced
  communication graph, 256-char Base62 genome codec, Martian registry skeleton,
  governance state machine, AgentChannel isolation (Rule 5)
- Repo cleanup: OpenClaw vendor residue removed (skills/, docs/, CHANGELOG.md,
  broken workflows), CI rebuilt for AlienClaw's actual structure (TypeScript +
  Python + Shell + install smoke)
- Load-bearing docs aligned to canonical architecture (README, VISION, ROADMAP)
- Install path: npm install -g openclaw + bash install.sh verified clean
- Meeseeks to Martian rename complete across codebase and docs
- api.alienclaw.net provisioning: Deployed in Packet 35 — submission endpoint live, MySQL persisting, server-side validation active.
- Local evolution loop: run_experiment() runs N generations with tournament
  selection, mutation, crossover, and bridge-computed fitness (validated
  end-to-end in test/evolution/test_end_to_end.py). Roulette-wheel and
  truncation selection implemented for v1.x experimentation (2026-07-02).
- MSB OUTPUT CONTRACT alignment across all 8 tools — Python implementations
  and the TS adapter layer — each with direct unit tests (packets 108-124,
  landed 2026-07-02).
- Subagent build entry point: CreatorBot.buildSubagent with strict
  domain→martian_type resolution and population-backed summons
  (fromPopulation), replacing silent 'compute' defaults (2026-07-02).
- Genome specification lockdown: encoding, operators, decode procedure, and the
  companion file-format/API contracts are written and locked
  (`docs/specs/GENOME_SPEC.md`, `MARTIANBRAIN_SPEC.md`, `SUBAGENT_SPEC.md` +
  v1.3/v1.4 addenda, `LEADERBOARD_API_SPEC.md`, `SUMMON_BRIDGE_SPEC.md`).
- Genome core implementation: encode/decode/mutate/crossover live in
  `src/alienclaw/genome/{codec,operators}.py` (`GENOME_LENGTH = 256`), with
  round-trip and operator coverage in `test/genome/` (test_codec, test_operators,
  test_fixtures, plus the cross-language ts-fixture-runner).
- Martianbrain library: 8 static brain files in `seed/msb/` mapped through
  `BrainRegistry.load()` (`src/alienclaw/brains/registry.py`).
- Governance scaffolding end-to-end: full BossBot/AdvisorBot/CreatorBot loop
  exercised headlessly in `test/integration/governance-live-fitness.test.ts`
  against the real summon adapter and a seeded population.
- E2 — Live Fitness Drives Population (verified complete 2026-09-03). All five
  items landed and covered by tests:
  1. `OnlineFitnessLog` wired into `GovernanceLoop` —
     `src/alienclaw/wiring/hierarchy-bootstrap.ts:100,115`
     (test `test/wiring/hierarchy-bootstrap-online-fitness.test.ts`, HB-101)
  2. Population pool capped at `population_size` —
     `src/alienclaw/bridge/server.py:373-375`
     (test `test/bridge/test_server_direct.py:549`)
  3. `live_evo.py` + threshold-gated scheduled job — `LIVE_EVO_THRESHOLD = 10` in
     `src/alienclaw/evolution/live_evo.py:16`; `live-evo-check` job registered at
     `hierarchy-bootstrap.ts:409-417`
  4. Live-fitness integration test —
     `test/integration/governance-live-fitness.test.ts:140-241`
  5. `live-fitness-summary.json` written each `fitness-update` tick —
     `hierarchy-bootstrap.ts:248-258`, path at `constants.ts:90`
     (test `test/wiring/fitness-update-summary.test.ts`)

---

## In flight

- Nothing currently in flight. The E2 epic closed 2026-09-03; the next scoped
  item is under "Next" below.

---

## Next

- alienclaw.net donate button: the live Next.js site (alienclaw-site repo)
  already covers description, GitHub link, docs, and leaderboard; donate
  needs a sponsorship destination decision first. The in-repo site/ is
  retired behind a deploy guard (scripts/deploy.sh).

---

## Future (not near-term)

These are explicitly future-scope. Not being built now. Documented so
contributors can see where the project might go.

- Specialist evolution: longer genomes (512+ char) for the broader
  campaign-scale search space. End-game - requires proving the Martian loop first.
- Leaderboard UI: domain-specific rankings, human-curated sets,
  operator-trust weights.
- Ecosystem merge: if the genome evolution mechanism proves itself, AlienClaw
  may merge into a larger agent ecosystem or attract acquisition interest.
