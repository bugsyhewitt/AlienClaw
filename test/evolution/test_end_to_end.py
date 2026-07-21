"""End-to-end test: real bridge + real population — the Packet 8 headline test.

Runs N generations of the 'compute' Martian via the actual Python bridge
(no mock). Validates that:
1. The experiment completes without error.
2. Fitness reports flow from the bridge back into the population.
3. The final population's mean fitness is greater than the initial (0.0).
4. The bridge was actually invoked (population has multiple generations of entries).

The 'compute' Martian with any valid expression reliably returns fitness=1.0
(1 tool call, correctness=1.0). Starting from an uneval population with
fitness=0.0, this trivially satisfies mean(final) > mean(initial=0.0).

The stronger convergence proof (selection pressure improves heritable fitness)
is in test_experiment.py::test_convergence_fitness_improves.
"""
import pytest

from alienclaw.evolution.bridge_runner import make_bridge_runner
from alienclaw.evolution.experiment import run_experiment
from alienclaw.evolution.types import EvolutionConfig


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


@pytest.mark.timeout(120)
def test_evolution_with_real_bridge():
    """Run 5 generations of 'compute' Martian via real bridge.

    Asserts fitness improves from 0.0 (initial) to ≥0.5 (after eval).
    5 generations × 8 Martians = 40 real bridge calls — manageable in CI.
    """
    config = EvolutionConfig(
        martian_type="compute",
        population_size=8,
        seed=42,
    )
    run_martian = make_bridge_runner("compute", inputs={"input": "2 + 2"})

    pop, stats = run_experiment(
        config=config,
        run_martian=run_martian,
        generations=5,
    )

    # Initial state (before any evaluation): all fitness = 0.0
    assert stats[0].mean_fitness == pytest.approx(0.0), \
        f"Initial mean should be 0.0, got {stats[0].mean_fitness}"

    # After evaluation: compute returns 1.0 for all valid expressions
    assert stats[-1].mean_fitness > 0.0, \
        f"Final mean should be > 0.0, got {stats[-1].mean_fitness}"

    # The improvement validates the fitness feedback loop
    assert stats[-1].mean_fitness > stats[0].mean_fitness, (
        f"mean_fitness did not improve: "
        f"initial={stats[0].mean_fitness:.3f}, "
        f"final={stats[-1].mean_fitness:.3f}"
    )

    # Population has entries and correct generation counter
    assert pop.current_generation() == 5
    assert len(pop.all()) > 0

    # Snapshot has the right shape
    snap = pop.snapshot()
    assert snap["martian_type"] == "compute"
    # Correctness is graded by output-contract conformance now, so top_fitness is
    # graded-correctness × efficiency (max 1.0 only for a fully-conformant, efficient
    # genome). A strong genome still emerges — assert a meaningfully high top fitness.
    assert snap["top_fitness"] > 0.5


@pytest.mark.timeout(30)
def test_summon_from_population_bridge_extension():
    """Smoke test: summon-from-population request kind reaches the bridge and returns ok."""
    import json
    import random as rnd

    from alienclaw.bridge.server import handle
    from alienclaw.evolution.population import Population

    # Create a pre-seeded population with one evaluated entry
    from alienclaw.genome.operators import random_genome
    config = EvolutionConfig(martian_type="compute", population_size=2, seed=1)
    pop = Population.create(config)
    # Give one entry a real fitness score
    g = random_genome(rnd.Random(9), "COMPUT01")
    pop.add(genome=g, fitness=0.9, generation=0, parent_ids=(), run_metadata={})

    req = json.dumps({
        "bridge_version": "1.0",
        "request_id": "550e8400-e29b-41d4-a716-999999999999",
        "request": {
            "kind": "summon-from-population",
            "martian_type": "compute",
            "inputs": {"input": "10 + 5"},
            "timeout_ms": 10000,
        },
    }).encode()

    resp = handle(req)
    assert resp["bridge_version"] == "1.0"
    response = resp["response"]
    # Should succeed (compute 10+5 = 15)
    assert response["ok"] is True
    assert "genome_used" in response
    assert len(response["genome_used"]) == 256
    assert response["fitness"] > 0.0
