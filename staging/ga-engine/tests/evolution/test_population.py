import random
import uuid

import pytest

from alienclaw_ga.evolution.population import Population, _id_tag_for
from alienclaw_ga.evolution.types import EvolutionConfig
from alienclaw_ga.genome.operators import random_genome


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


@pytest.fixture
def config():
    return EvolutionConfig(martian_type="compute", population_size=8, seed=42)


class TestPopulationCreate:
    def test_create_seeds_correct_size(self, config):
        pop = Population.create(config)
        assert len(pop.all()) == config.population_size

    def test_create_all_entries_have_fitness_zero(self, config):
        pop = Population.create(config)
        for e in pop.all():
            assert e.fitness == 0.0

    def test_create_all_genomes_are_valid(self, config):
        from alienclaw_ga.genome.validation import validate
        pop = Population.create(config)
        for e in pop.all():
            assert validate(e.genome).valid, f"Invalid genome: {e.genome[:20]}..."

    def test_create_raises_if_already_exists(self, config):
        Population.create(config)
        with pytest.raises(ValueError, match="already exists"):
            Population.create(config)

    def test_create_deterministic_with_seed(self, config):
        pop1 = Population.create(config)
        genomes1 = [e.genome for e in pop1.all()]
        pop1.clear()
        pop2 = Population.create(config)
        genomes2 = [e.genome for e in pop2.all()]
        assert genomes1 == genomes2

    def test_create_different_seeds_differ(self):
        c1 = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        c2 = EvolutionConfig(martian_type="http_get", population_size=4, seed=2)
        pop1 = Population.create(c1)
        pop2 = Population.create(c2)
        assert pop1.all()[0].genome != pop2.all()[0].genome


class TestPopulationSampleAndTop:
    def test_sample_raises_on_empty(self):
        config = EvolutionConfig(martian_type="empty_test")
        pop = Population.create(config)
        pop.replace_pool([])
        with pytest.raises(RuntimeError, match="empty"):
            pop.sample(random.Random(0))

    def test_sample_returns_pool_member(self, config):
        pop = Population.create(config)
        rng = random.Random(7)
        genomes = {e.genome for e in pop.all()}
        for _ in range(20):
            entry = pop.sample(rng)
            assert entry.genome in genomes

    def test_sample_has_variety(self, config):
        pop = Population.create(config)
        rng = random.Random(99)
        seen = set()
        for _ in range(100):
            seen.add(pop.sample(rng).entry_id)
        assert len(seen) > 1

    def test_top_returns_highest_fitness_first(self, config):
        pop = Population.create(config)
        # Manually assign fitness
        from alienclaw_ga.genome.operators import random_genome
        rng = random.Random(42)
        entries = []
        for i in range(4):
            g = random_genome(rng, "COMPUT01")
            e = pop.add(
                genome=g, fitness=float(i) / 4.0, generation=0, parent_ids=(), run_metadata={}
            )
            entries.append(e)
        top2 = pop.top(2)
        assert top2[0].fitness >= top2[1].fitness
        assert top2[0].fitness == 0.75

    def test_top_empty_population_returns_empty(self, config):
        pop = Population.create(config)
        pop.replace_pool([])
        assert pop.top(5) == []


class TestPopulationAdd:
    def test_add_validates_genome(self, config):
        pop = Population.create(config)
        with pytest.raises(ValueError, match="Genome validation failed"):
            pop.add("TOOSHORT", 0.5, 0, (), {})

    def test_add_validates_fitness_high(self, config):
        from alienclaw_ga.genome.operators import random_genome
        pop = Population.create(config)
        g = random_genome(random.Random(1), "COMPUT01")
        with pytest.raises(ValueError, match="fitness"):
            pop.add(g, 1.5, 0, (), {})

    def test_add_validates_fitness_low(self, config):
        from alienclaw_ga.genome.operators import random_genome
        pop = Population.create(config)
        g = random_genome(random.Random(1), "COMPUT01")
        with pytest.raises(ValueError, match="fitness"):
            pop.add(g, -0.1, 0, (), {})

    def test_add_returns_correct_entry(self, config):
        from alienclaw_ga.genome.operators import random_genome
        pop = Population.create(config)
        g = random_genome(random.Random(1), "COMPUT01")
        entry = pop.add(g, 0.8, 1, ("parent-1",), {"tool_calls": 1})
        assert entry.genome == g
        assert entry.fitness == pytest.approx(0.8)
        assert entry.generation == 1
        assert entry.parent_ids == ("parent-1",)

    def test_add_persisted_to_disk(self, config):
        from alienclaw_ga.genome.operators import random_genome
        pop = Population.create(config)
        g = random_genome(random.Random(2), "COMPUT01")
        pop.add(g, 0.9, 0, (), {})
        pop2 = Population.load("compute")
        # The loaded pool is filtered to current generation (0)
        _ = [e.genome for e in pop2.all()]
        # Either directly in pool or accessible via all()
        assert any(e.genome == g for e in Population.load("compute").all())


