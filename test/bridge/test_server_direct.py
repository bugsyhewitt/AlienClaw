"""Direct unit tests for the in-process bridge server (alienclaw/bridge/server.py).

test_bridge_fixture.py runs the shared JSON fixture cases against handle();
test_martian_dispatch.py covers multi-slot dispatch. This file unit-tests the
handle() entry point directly: envelope parsing, the error contract (structured
error responses, never exceptions), summon validation order, and the success
response contract (fitness in [0, 1], run_metadata keys, echo fields).

All requests use the real registries (seed/msb/, seed/martians/) and real
genomes built with a seeded RNG — fully deterministic, no network.
"""
from __future__ import annotations

import json
import random
from typing import Any

import pytest

from alienclaw.bridge.server import handle
from alienclaw.genome.operators import random_genome


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    """Defensive isolation: summon-from-population would touch the populations root."""
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def _genome(seed: int = 42) -> str:
    return random_genome(random.Random(seed), "COMPUT01")


def _envelope(
    martian_type: str = "compute",
    inputs: Any = None,
    genome: str | None = None,
    request_id: str = "req-direct-1",
    **request_overrides: Any,
) -> bytes:
    req: dict[str, Any] = {
        "kind": "summon",
        "genome": genome if genome is not None else _genome(),
        "martian_type": martian_type,
        "inputs": {"input": "2 + 2"} if inputs is None else inputs,
        "timeout_ms": 30000,
    }
    req.update(request_overrides)
    return json.dumps({
        "bridge_version": "1.0",
        "request_id": request_id,
        "request": req,
    }).encode()


class TestSummonSuccess:
    def test_valid_summon_round_trips_with_full_success_contract(self):
        resp = handle(_envelope())
        assert resp["bridge_version"] == "1.0"
        assert resp["request_id"] == "req-direct-1"
        response = resp["response"]
        assert response["ok"] is True, response.get("error")
        assert response["output"]["result"] == 4
        assert 0.0 <= response["fitness"] <= 1.0
        assert response["fitness"] > 0.0
        meta = response["run_metadata"]
        for key in (
            "tool_calls", "wall_clock_ms", "correctness", "efficiency",
            "fitness_formula_version",
        ):
            assert key in meta, f"missing run_metadata key: {key}"
        assert isinstance(meta["tool_calls"], int) and meta["tool_calls"] >= 1
        assert isinstance(meta["wall_clock_ms"], int) and meta["wall_clock_ms"] >= 0
        assert meta["correctness"] == pytest.approx(1.0)
        assert meta["fitness_formula_version"] == "v2.0"

    def test_summon_deterministic_for_fixed_genome(self):
        first = handle(_envelope())["response"]
        second = handle(_envelope())["response"]
        assert first["ok"] is True and second["ok"] is True
        assert first["fitness"] == second["fitness"]
        assert first["run_metadata"]["tool_calls"] == second["run_metadata"]["tool_calls"]
        assert first["output"] == second["output"]

    def test_alias_and_canonical_martian_agree(self):
        """'compute' is a registry alias for 'compute_alone' — identical dispatch."""
        g = _genome(7)
        via_alias = handle(_envelope(martian_type="compute", genome=g))["response"]
        via_canonical = handle(_envelope(martian_type="compute_alone", genome=g))["response"]
        assert via_alias["ok"] is True and via_canonical["ok"] is True
        assert via_alias["fitness"] == via_canonical["fitness"]
        assert via_alias["output"] == via_canonical["output"]


