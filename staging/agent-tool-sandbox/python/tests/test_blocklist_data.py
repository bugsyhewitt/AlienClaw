"""The generated block list matches policy/blocklist.v1.json, and the guard decides only from it.

``policy/gen_python.py`` renders ``_blocklist_data.py`` from the JSON. These tests render it
again in memory and compare bytes, so they fail when the JSON was edited without re-running
the generator, or when the generated module was edited by hand. They skip when the policy
directory is not next to the package (the package lifted on its own).
"""
from __future__ import annotations

import ast
import copy
import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest

import agent_tool_sandbox._blocklist_data as data
import agent_tool_sandbox.ssrf_guard as guard

PKG = Path(guard.__file__).resolve().parent
POLICY = Path(__file__).resolve().parents[2] / "policy"
SOURCE = POLICY / "blocklist.v1.json"
GENERATED = PKG / "_blocklist_data.py"


@pytest.fixture(scope="module")
def gen() -> ModuleType:
    path = POLICY / "gen_python.py"
    if not path.is_file() or not SOURCE.is_file():
        pytest.skip("policy/ is not next to this package")
    spec = importlib.util.spec_from_file_location("_blocklist_gen_python", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _source_text() -> str:
    return SOURCE.read_bytes().decode("utf-8")


def test_generated_module_matches_the_policy(gen: ModuleType) -> None:
    wanted = gen.render(_source_text())
    assert GENERATED.read_bytes().decode("utf-8") == wanted, (
        "_blocklist_data.py is stale or hand-edited: run python3 policy/gen_python.py"
    )


def test_check_mode_agrees(gen: ModuleType) -> None:
    assert gen.main(["--check"]) == 0


def test_generated_module_says_do_not_edit() -> None:
    first = GENERATED.read_text(encoding="utf-8").splitlines()[0]
    assert first == '"""GENERATED — do not edit.'
    assert data.COLUMN == "python"


def test_guard_consults_no_ipaddress_is_property() -> None:
    """Every block decision comes from the table: no ip.is_private / is_reserved / ..."""
    tree = ast.parse((PKG / "ssrf_guard.py").read_text(encoding="utf-8"))
    used = {
        node.attr for node in ast.walk(tree)
        if isinstance(node, ast.Attribute) and node.attr.startswith("is_")
    }
    assert used == set()


def test_strictest_wins_gives_both_languages_the_same_rules(gen: ModuleType) -> None:
    doc = json.loads(_source_text())
    doc["profile"] = "strictest-wins"
    loaded = gen.load(json.dumps(doc))
    py, ts = gen.resolve(loaded, "python"), gen.resolve(loaded, "ts")
    assert {k: v for k, v in py.items() if k != "off"} == {
        k: v for k, v in ts.items() if k != "off"
    }


def _doc(*entries: dict) -> str:
    base = {"rationale": "r", "refs": ["x"], "applies": {"python": True, "ts": False}}
    return json.dumps({
        "schema_version": 1, "profile": "per-language", "description": "",
        "entries": [{**base, **e} for e in entries],
    })


V4 = {"family": "ipv4", "effect": "block"}
V6 = {"family": "ipv6", "effect": "block"}


def test_profile_semantics(gen: ModuleType) -> None:
    """strictest-wins: block and decode entries are on if EITHER column is; exemptions only
    if BOTH are; decode_excludes keep only what both languages exclude."""
    both = {"python": True, "ts": True}
    text = _doc(
        {**V4, "id": "b-py", "cidr": "10.0.0.0/8"},
        {**V4, "id": "b-ts", "cidr": "11.0.0.0/8", "applies": {"python": False, "ts": True}},
        {"family": "ipv4", "effect": "exempt", "id": "x-py", "cidr": "10.0.0.1/32"},
        {"family": "ipv4", "effect": "exempt", "id": "x-both", "cidr": "10.0.0.2/32",
         "applies": both},
        {"family": "ipv6", "effect": "decode", "matcher": "ipv4-mapped", "id": "dec",
         "cidr": "::ffff:0:0/96", "decode_excludes": {"python": ["b-py", "b-ts"], "ts": ["b-ts"]}},
    )
    per = gen.resolve(gen.load(text), "python")
    assert [r[0] for r in per["ipv4_block"]] == ["b-py"]
    assert [r[0] for r in per["ipv4_exempt"]] == ["x-py", "x-both"]
    mapped = per["embedded"][0]
    assert (mapped["mode"], mapped["skip"], mapped["ipv4_block"]) == (
        "decode", ["b-py", "b-ts"], []
    )
    assert per["embedded"][1]["mode"] == "ranges"

    strict = gen.load(text.replace('"per-language"', '"strictest-wins"'))
    for lang in ("python", "ts"):
        t = gen.resolve(strict, lang)
        assert [r[0] for r in t["ipv4_block"]] == ["b-py", "b-ts"]
        assert [r[0] for r in t["ipv4_exempt"]] == ["x-both"]
        assert t["embedded"][0]["skip"] == ["b-ts"]
        assert [r[0] for r in t["embedded"][0]["ipv4_block"]] == ["b-py"]


def test_whole_prefix_block_overrides_its_decode(gen: ModuleType) -> None:
    text = _doc(
        {**V6, "id": "whole", "cidr": "::ffff:0:0/96", "applies": {"python": False, "ts": True}},
        {"family": "ipv6", "effect": "decode", "matcher": "ipv4-mapped", "id": "dec",
         "cidr": "::ffff:0:0/96"},
    )
    assert gen.resolve(gen.load(text), "python")["embedded"][0]["mode"] == "decode"
    assert gen.resolve(gen.load(text), "ts")["embedded"][0]["mode"] == "block"
    strict = gen.load(text.replace('"per-language"', '"strictest-wins"'))
    assert gen.resolve(strict, "python")["embedded"][0]["mode"] == "block"


@pytest.mark.parametrize("entry, problem", [
    ({**V4, "id": "ent-a", "cidr": "10.0.0.1/8"}, "bad cidr"),
    ({**V4, "id": "ent-a", "cidr": "::/8"}, "bad cidr"),
    ({**V6, "id": "ent-a", "cidr": "::ffff:0.0.0.0/96"}, "bad cidr"),
    ({**V6, "id": "ent-a", "cidr": "::ffff:7f00:0/104"}, "inside the ipv4-mapped prefix"),
    ({**V4, "id": "Bad-id", "cidr": "10.0.0.0/8"}, "id must match"),
    ({**V4, "id": "ent-a", "cidr": "10.0.0.0/8", "applies": {"python": True}}, "applies must be"),
    ({**V4, "id": "ent-a", "cidr": "10.0.0.0/8", "extra": 1}, "unknown keys"),
    ({**V4, "id": "ent-a", "cidr": "10.0.0.0/8", "refs": []}, "refs must be"),
    ({"family": "ipv6", "effect": "decode", "matcher": "nat64-embedded", "id": "ent-a",
      "cidr": "::ffff:0:0/96"}, "a decode entry is ipv6"),
    ({"family": "ipv4", "effect": "block", "id": "ent-a", "cidr": "10.0.0.0/8",
      "decode_excludes": {}}, "belong to decode entries"),
    ({"family": "name", "effect": "exempt", "id": "ent-a", "name": "localhost"}, "a name entry"),
    ({"family": "name", "effect": "block", "id": "ent-a", "name_suffix": "localhost"}, "starting"),
])
def test_schema_breaks_are_refused(gen: ModuleType, entry: dict, problem: str) -> None:
    with pytest.raises(gen.PolicyError, match=problem):
        gen.load(_doc(entry))


def test_duplicates_are_refused(gen: ModuleType) -> None:
    entry = {**V4, "id": "ent-a", "cidr": "10.0.0.0/8"}
    with pytest.raises(gen.PolicyError, match="duplicate id"):
        gen.load(_doc(entry, entry))
    with pytest.raises(gen.PolicyError, match="duplicate rule"):
        gen.load(_doc(entry, {**entry, "id": "ent-b"}))
    with pytest.raises(gen.PolicyError, match="duplicate key"):
        gen.load(_doc(entry).replace('"id": "ent-a"', '"id": "ent-a", "id": "b"'))


def test_real_policy_entries_all_have_rationale_and_refs(gen: ModuleType) -> None:
    doc = gen.load(_source_text())
    assert doc["profile"] in gen.PROFILES
    for entry in doc["entries"]:
        assert entry["rationale"].strip() and entry["refs"], entry["id"]


def test_load_does_not_mutate_its_input(gen: ModuleType) -> None:
    text = _source_text()
    before = copy.deepcopy(json.loads(text))
    gen.render(text)
    assert json.loads(text) == before
