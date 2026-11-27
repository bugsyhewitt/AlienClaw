"""Contract: every name the three tuners import from the engine exists, has the
expected shape, and a tiny GA run works end to end.

The tuners (mangle_tuner, ouija_tuner, pho3nix_tuner) import from ``alienclaw.*``
today; once they depend on this package the same names come from
``alienclaw_ga.*``. TUNER_API below is the frozen list; test_tuner_sources_match
re-derives it from the tuner sources when they sit next to this staging folder,
so a tuner that starts importing something new fails here first.
"""
from __future__ import annotations

import ast
import dataclasses
import importlib
import inspect
import random
from pathlib import Path

import pytest

# module (relative to the package root) -> {name: expected kind}
TUNER_API: dict[str, dict[str, str]] = {
    "evolution.generation": {"evaluate_and_evolve": "function", "FitnessReport": "dataclass"},
    "evolution.population": {"Population": "class"},
    "evolution.types": {"EvolutionConfig": "dataclass"},
    "genome.alphabet": {"ALPHABET": "str", "SECTION_LENGTH": "int"},
    "genome.checksum": {"compute_checksum": "function"},
    "genome.codec": {
        "decode_xcode": "function",
        "encode_xcode": "function",
        "param_value_to_xcode": "function",
        "round_trip_check": "function",
        "xcode_to_param_value": "function",
    },
    "genome.operators": {"random_genome": "function"},
}

# Positional parameter names the tuners rely on (they call these positionally).
SIGNATURES: dict[tuple[str, str], list[str]] = {
    ("evolution.generation", "evaluate_and_evolve"): ["pop", "config", "run_martian", "rng"],
    ("genome.checksum", "compute_checksum"): ["sections012"],
    ("genome.codec", "decode_xcode"): ["genome", "slot_index", "xcode_index"],
    ("genome.codec", "encode_xcode"): ["value"],
    ("genome.codec", "param_value_to_xcode"): ["param_value", "range_min", "range_max"],
    ("genome.codec", "round_trip_check"): ["genome"],
    ("genome.codec", "xcode_to_param_value"): ["xcode_value", "range_min", "range_max"],
    ("genome.operators", "random_genome"): ["rng", "id_tag", "namespace"],
}

# EvolutionConfig keywords the tuners pass.
CONFIG_FIELDS = {
    "martian_type", "population_size", "tournament_k", "mutation_rate", "crossover_rate",
    "elitism_count", "seed", "selection_strategy",
}

TUNERS = ("mangle_tuner", "ouija_tuner", "pho3nix_tuner")
_REPO = Path(__file__).resolve().parents[3]  # <repo>/staging/ga-engine/tests -> <repo>


def _resolve(module: str, name: str):
    return getattr(importlib.import_module(f"alienclaw_ga.{module}"), name)


@pytest.mark.parametrize(
    ("module", "name", "kind"),
    [(m, n, k) for m, names in TUNER_API.items() for n, k in names.items()],
)
def test_tuner_name_exists_with_expected_shape(module: str, name: str, kind: str) -> None:
    obj = _resolve(module, name)
    if kind == "function":
        assert inspect.isfunction(obj), f"{module}.{name} should be a function"
    elif kind == "class":
        assert inspect.isclass(obj)
    elif kind == "dataclass":
        assert inspect.isclass(obj) and dataclasses.is_dataclass(obj)
    elif kind == "str":
        assert isinstance(obj, str)
    elif kind == "int":
        assert isinstance(obj, int) and not isinstance(obj, bool)
    else:  # pragma: no cover - table typo guard
        raise AssertionError(f"unknown kind {kind!r}")


@pytest.mark.parametrize(("key", "params"), list(SIGNATURES.items()))
def test_tuner_function_signatures(key: tuple[str, str], params: list[str]) -> None:
    sig = inspect.signature(_resolve(*key))
    assert list(sig.parameters)[: len(params)] == params


def test_alphabet_and_section_constants() -> None:
    from alienclaw_ga.genome.alphabet import ALPHABET, SECTION_LENGTH

    assert len(ALPHABET) == 62 and len(set(ALPHABET)) == 62
    assert SECTION_LENGTH == 64


def test_fitness_report_and_config_shape() -> None:
    from alienclaw_ga.evolution.generation import FitnessReport
    from alienclaw_ga.evolution.types import EvolutionConfig

    report = FitnessReport(fitness=0.5)
    assert report.fitness == 0.5 and report.run_metadata == {}
    fields = {f.name for f in dataclasses.fields(EvolutionConfig)}
    assert CONFIG_FIELDS <= fields
    assert EvolutionConfig.__dataclass_params__.frozen  # type: ignore[attr-defined]


