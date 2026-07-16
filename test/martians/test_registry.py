import pytest
from alienclaw.martians.registry import MartianRegistry
from alienclaw.brains.registry import BrainRegistry
from alienclaw.martians.types import MartianSpec, SlotDeclaration


_MINIMAL_MARTIAN = """\
martian_type: dup_test
description: "Duplicate test"
use_cases: []
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
"""

_INVALID_SLOT_INDEX_MARTIAN = """\
martian_type: bad_slot
description: "slot_index=2 violates Packet 16 max"
use_cases: []
slots:
  - slot_index: 2
    tool_name: compute
    inputs_from: null
"""


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


def _make_spec(martian_type: str) -> MartianSpec:
    slot = SlotDeclaration(slot_index=0, tool_name="compute", inputs_from=None)
    return MartianSpec(martian_type=martian_type, slots=(slot,), description="", use_cases=())


class TestRegistryErrorPaths:
    def test_load_nonexistent_dir_raises(self, real_brains):
        with pytest.raises(FileNotFoundError, match="Martians directory not found"):
            MartianRegistry.load("/tmp/_alienclaw_tester_nonexistent_133", real_brains)

    def test_load_duplicate_martian_type_raises(self, tmp_path, real_brains):
        (tmp_path / "a_dup.martian").write_text(_MINIMAL_MARTIAN)
        (tmp_path / "b_dup.martian").write_text(_MINIMAL_MARTIAN)
        with pytest.raises(ValueError, match="Duplicate martian_type"):
            MartianRegistry.load(tmp_path, real_brains)

    def test_load_invalid_martian_raises(self, tmp_path, real_brains):
        (tmp_path / "bad.martian").write_text(_INVALID_SLOT_INDEX_MARTIAN)
        with pytest.raises(ValueError, match="Invalid .martian file"):
            MartianRegistry.load(tmp_path, real_brains)

    def test_alias_collision_skips_overwrite(self):
        """When bare name is already registered, _alone alias is silently skipped."""
        spec_bare = _make_spec("compute")
        spec_alone = _make_spec("compute_alone")
        reg = MartianRegistry([spec_bare, spec_alone])
        assert reg.get("compute") is spec_bare
        assert reg.get("compute_alone") is spec_alone
