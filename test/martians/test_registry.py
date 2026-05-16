import pytest
from alienclaw.martians.registry import MartianRegistry
from alienclaw.brains.registry import BrainRegistry


@pytest.fixture(scope="module")
def real_brains():
    return BrainRegistry.load("seed/msb/")


@pytest.fixture(scope="module")
def registry(real_brains):
    return MartianRegistry.load("seed/martians/", real_brains)


def test_loads_16_martians(registry):
    assert len(registry.all()) == 16


def test_single_slot_present(registry):
    spec = registry.get("compute_alone")
    assert spec.martian_type == "compute_alone"
    assert len(spec.slots) == 1


def test_composition_present(registry):
    spec = registry.get("fetch_then_parse")
    assert spec.martian_type == "fetch_then_parse"
    assert len(spec.slots) == 2


def test_alias_works(registry):
    spec_alias = registry.get("compute")
    spec_full = registry.get("compute_alone")
    assert spec_alias is spec_full


def test_all_8_aliases_work(registry):
    for tool in ("compute", "extract_json", "file_read", "file_write",
                 "http_get", "search_text", "url_fetch", "web_search"):
        assert registry.has(tool), f"Alias missing: {tool}"


def test_unknown_raises_key_error(registry):
    with pytest.raises(KeyError, match="nonexistent"):
        registry.get("nonexistent")


def test_has_returns_false_for_missing(registry):
    assert not registry.has("not_a_martian")


def test_all_excludes_aliases(registry):
    names = {m.martian_type for m in registry.all()}
    assert len(names) == 16
    assert "compute_alone" in names
    assert "fetch_then_parse" in names
