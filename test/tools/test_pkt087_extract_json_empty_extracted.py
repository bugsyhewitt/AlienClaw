"""PKT-087 corrective re-author — extract_json empty-extraction correctness parity.

Defect class: a tool whose own ``correctness`` does not reflect whether it did
the work it reports. ``search_text`` and ``web_search`` both already encode
``1.0 if <did the work> else 0.5`` (web_search.py:95). ``extract_json`` hardcodes
``correctness=1.0`` on the success return (extract_json.py:81) even when it
extracted NOTHING (``extracted == {}``, no ``path`` supplied).

End-to-end that means a Martian that extracts zero paths scores a perfect 1.0
through bridge ``min(graded, run_result.correctness)`` (bridge/server.py:152),
identical to one that extracted a real path. This file pins the missing parity.

The shared ``_field_valid`` predicate is DELIBERATELY NOT under test here — the
overmind verdict on rejected PKT-087 directs the fix to the tool's own
correctness, not to the shared conformance scorer.
"""
from __future__ import annotations

from alienclaw.tools import extract_json

JSON_IN = '{"a": 1}'


def _run(path: str | None, **params):
    """Call extract_json.run. Genome params (result_format, extraction_passes)
    go in the 2nd positional arg; task data (json, path) goes in inputs."""
    inputs = {"json": JSON_IN}
    if path is not None:
        inputs["path"] = path
    return extract_json.run(inputs, params)


class TestExtractJsonEmptyExtractionIsNotPerfect:
    """The core parity defect (verdict re-author clause 3)."""

    def test_empty_extraction_is_not_full_correctness(self):
        r = _run(path="")
        assert r.ok is True, "empty path is still a successful run"
        assert r.output["extracted"] == {}, "precondition: nothing was extracted"
        assert r.correctness < 1.0, (
            "a run that extracted nothing must not claim full correctness; "
            f"got {r.correctness}"
        )

    def test_no_path_key_at_all_is_not_full_correctness(self):
        # Same defect via the other reachable route: caller omits 'path'.
        r = _run(path=None)
        assert r.ok is True
        assert r.output["extracted"] == {}
        assert r.correctness < 1.0, f"got {r.correctness}"

    def test_real_extraction_still_scores_full(self):
        """The fix must not over-correct and penalise genuine work."""
        r = _run(path="a")
        assert r.ok is True
        assert r.output["extracted"] == {"a": {"value": 1, "type": "int"}}
        assert r.correctness == 1.0, "a real extraction must keep full correctness"


class TestParityWithSiblingTools:
    """The codebase already fixes this class; extract_json must match."""

    def test_shape_matches_web_search_penalty(self):
        from alienclaw.fitness.conformance import _load_contracts, conformance_for

        empty = _run(path="")
        full = _run(path="a", result_format=3)
        default_fmt = _run(path="a")  # default result_format=2 -> no "found"
        contracts = _load_contracts()

        empty_graded = conformance_for("extract_json", empty.output or {})
        full_graded = conformance_for("extract_json", full.output or {})
        default_graded = conformance_for("extract_json", default_fmt.output or {})

        # The shared predicate is deliberately left alone per the verdict, and it
        # genuinely cannot rank these cases: the wildcard branch passes an empty
        # map vacuously (graded 1.0), while a real entry at the DEFAULT
        # result_format=2 legitimately omits "found" (graded 0.5). So graded
        # conformance scores "extracted nothing" ABOVE a default-format real
        # extraction. The tool-level correctness is the only lever that can stop
        # the empty case inheriting a perfect score through the bridge's min().
        assert (empty_graded, default_graded, full_graded) == (1.0, 0.5, 1.0), (
            f"shared-predicate baseline must be unchanged by this fix; got "
            f"empty={empty_graded} default={default_graded} full={full_graded}"
        )
        assert full.correctness == 1.0, (
            "the tool-level correctness is the ONLY discriminator between "
            "'extracted nothing' and 'extracted something'; after the fix it "
            f"must be 1.0 for a real extraction. got {full.correctness}"
        )
        assert empty.correctness < full.correctness, (
            "the fix must make the discriminator actually discriminate; "
            f"empty={empty.correctness} full={full.correctness}"
        )

        # The bridge takes min(graded, correctness). Graded conformance alone cannot
        # rank these cases (empty 1.0 vs full 0.5 — the wildcard branch passes
        # vacuously on {}, while a real entry at result_format=2 legitimately
        # omits "found"). The fix's job is to stop the ZERO-extraction run from
        # inheriting a perfect correctness through that min():
        #   before: min(1.0, 1.0) = 1.0  — empty beats real
        #   after:  min(1.0, 0.5) = 0.5  — empty no longer scores perfect
        assert min(empty_graded or 0.0, empty.correctness) < 1.0, (
            "a zero-extraction run must not reach full end-to-end correctness; "
            f"got {min(empty_graded or 0.0, empty.correctness)}"
        )
        assert min(full_graded or 0.0, full.correctness) == 1.0, (
            "a real extraction at result_format=3 must still reach full "
            f"end-to-end correctness; got {min(full_graded or 0.0, full.correctness)}"
        )
        assert contracts["extract_json"], "extract_json contract must still load"

    def test_failure_paths_untouched(self):
        """An actually-failed run stays 0.0 — the fix must not leak into it."""
        r = _run(path="nope.missing")
        assert r.ok is False
        assert r.correctness == 0.0