class TestEnvelopeErrors:
    def test_payload_too_large(self):
        resp = handle(b"x" * 1_048_577)
        assert resp["request_id"] is None
        err = resp["response"]["error"]
        assert err["code"] == "PAYLOAD_TOO_LARGE"
        assert err["details"]["received_bytes"] == 1_048_577

    def test_invalid_json_is_structured_error(self):
        resp = handle(b"{not json at all")
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert "parse_error" in err["details"]

    @pytest.mark.parametrize("payload", [b"[1, 2]", b'"just a string"'])
    def test_non_object_envelope_rejected(self, payload):
        resp = handle(payload)
        assert resp["response"]["error"]["code"] == "MALFORMED_REQUEST"

    def test_version_mismatch_echoes_request_id_and_supported(self):
        raw = json.dumps({
            "bridge_version": "9.9",
            "request_id": "req-version",
            "request": {},
        }).encode()
        resp = handle(raw)
        assert resp["request_id"] == "req-version"
        err = resp["response"]["error"]
        assert err["code"] == "VERSION_MISMATCH"
        assert err["details"] == {"received": "9.9", "supported": ["1.0"]}

    @pytest.mark.parametrize("request_value", [None, "summon", 5, [1]])
    def test_missing_or_non_object_request_field(self, request_value):
        envelope: dict[str, Any] = {"bridge_version": "1.0", "request_id": "r"}
        if request_value is not None:
            envelope["request"] = request_value
        resp = handle(json.dumps(envelope).encode())
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert err["details"]["missing_fields"] == ["request"]

    def test_missing_required_summon_fields_are_listed(self):
        raw = json.dumps({
            "bridge_version": "1.0",
            "request_id": "r",
            "request": {"kind": "summon", "martian_type": "compute", "inputs": {}},
        }).encode()
        resp = handle(raw)
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert err["details"]["missing_fields"] == ["genome", "timeout_ms"]

    def test_unknown_kind_rejected(self):
        resp = handle(_envelope(kind="conjure"))
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert "summon" in err["message"]

    def test_error_responses_are_structured_never_raised(self):
        """Every malformed shape returns the full error response contract."""
        payloads = [
            b"{broken",
            b"[]",
            json.dumps({"bridge_version": "0.1", "request_id": "x", "request": {}}).encode(),
            json.dumps({"bridge_version": "1.0", "request_id": "x"}).encode(),
            _envelope(kind="bogus"),
            _envelope(genome="short"),
            _envelope(martian_type="no_such_martian"),
            _envelope(timeout_ms=-1),
            _envelope(inputs="not a dict"),
        ]
        for raw in payloads:
            resp = handle(raw)  # must not raise
            response = resp["response"]
            assert response["ok"] is False
            assert response["fitness"] == 0.0
            err = response["error"]
            assert isinstance(err["code"], str) and err["code"]
            assert isinstance(err["message"], str)
            assert isinstance(err["details"], dict)
            meta = response["run_metadata"]
            assert isinstance(meta["tool_calls"], int)
            assert isinstance(meta["wall_clock_ms"], int)


class TestSummonValidation:
    @pytest.mark.parametrize("bad_genome,expected_snippet", [
        ("", None),
        ("abc", None),
        ("A" * 255, None),
        ("!" * 256, None),
        ("A" * 256, "Checksum mismatch"),  # right length/alphabet, wrong checksum
    ])
    def test_invalid_genome_rejected(self, bad_genome, expected_snippet):
        resp = handle(_envelope(genome=bad_genome))
        err = resp["response"]["error"]
        assert err["code"] == "INVALID_GENOME"
        assert err["details"]["errors"], "expected non-empty validation errors"
        if expected_snippet is not None:
            assert expected_snippet in err["message"]

    def test_unknown_martian_type_lists_available(self):
        resp = handle(_envelope(martian_type="definitely_not_registered"))
        err = resp["response"]["error"]
        assert err["code"] == "UNKNOWN_MARTIAN_TYPE"
        available = err["details"]["available"]
        assert available == sorted(available)
        assert "compute_alone" in available

    @pytest.mark.parametrize("bad_timeout", [0, 600_001, "5000", None])
    def test_timeout_ms_must_be_int_in_range(self, bad_timeout):
        resp = handle(_envelope(timeout_ms=bad_timeout))
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert "timeout_ms" in err["message"]

    def test_tool_failure_is_structured_with_slot_index(self):
        resp = handle(_envelope(inputs={"input": "this is not math"}))
        response = resp["response"]
        assert response["ok"] is False
        assert response["fitness"] == 0.0
        err = response["error"]
        assert err["code"] == "TOOL_RUNNER_FAILED"
        assert err["details"]["slot_index"] == 0

    def test_tool_exception_is_structured_never_crashes(self, monkeypatch):
        """L130-132: if a tool function raises, bridge returns structured TOOL_RUNNER_FAILED."""
        from alienclaw.tools import TOOL_REGISTRY

        def raising_tool(inputs, params):
            raise RuntimeError("tool internal crash")

        monkeypatch.setitem(TOOL_REGISTRY, "compute", raising_tool)
        resp = handle(_envelope(martian_type="compute_alone", inputs={"input": "2 + 2"}))
        err = resp["response"]["error"]
        assert err["code"] == "TOOL_RUNNER_FAILED"
        assert "runner raised exception" in err["message"]
        assert "tool internal crash" in err["message"]
        assert err["details"]["slot_index"] == 0


