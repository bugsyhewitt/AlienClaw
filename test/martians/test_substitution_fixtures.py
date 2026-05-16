import json, pytest
from pathlib import Path
from alienclaw.martians.substitution import substitute

FIXTURE_PATH = Path("test/fixtures/martian-substitution-fixtures.json")


def _load():
    return json.loads(FIXTURE_PATH.read_text())["cases"]


@pytest.mark.parametrize("case", _load(), ids=lambda c: c["name"])
def test_substitution_fixture(case):
    kind = case["kind"]
    if kind == "substitute":
        result = substitute(case["template"], case["slot_outputs"], case["campaign_inputs"])
        assert result == case["expected"]
    elif kind == "substitute_error":
        with pytest.raises(ValueError, match=case["expected_error"]):
            substitute(case["template"], case["slot_outputs"], case["campaign_inputs"])
    else:
        pytest.skip(f"Unknown kind: {kind}")
