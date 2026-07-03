"""Tests for EvolutionConfig.selection_strategy dispatch (generation._make_selector)."""
import random

import pytest

from alienclaw.evolution.generation import _make_selector
from alienclaw.evolution.population import Population
from alienclaw.evolution.selection import tournament
from alienclaw.evolution.storage import _config_from_dict, _config_to_dict
from alienclaw.evolution.types import EvolutionConfig


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def _make_pop_with_fitness(fitnesses: list[float]) -> Population:
    from alienclaw.genome.operators import random_genome
    config = EvolutionConfig(martian_type="compute", population_size=len(fitnesses), seed=7)
    pop = Population.create(config)
    rng = random.Random(99)
    entries = []
    for f in fitnesses:
        g = random_genome(rng, "COMPUT01")
        e = pop.add(genome=g, fitness=f, generation=0, parent_ids=(), run_metadata={})
        entries.append(e)
    pop.replace_pool(entries)
    return pop


class TestMakeSelector:
    def test_default_strategy_matches_tournament_exactly(self):
        pop = _make_pop_with_fitness([0.1, 0.3, 0.7, 0.9])
        config = EvolutionConfig(martian_type="compute")
        select = _make_selector(config)
        picks_via_selector = [select(pop, random.Random(11)).entry_id for _ in range(10)]
        picks_via_tournament = [
            tournament(pop, config.tournament_k, random.Random(11)).entry_id for _ in range(10)
        ]
        assert picks_via_selector == picks_via_tournament

    def test_roulette_strategy_is_fitness_proportionate(self):
        pop = _make_pop_with_fitness([0.0, 0.5])
        select = _make_selector(EvolutionConfig(martian_type="compute", selection_strategy="roulette_wheel"))
        rng = random.Random(42)
        for _ in range(25):
            assert select(pop, rng).fitness == pytest.approx(0.5)

    def test_truncation_strategy_uses_configured_fraction(self):
        pop = _make_pop_with_fitness([0.1, 0.2, 0.3, 0.4, 0.9])
        select = _make_selector(EvolutionConfig(
            martian_type="compute",
            selection_strategy="truncation",
            truncation_top_fraction=0.2,  # ceil(5 * 0.2) = 1 -> only the best
        ))
        rng = random.Random(42)
        for _ in range(20):
            assert select(pop, rng).fitness == pytest.approx(0.9)

    def test_unknown_strategy_raises(self):
        with pytest.raises(ValueError, match="Unknown selection_strategy 'darwin_roulette'"):
            _make_selector(EvolutionConfig(martian_type="compute", selection_strategy="darwin_roulette"))


class TestConfigPersistenceRoundTrip:
    def test_new_fields_round_trip(self):
        config = EvolutionConfig(
            martian_type="compute",
            selection_strategy="truncation",
            truncation_top_fraction=0.25,
        )
        loaded = _config_from_dict(_config_to_dict(config))
        assert loaded.selection_strategy == "truncation"
        assert loaded.truncation_top_fraction == 0.25

    def test_legacy_metadata_defaults_to_tournament(self):
        legacy = {"martian_type": "compute"}  # pre-knob metadata.json shape
        loaded = _config_from_dict(legacy)
        assert loaded.selection_strategy == "tournament"
        assert loaded.truncation_top_fraction == 0.5