class TestLiveEvoHandler:
    """Tests for kind='live-evo' bridge handler (E2 item 3)."""

    @staticmethod
    def _live_evo(request: dict) -> dict:
        import json
        request["kind"] = "live-evo"
        return handle(json.dumps({
            "bridge_version": "1.0",
            "request_id": "r-live-evo",
            "request": request,
        }).encode())

    def test_missing_martian_type_returns_malformed(self) -> None:
        resp = self._live_evo({})
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert "martian_type" in err["details"]["missing_fields"]

    def test_below_threshold_returns_evolved_false(
        self, tmp_path, monkeypatch
    ) -> None:
        from alienclaw.evolution.live_evo import LIVE_EVO_THRESHOLD
        import alienclaw.evolution.live_evo as le_mod

        monkeypatch.setattr(
            le_mod, "check_and_evolve",
            lambda mt, th, **kw: None,
        )
        resp = self._live_evo({"martian_type": "compute"})
        r = resp["response"]
        assert r["ok"] is True
        assert r["evolved"] is False
        assert r["reason"] == "below_threshold"

    def test_above_threshold_returns_evolved_true(
        self, tmp_path, monkeypatch
    ) -> None:
        import alienclaw.evolution.live_evo as le_mod

        monkeypatch.setattr(
            le_mod, "check_and_evolve",
            lambda mt, th, **kw: {
                "generation": 0, "next_generation": 1,
                "children_minted": 28, "new_observations": 12,
            },
        )
        resp = self._live_evo({"martian_type": "compute"})
        r = resp["response"]
        assert r["ok"] is True
        assert r["evolved"] is True
        assert r["generation"] == 0
        assert r["next_generation"] == 1
        assert r["children_minted"] == 28

    def test_live_evo_internal_error_returns_structured(self, monkeypatch) -> None:
        import alienclaw.evolution.live_evo as le_mod

        def _boom(mt, th, **kw):
            raise RuntimeError("disk full")

        monkeypatch.setattr(le_mod, "check_and_evolve", _boom)
        resp = self._live_evo({"martian_type": "compute"})
        err = resp["response"]["error"]
        assert err["code"] == "INTERNAL"
        assert "disk full" in err["details"]["exception"]


