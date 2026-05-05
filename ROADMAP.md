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

## Next

- Specialist + Martian spawning + fitness evaluation loop
- Local evolution loop: generational selection, mutation, crossover, fitness
  improvement across N generations on a fixed simple goal
- alienclaw.net rebuild: project description, environmental thesis, GitHub link,
  donate button, leaderboard placeholder
- api.alienclaw.net provisioning: REST API for genome submission and top-genome
  fetch, per-install API keys, server-side validation, CreatorBot 3-4 day sync
  logic, public docs, open-source server

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