def test_population_api_used_by_tuners() -> None:
    from alienclaw_ga.evolution.population import Population

    assert isinstance(inspect.getattr_static(Population, "create"), classmethod)
    assert callable(getattr(Population, "all"))


def _tuner_imports() -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for tuner in TUNERS:
        for path in (_REPO / tuner).rglob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if isinstance(node, ast.ImportFrom) and node.module and (
                    node.module == "alienclaw" or node.module.startswith("alienclaw.")
                ):
                    mod = node.module.removeprefix("alienclaw").lstrip(".")
                    found.setdefault(mod, set()).update(a.name for a in node.names)
    return found


@pytest.mark.skipif(
    not all((_REPO / t).is_dir() for t in TUNERS),
    reason="tuner sources not alongside this staging folder",
)
def test_tuner_sources_match_contract() -> None:
    found = _tuner_imports()
    assert found, "expected the tuners to import the engine"
    expected = {m: set(names) for m, names in TUNER_API.items()}
    assert found == expected


def _xcode_fitness(genome: str) -> float:
    """Tuner-style fitness: decode one EXECUTION-slot Xcode into [0, 1]."""
    from alienclaw_ga.genome.codec import decode_xcode, xcode_to_param_value

    return xcode_to_param_value(decode_xcode(genome, 1, 0), 0, 100) / 100.0


def test_tiny_ga_run_two_generations(tmp_path, monkeypatch) -> None:
    from alienclaw_ga.evolution.generation import FitnessReport, evaluate_and_evolve
    from alienclaw_ga.evolution.population import Population
    from alienclaw_ga.evolution.types import EvolutionConfig
    from alienclaw_ga.genome.codec import round_trip_check

    root = tmp_path / "pops"
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(root))
    calls: list[str] = []

    def fitness(martian_type: str, genome: str) -> FitnessReport:
        calls.append(genome)
        return FitnessReport(fitness=_xcode_fitness(genome), run_metadata={"stub": True})

    config = EvolutionConfig(
        martian_type="contract_tuner", population_size=6, tournament_k=3,
        mutation_rate=1.0 / 256.0, crossover_rate=0.5, elitism_count=2, seed=7,
        selection_strategy="tournament",
    )
    pop = Population.create(config)
    assert len(pop.all()) == 6
    rng = random.Random(7)
    results = [evaluate_and_evolve(pop, config, fitness, rng) for _ in range(2)]

    assert [r["generation"] for r in results] == [0, 1]
    assert pop.current_generation() == 2
    assert len(calls) == 12  # every pool member evaluated each generation
    pool = pop.all()
    assert len(pool) == 6
    assert all(len(e.genome) == 256 and round_trip_check(e.genome) for e in pool)
    for r in results:
        assert 0.0 <= r["stats"].min_fitness <= r["stats"].max_fitness <= 1.0
        assert r["children_minted"] == 4
    # Elites carry their evaluated fitness forward; it matches the stub.
    elites = [e for e in pool if e.run_metadata.get("re_evaluated")]
    assert len(elites) == config.elitism_count
    for e in elites:
        assert e.fitness == pytest.approx(_xcode_fitness(e.genome))
        assert e.run_metadata["stub"] is True
    assert (root / "contract_tuner").is_dir()


def test_tuner_style_genome_patch_round_trips() -> None:
    """Mirrors the tuners' genome_schema encode path: patch Xcodes, re-checksum."""
    from alienclaw_ga.genome.checksum import compute_checksum
    from alienclaw_ga.genome.codec import (
        decode_xcode,
        encode_xcode,
        param_value_to_xcode,
        round_trip_check,
        xcode_to_param_value,
    )
    from alienclaw_ga.genome.operators import random_genome

    chars = list(random_genome(random.Random(3), "TUNER001", "StagingNS1")[:192])
    xcode = param_value_to_xcode(42, 1, 64)
    enc = encode_xcode(xcode)
    base = 1 * 64 + 1 + 2 * 2  # slot 1, xcode index 2
    chars[base], chars[base + 1] = enc[0], enc[1]
    body = "".join(chars)
    genome = body + compute_checksum(body)
    assert round_trip_check(genome)
    assert xcode_to_param_value(decode_xcode(genome, 1, 2), 1, 64) == 42