class TestSummonFromPopulationShape:
    @staticmethod
    def _sfp(request: dict[str, Any]) -> dict:
        request["kind"] = "summon-from-population"
        return handle(json.dumps({
            "bridge_version": "1.0",
            "request_id": "r",
            "request": request,
        }).encode())

    def test_missing_field_reported(self):
        resp = self._sfp({"martian_type": "compute", "inputs": {}})
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert err["details"]["missing_fields"] == ["timeout_ms"]

    def test_unknown_martian_type(self):
        resp = self._sfp({"martian_type": "no_such_martian", "inputs": {}, "timeout_ms": 1000})
        assert resp["response"]["error"]["code"] == "UNKNOWN_MARTIAN_TYPE"

    def test_sfp_non_dict_inputs_rejected(self):
        """L262: inputs must be an object in summon-from-population."""
        resp = self._sfp({
            "martian_type": "compute",
            "inputs": "not-a-dict",
            "timeout_ms": 1000,
        })
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert "inputs" in err["message"]

    def test_sfp_population_load_failure_returns_internal_error(self, monkeypatch):
        """L279-280: Population.load_or_create raises → INTERNAL error, not crash."""
        from alienclaw.evolution.population import Population

        def fail_load(config):
            raise OSError("simulated disk error")

        monkeypatch.setattr(Population, "load_or_create", staticmethod(fail_load))
        resp = self._sfp({
            "martian_type": "compute",
            "inputs": {"input": "2 + 2"},
            "timeout_ms": 1000,
        })
        err = resp["response"]["error"]
        assert err["code"] == "INTERNAL"
        assert "Population error" in err["message"]
        assert "disk error" in err["details"]["exception"]

    def test_sfp_tournament_failure_returns_internal_error(self, monkeypatch):
        """L286-287: tournament() raises RuntimeError → INTERNAL error, not crash."""
        from alienclaw.evolution.population import Population

        def fail_sample(self, rng):
            raise RuntimeError("pool corrupted")

        monkeypatch.setattr(Population, "sample", fail_sample)
        resp = self._sfp({
            "martian_type": "compute",
            "inputs": {"input": "2 + 2"},
            "timeout_ms": 1000,
        })
        err = resp["response"]["error"]
        assert err["code"] == "INTERNAL"
        assert "Selection error" in err["message"]
        assert "pool corrupted" in err["details"]["exception"]

    def test_sfp_martian_failure_annotates_genome_used(self):
        """L297-311: when sfp execution fails, error details include genome_used."""
        resp = self._sfp({
            "martian_type": "compute",
            "inputs": {"input": "this is not valid math and will fail"},
            "timeout_ms": 1000,
        })
        assert resp["response"]["ok"] is False
        err = resp["response"]["error"]
        assert err["code"] == "TOOL_RUNNER_FAILED"
        assert "genome_used" in err["details"]
        assert len(err["details"]["genome_used"]) == 256

    def test_sfp_pop_add_failure_in_error_path_is_silenced(self, monkeypatch):
        """L360-361: pop.add() raises in failure feedback path → silenced, error response returned."""
        from alienclaw.evolution.population import Population

        def always_raise(self, genome, fitness, generation, parent_ids, run_metadata):
            raise RuntimeError("simulated write failure")

        monkeypatch.setattr(Population, "add", always_raise)
        resp = self._sfp({
            "martian_type": "compute",
            "inputs": {"input": "this is not valid math"},
            "timeout_ms": 1000,
        })
        assert resp["response"]["ok"] is False
        # Write failure silenced — genome_used still annotated (continues after except)
        assert "genome_used" in resp["response"]["error"]["details"]
        assert len(resp["response"]["error"]["details"]["genome_used"]) == 256

    def test_sfp_pop_add_failure_in_success_path_is_silenced(self, monkeypatch):
        """L325-326: pop.add() raises in success feedback path → silenced, response returned."""
        from alienclaw.evolution.population import Population

        original_add = Population.add
        calls = {"n": 0}

        def flaky_add(self, genome, fitness, generation, parent_ids, run_metadata):
            calls["n"] += 1
            if run_metadata.get("re_evaluated"):
                raise RuntimeError("write failure")
            return original_add(self, genome, fitness, generation, parent_ids, run_metadata)

        monkeypatch.setattr(Population, "add", flaky_add)
        resp = self._sfp({
            "martian_type": "compute",
            "inputs": {"input": "2 + 2"},
            "timeout_ms": 1000,
        })
        assert "response" in resp
        if resp["response"]["ok"]:
            assert "genome_used" in resp["response"]

    def test_sfp_caps_pool_to_population_size_before_tournament(self, monkeypatch):
        """Pool exceeding population_size is capped (top by fitness) before tournament (E2 item 2).

        Regression guard: prior to the cap, each bridge subprocess loaded all entries
        from the current generation, growing the pool unboundedly across live runs and
        diluting tournament selection with old low-fitness entries.
        """
        import random
        import alienclaw.evolution.selection as sel_mod
        from alienclaw.evolution.population import Population
        from alienclaw.evolution.types import EvolutionConfig
        from alienclaw.genome.operators import random_genome

        # Build an oversized population: default population_size=32 + 18 extra = 50 entries
        config = EvolutionConfig(martian_type="compute")
        pop = Population.create(config)                          # 32 seeded entries, fitness=0.0
        rng = random.Random(42)
        for i in range(18):
            pop.add(
                genome=random_genome(rng, "COMPUT01"),
                fitness=(i + 1) * 0.05,                        # 0.05..0.90 — all valid
                generation=0,
                parent_ids=(),
                run_metadata={"test": True},
            )
        assert len(pop.all()) == 50, "pre-condition: pool is oversized"

        # Record the expected cap (top population_size by fitness) BEFORE the bridge call
        # so the assertion is unaffected by the pop.add() that runs inside the bridge.
        expected_top_fitnesses = sorted(e.fitness for e in pop.top(config.population_size))

        # Patch load_or_create to return the oversized population
        monkeypatch.setattr(Population, "load_or_create", staticmethod(lambda _config: pop))

        # Spy on tournament to capture what pool it receives
        captured: list = []
        orig_tournament = sel_mod.tournament

        def spy_tournament(population, k, r):
            captured[:] = population.all()
            return orig_tournament(population, k, r)

        monkeypatch.setattr(sel_mod, "tournament", spy_tournament)

        resp = self._sfp({
            "martian_type": "compute",
            "inputs": {"input": "2 + 2"},
            "timeout_ms": 30_000,
        })

        # Bridge must cap the pool to population_size before tournament
        assert len(captured) <= config.population_size, (
            f"tournament received {len(captured)} entries but cap is {config.population_size}"
        )
        # Cap keeps the highest-fitness entries (18 measured > 32 zero-seeded entries)
        assert sorted(e.fitness for e in captured) == expected_top_fitnesses, (
            "cap must preserve the top-fitness entries, not an arbitrary subset"
        )
        # Bridge still produced a valid response after the cap
        assert "ok" in resp["response"]