class TestPopulationSnapshot:
    def test_snapshot_has_required_keys(self, config):
        pop = Population.create(config)
        snap = pop.snapshot()
        for key in ("martian_type", "generation", "size", "top_fitness", "mean_fitness", "config"):
            assert key in snap

    def test_snapshot_size_matches_pool(self, config):
        pop = Population.create(config)
        assert pop.snapshot()["size"] == config.population_size


class TestPopulationLoad:
    def test_load_missing_raises(self):
        with pytest.raises(FileNotFoundError):
            Population.load("nonexistent_martian")

    def test_load_or_create_creates_when_missing(self, config):
        pop = Population.load_or_create(config)
        assert len(pop.all()) == config.population_size

    def test_load_or_create_loads_when_exists(self, config):
        p1 = Population.create(config)
        _ = {e.genome for e in p1.all()}
        p2 = Population.load_or_create(config)
        assert len(p2.all()) > 0

    def test_current_generation_starts_at_zero(self, config):
        pop = Population.create(config)
        assert pop.current_generation() == 0

    def test_increment_generation(self, config):
        pop = Population.create(config)
        pop.increment_generation()
        assert pop.current_generation() == 1

    def test_clear_empties_pool_and_disk(self, config):
        pop = Population.create(config)
        pop.clear()
        assert pop.all() == []
        with pytest.raises(FileNotFoundError):
            Population.load("compute")

    def test_load_returns_empty_when_storage_exists_but_no_entries(self, config):
        """Population.load() returns an empty population when storage was initialized
        but no entries were written — models a crash between initialize() and write_entry()."""
        from alienclaw_ga.evolution.storage import PopulationStorage
        storage = PopulationStorage(config.martian_type)
        storage.initialize(config)
        # entries_dir is empty — no write_entry() calls made

        loaded = Population.load(config.martian_type)
        assert loaded.all() == []

    def test_load_falls_back_when_no_current_gen_entries(self, config):
        """Population.load() crash-recovery path: if no entries match current_generation,
        fall back to the last population_size entries on disk rather than returning empty.

        This path is reached when increment_generation() is called but the process
        crashes before any generation-N entries are written (population.py L87).
        """
        pop = Population.create(config)
        gen0_entries = pop.all()
        assert len(gen0_entries) == config.population_size

        # Advance the generation counter without writing any gen-1 entries.
        # Simulates the window between writing children and increment_generation()
        # that never completes — or a direct call to increment outside the cycle.
        pop._storage.increment_generation()
        assert pop._storage.current_generation() == 1

        # Load: gen-1 pool filter returns [], triggering the fallback branch.
        loaded = Population.load(config.martian_type)

        # Must not crash or return empty — fallback to all_entries[-population_size:]
        assert len(loaded.all()) == config.population_size
        # All recovered entries come from generation 0 (the only ones on disk)
        assert all(e.generation == 0 for e in loaded.all())


# ---------------------------------------------------------------------------
# PKT-1313 — _id_tag_for() must honor its "8-char Base62" contract for EVERY
# martian_type, including ones containing Unicode alphanumerics.
#
# Python's str.isalnum() is Unicode-aware, so an unguarded filter lets
# non-Base62 characters into the id_tag. The id_tag is pinned into the
# IDENTITY section of every seeded genome, so the genome assembler then
# raises ValueError("IDENTITY section contains non-Base62 characters") and
# Population.create() can NEVER complete for such a martian_type — the
# bridge turns that into a permanent INTERNAL error for that martian.
# ---------------------------------------------------------------------------

BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def _is_base62(s: str) -> bool:
    """True iff every character of s is in the Base62 alphabet."""
    return all(c in BASE62 for c in s)


# Inputs whose Unicode alphanumerics would survive an ASCII-only filter.
UNICODE_ID_TAG_INPUTS = [
    "名前",
    "ñó",
    "ÉTÉ",
    "①②③",
    "名前_compute",
    "élite",
    "áá",
    "compute_名前",
    "١٢٣",
    "Ωmega",
]

