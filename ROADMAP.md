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

---

## In flight

- Genome specification lockdown: encoding details, mutation and crossover
  operators, decode procedure, martianbrain file format, Specialist file format,
  leaderboard API contract
- Genome core implementation: Genome class with encode/decode/mutate/crossover,
  round-trip tests
- Martianbrain library: static brain files for initial tool set, registry mapping
  decoded genome sections to tool calls
- Governance scaffolding end-to-end: full BossBot/AdvisorBot/CreatorBot loop
  exercised against a fixed-genome Martian

---

## In Queue (E2 — Live Fitness Drives Population)

Fitness is observed in production but not yet wired back to real selection/promotion
decisions. E2 closes four gaps:
1. Bootstrap wires OnlineFitnessLog into GovernanceLoop (campaign-level recording)
2. Pool pruning keeps population bounded at population_size under live add() calls
3. live_evo.py + scheduled job: when a martian_type accumulates LIVE_EVO_THRESHOLD
   observations, runs evaluate_and_evolve to replace the pool with evolved children
4. Integration test verifying the full live-fitness chain end-to-end
5. live-fitness-summary.json written on each fitness-update tick for briefings

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
