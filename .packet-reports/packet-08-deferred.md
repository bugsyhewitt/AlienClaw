# Packet 8 Deferred

| Item | Deferred to | Rationale |
| --- | --- | --- |
| Caching fitness for unchanged genomes | Packet 8.5+ | Measure first; re-evaluation every gen is bounded and correct for v1.0 |
| Garbage collection of old-generation entries | Packet 8.5+ | Population grows linearly with generations; OK for small N |
| Parent_ids tracking for crossover/mutation children | Packet 8.5+ | Children have empty parent_ids; tracking deferred (not blocking) |
| numpy/scipy migration | Later if measured | stdlib sufficient for population_size ≤ 100, generations ≤ 1000 |
| SQLite backend for population storage | Later if measured | Flat-file is human-inspectable and fast enough for v1.0 |
| Concurrent multi-experiment support | Later if measured | Single-threaded evolution is simpler and correct |
| Roulette-wheel and truncation selection | v1.x experimentation | Stubbed with NotImplementedError; tournament works for v1.0 |
| Larger experiments (population 100+, 1000+ gens) | After perf work | Need garbage collection first |
| Directional fitness pressure on real bridge | Packets 9-10 | Requires LLM-backed execution where genome encodes behavior |
| Second experiment (http_get or other varying fitness) | Future packet | Deferred from Phase 8; neutral evolution result was sufficient |
| leaderboard sync (Population.top() → network upload) | Packet 10 | API is stable; Packet 10 wires the sync |
| Cross-operator genome transfer protocol | Packet 10 | Packet 8 established the local population API it needs |