# Inputs whose first six alphanumerics are ASCII — regression controls that
# must map to exactly the tag they always mapped to.
ASCII_ID_TAG_INPUTS = [
    ("compute", "COMPUT01"),
    ("compute_alone", "COMPUT01"),
    ("web_search", "WEBSEA01"),
    ("file_read", "FILERE01"),
    ("http_get", "HTTPGE01"),
    ("extract_json", "EXTRAC01"),
    ("", "00000001"),
    ("   ", "00000001"),
    ("a", "A0000001"),
]


class TestIdTagForCharset:
    """PKT-1313: _id_tag_for() must produce 8-char Base62 output for any input."""

    def test_id_tag_for_is_always_8_base62_chars(self):
        for mt in UNICODE_ID_TAG_INPUTS + [m for m, _ in ASCII_ID_TAG_INPUTS]:
            tag = _id_tag_for(mt)
            assert len(tag) == 8, f"tag must be 8 chars; got {len(tag)} for {mt!r}"
            assert _is_base62(tag), f"tag must be Base62; got {tag!r} for {mt!r}"

    def test_id_tag_for_ascii_inputs_are_unchanged(self):
        """ASCII martian_types keep exactly the tag they always had.

        This is the distinctness anchor for the ASCII corpus — the fix must
        not perturb any existing seed martian_type's tag.
        """
        for mt, expected in ASCII_ID_TAG_INPUTS:
            assert _id_tag_for(mt) == expected, (
                f"ASCII tag changed for {mt!r}: "
                f"expected {expected!r}, got {_id_tag_for(mt)!r}"
            )

    def test_id_tag_for_transliterates_when_ascii_base_exists(self):
        """Unicode characters with an ASCII base keep their distinguishing letters.

        Without transliteration these collapse onto each other (or onto a
        padded-zero tag), destroying the tag's ability to identify the martian.
        """
        assert _id_tag_for("ñó") == "NO000001"
        assert _id_tag_for("ÉTÉ") == "ETE00001"
        assert _id_tag_for("élite") == "ELITE001"

    def test_id_tag_for_drops_characters_with_no_ascii_base(self):
        """Characters with no ASCII base are dropped rather than emitted raw."""
        # '名' and '前' have no ASCII decomposition; '①' decomposes to '1'.
        assert _id_tag_for("名前") == "00000001"
        assert _id_tag_for("①②③") == "12300001"

    def test_random_genome_accepts_id_tag_for_every_unicode_input(self):
        """End-to-end: the tag must be usable as a genome IDENTITY prefix.

        This is the production hot path — Population.create() calls
        random_genome(rng, _id_tag_for(martian_type)) — so a non-Base62 tag
        makes the population impossible to create.
        """
        for mt in UNICODE_ID_TAG_INPUTS + [m for m, _ in ASCII_ID_TAG_INPUTS]:
            tag = _id_tag_for(mt)
            genome = random_genome(random.Random(42), tag)
            assert len(genome) == 256, f"genome must be 256 chars for {mt!r}"
            assert _is_base62(genome), f"genome from tag {tag!r} ({mt!r}) is not Base62"

    def test_population_create_succeeds_for_unicode_martian_type(self):
        """Population.create() must complete for a Unicode martian_type.

        This is the exact production failure: the bridge calls
        Population.load_or_create() and the create path raised, making the
        martian permanently unusable.
        """
        mt = f"名前_{uuid.uuid4().hex[:8]}"
        config = EvolutionConfig(martian_type=mt, population_size=2)
        pop = Population.create(config)
        assert len(pop.all()) == 2
        for entry in pop.all():
            assert _is_base62(entry.genome)

    def test_id_tag_collisions_are_explicitly_pinned(self):
        """The 6-char truncation collision class is pre-existing and pinned here.

        The id_tag is a display label only — never a lookup key, never grouped
        by (leaderboard uniqueness is by SHA-256 genome_id). The collision class
        already existed on unfixed HEAD: 'compute', 'compute_alone' and
        'compute_then_write' all map to 'COMPUT01'. The fix does not widen it
        for ASCII inputs, so it is pinned rather than left unasserted.
        """
        assert _id_tag_for("compute") == _id_tag_for("compute_alone") == "COMPUT01"
        assert _id_tag_for("compute_then_write") == "COMPUT01"
        assert (
            _id_tag_for("fetch_then_parse")
            == _id_tag_for("fetch_then_extract")
            == "FETCHT01"
        )
        assert _id_tag_for("search_then_fetch") == "SEARCH01"
