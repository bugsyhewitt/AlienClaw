# Packet 8 Experiment Results

**Date:** 2026-05-06  
**Experiment:** 50-generation evolution run on `compute` Martian type  
**Command:**
```bash
PYTHONPATH=src python -m alienclaw.evolution run-experiment \
  --martian-type compute --generations 50 --population-size 16 --seed 42 \
  --inputs '{"input": "7 + 35"}'
```

---

## Configuration

| Parameter | Value |
| --- | --- |
| martian_type | `compute` |
| population_size | 16 |
| generations | 50 |
| tournament_k | 3 (default) |
| mutation_rate | 1/256 (default) |
| crossover_rate | 0.5 (default) |
| elitism_count | 2 (default) |
| seed | 42 |
| inputs | `{"input": "7 + 35"}` |

---

## Fitness curve (all 50 generations)

All evaluations returned fitness=1.0 (mean, max, min, stddev=0.0).

```
generation  mean   max    min    distinct_genomes
---------   -----  -----  -----  ----------------
0           1.000  1.000  1.000  16
1           1.000  1.000  1.000  15
2           1.000  1.000  1.000  15
...
48          1.000  1.000  1.000  11
49          1.000  1.000  1.000  14
```

**Final population state (from stderr):**
`generation=50, top_fitness=1.0000, mean_fitness=0.1250`

Note: the CLI prints final `mean_fitness=0.125` because the final pool after
generation 50 contains 2 elite entries (fitness=1.0) + 14 unevaluated children
(fitness=0.0), so 2/16 × 1.0 = 0.125. This is correct — the next generation
step would evaluate the children and restore mean to 1.0.

---

## Distinct genomes over time

| Generation range | distinct_genomes |
| --- | --- |
| 0-9 | 12-16 |
| 10-19 | 10-15 |
| 20-29 | 10-15 |
| 30-39 | 10-16 |
| 40-49 | 11-16 |

Genetic diversity is maintained across all 50 generations. Mutation (rate=1/256)
and crossover (rate=0.5) continuously introduce new genomes while elitism (2)
preserves successful ones.

---

## Observations

**Fitness behavior.** The `compute` Martian with a fixed arithmetic expression
("7 + 35") achieves fitness=1.0 on every evaluation. This is expected: any valid
genome reaches the compute runner, which evaluates the expression deterministically,
returns correctness=1.0 with 1 tool call, giving fitness = 1.0 × 1/1 = 1.0.

**Neutral evolution.** With all genomes achieving equal fitness, this experiment
demonstrates **neutral evolution** — the Martian population evolves via mutation
and crossover but without directional fitness pressure. It's equivalent to genetic
drift: genome sequences change, but no genome sequence is selected for.

**What does improve.** The infrastructure: 50 generations × 16 Martians = 800
real bridge calls completed without error in ~0.5 seconds. The population storage
accumulated 800+ entries across `~/.alienclaw/populations/compute/entries/`. The
generation counter incremented from 0 to 50 correctly. The CLI output was structured
JSONL readable by downstream tooling.

**Why fitness doesn't improve in this experiment.** The `compute` Martian's fitness
is determined by whether the expression evaluates cleanly (always yes for "7 + 35")
and by tool_calls (always 1). Genome content doesn't affect runner behavior in
Packet 8 — genomes encode PARAMETERS for LLM-backed reasoning, which Packets 9-10
wire in. In v1.0 these runners are deterministic Python functions; selection
pressure only appears when runner behavior varies by genome content.

**Where fitness does improve.** The unit test `test_convergence_fitness_improves`
uses a mock runner where fitness = count('0123' in genome[8:64]) / 56.0 — a
heritable trait. With population_size=16, seed=42, 20 generations:
- Initial mean fitness: 0.0 (uneval)
- After gen 0 evaluation: ~0.065 (random baseline from 4/62 target char probability)
- After gen 20: mean fitness improves (tournament selection propagates '0123'-rich
  IDENTITY sections via crossover)

This mock test is the evidence that the selection mechanism works correctly.

---

## Narrative

This is the first AlienClaw experiment run: 50 generations of a Martian population,
fully managed by the local evolution loop built in Packet 8. The infrastructure
works — population creation, genome generation, fitness evaluation via the bridge,
fitness persistence, generational selection, mutation, crossover, elitism, and
statistics all function correctly at scale.

The compute experiment demonstrates neutral evolution (all genomes equally fit
for a fixed arithmetic task). This is the expected and correct behavior for v1.0
tools with deterministic Python runners. Directional fitness pressure appears when:
1. Tools have varying success rates (http_get, web_search, file_read — network/disk
   failures introduce non-unit fitness)
2. LLM-backed execution varies by genome-encoded parameters (Packets 9-10)
3. Tasks are open-ended enough that genome-encoded behavior affects quality

The leaderboard network (Packet 10) aggregates fitness data across operators,
creating cross-operator selection pressure toward globally-efficient genomes —
the environmental thesis at scale.

---

## Cleanup

```bash
rm -rf ~/.alienclaw/populations/
```

Executed after the experiment. No leak directories remain.
