"""Integration tests for the API server — real HTTP on random port."""
from __future__ import annotations

import json
import threading
import urllib.request
import urllib.error
import pytest
from pathlib import Path

from alienclaw.api.server import configure, create_server
from alienclaw.api.auth import generate_api_key
from alienclaw.genome.operators import random_genome
import random


@pytest.fixture
def api_server(tmp_path, monkeypatch):
    """Start a real API server on a random port for the test."""
    monkeypatch.setenv("ALIENCLAW_API_DATA_ROOT", str(tmp_path / "data"))
    configure(data_root=tmp_path / "data", msb_dir="seed/msb/")
    srv = create_server(host="127.0.0.1", port=0)
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    base = f"http://127.0.0.1:{port}"
    yield base
    srv.shutdown()


def _get(url: str) -> tuple[int, dict]:
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def _post(url: str, body: dict, headers: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data,
                                  headers={"Content-Type": "application/json", **(headers or {})},
                                  method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def _valid_genome():
    return random_genome(random.Random(42), "COMPUT01")


class TestHealth:
    def test_returns_200(self, api_server):
        status, body = _get(f"{api_server}/v1/health")
        assert status == 200
        assert body["status"] == "ok"
        assert "version" in body
        assert "uptime_seconds" in body


class TestInstall:
    def test_new_install_returns_201(self, api_server):
        key = generate_api_key()
        machine_hash = "a" * 64
        status, body = _post(f"{api_server}/v1/install",
                             {"api_key": key, "machine_hash": machine_hash})
        assert status == 201
        assert body["status"] == "registered"
        assert "install_id" in body
        assert body["rate_limit"]["submissions_per_hour"] == 100

    def test_known_install_returns_200(self, api_server):
        key = generate_api_key()
        machine_hash = "b" * 64
        _post(f"{api_server}/v1/install", {"api_key": key, "machine_hash": machine_hash})
        status, body = _post(f"{api_server}/v1/install",
                             {"api_key": key, "machine_hash": machine_hash})
        assert status == 200
        assert body["status"] == "known"

    def test_invalid_key_returns_400(self, api_server):
        status, body = _post(f"{api_server}/v1/install",
                             {"api_key": "short", "machine_hash": "a" * 64})
        assert status == 400
        assert body["error"]["code"] == "INVALID_API_KEY_FORMAT"

    def test_invalid_machine_hash_returns_400(self, api_server):
        status, body = _post(f"{api_server}/v1/install",
                             {"api_key": generate_api_key(), "machine_hash": "not_hex"})
        assert status == 400


class TestSubmitGenome:
    def _register(self, base: str) -> str:
        key = generate_api_key()
        _post(f"{base}/v1/install", {"api_key": key, "machine_hash": "c" * 64})
        return key

    def test_valid_submission_returns_201(self, api_server):
        key = self._register(api_server)
        genome = _valid_genome()
        status, body = _post(f"{api_server}/v1/genomes",
                             {"genome": genome, "martian_type": "compute", "fitness": 0.85,
                              "run_metadata": {"generation": 5}},
                             headers={"Authorization": f"Bearer {key}"})
        assert status == 201
        assert "submission_id" in body
        assert "rank" in body
        assert isinstance(body["is_new_top"], bool)

    def test_missing_auth_returns_401(self, api_server):
        status, body = _post(f"{api_server}/v1/genomes",
                             {"genome": _valid_genome(), "martian_type": "compute", "fitness": 0.5})
        assert status == 401

    def test_invalid_genome_length_returns_422(self, api_server):
        key = self._register(api_server)
        status, body = _post(f"{api_server}/v1/genomes",
                             {"genome": "TOOSHORT", "martian_type": "compute", "fitness": 0.5},
                             headers={"Authorization": f"Bearer {key}"})
        assert status == 422
        assert body["error"]["code"] == "INVALID_GENOME_LENGTH"

    def test_invalid_fitness_returns_422(self, api_server):
        key = self._register(api_server)
        status, body = _post(f"{api_server}/v1/genomes",
                             {"genome": _valid_genome(), "martian_type": "compute", "fitness": 1.5},
                             headers={"Authorization": f"Bearer {key}"})
        assert status == 422
        assert body["error"]["code"] == "INVALID_FITNESS_RANGE"

    def test_unknown_martian_type_returns_422(self, api_server):
        key = self._register(api_server)
        status, body = _post(f"{api_server}/v1/genomes",
                             {"genome": _valid_genome(), "martian_type": "nonexistent", "fitness": 0.5},
                             headers={"Authorization": f"Bearer {key}"})
        assert status == 422
        assert body["error"]["code"] == "UNKNOWN_MARTIAN_TYPE"

    def test_duplicate_returns_200(self, api_server):
        key = self._register(api_server)
        genome = _valid_genome()
        body_data = {"genome": genome, "martian_type": "compute", "fitness": 0.9,
                     "run_metadata": {}}
        headers = {"Authorization": f"Bearer {key}"}
        s1, b1 = _post(f"{api_server}/v1/genomes", body_data, headers)
        s2, b2 = _post(f"{api_server}/v1/genomes", body_data, headers)
        assert s1 == 201
        assert s2 == 200
        assert b1["submission_id"] == b2["submission_id"]


class TestTopGenomes:
    def test_empty_returns_200(self, api_server):
        status, body = _get(f"{api_server}/v1/genomes/top?martian_type=compute")
        assert status == 200
        assert body["martian_type"] == "compute"
        assert body["genomes"] == []

    def test_missing_martian_type_returns_400(self, api_server):
        status, body = _get(f"{api_server}/v1/genomes/top")
        assert status == 400

    def test_unknown_martian_type_returns_400(self, api_server):
        status, body = _get(f"{api_server}/v1/genomes/top?martian_type=nonexistent")
        assert status == 400

    def test_returns_submitted_genomes_sorted(self, api_server):
        key = generate_api_key()
        _post(f"{api_server}/v1/install", {"api_key": key, "machine_hash": "d" * 64})
        headers = {"Authorization": f"Bearer {key}"}
        for fitness in [0.3, 0.8, 0.5]:
            g = random_genome(random.Random(int(fitness * 100)), "COMPUT01")
            _post(f"{api_server}/v1/genomes",
                  {"genome": g, "martian_type": "compute", "fitness": fitness}, headers)
        status, body = _get(f"{api_server}/v1/genomes/top?martian_type=compute&n=3")
        assert status == 200
        assert body["total_for_type"] == 3
        fitnesses = [e["fitness"] for e in body["genomes"]]
        assert fitnesses == sorted(fitnesses, reverse=True)


class TestMartianTypes:
    def test_returns_all_types(self, api_server):
        status, body = _get(f"{api_server}/v1/martian-types")
        assert status == 200
        # Packet 16: registered types include all Martian types from
        # seed/martians/ (16) plus the 8 single-slot bare-tool aliases.
        # Brain tool names overlap with the aliases, so the union is 24.
        assert body["total"] >= 8
        names = [t["name"] for t in body["martian_types"]]
        # Bare-tool aliases preserved for backward compat
        assert "compute" in names
        assert "web_search" in names
        # New Martian types from Packet 16
        assert "compute_alone" in names
        assert "fetch_then_parse" in names


class TestStats:
    def test_returns_stats(self, api_server):
        status, body = _get(f"{api_server}/v1/stats")
        assert status == 200
        for key in ("total_genomes", "total_installs", "total_fitness_evaluations",
                    "top_fitness_by_type"):
            assert key in body
