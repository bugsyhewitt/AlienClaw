"""The JSON Schema accepts the examples and rejects what the validator rejects (when expressible).

Skipped entirely when jsonschema is not importable: the validator itself is stdlib + PyYAML.
"""

from __future__ import annotations

import copy
import json

import pytest
import validate_bounds as vb
import yaml
from conftest import EXAMPLES, SCHEMA

jsonschema = pytest.importorskip("jsonschema")

EXAMPLE_FILES = sorted(EXAMPLES.glob("*.tool.yaml"))


def load(path):
    return yaml.safe_load(path.read_text())


@pytest.fixture(scope="module")
def schema_validator():
    schema = json.loads(SCHEMA.read_text())
    cls = jsonschema.validators.validator_for(schema)
    cls.check_schema(schema)
    assert cls is jsonschema.Draft202012Validator
    return cls(schema)


@pytest.mark.parametrize("path", EXAMPLE_FILES, ids=lambda p: p.name)
def test_example_passes_json_schema(schema_validator, path):
    errors = list(schema_validator.iter_errors(load(path)))
    assert errors == [], [e.message for e in errors]


def _bounded(spec_type: str, **bounds) -> dict:
    base = {"direction": "neutral", "evolvable": True, "rationale": "r", "min": 1, "max": 4}
    base.update(bounds)
    base = {k: v for k, v in base.items() if v is not None}
    return {"name": "t", "params": {"p": {"type": spec_type, "bounds": base}}}


SCHEMA_EXPRESSIBLE_INVALID = [
    _bounded("integer", direction="maximize"),
    _bounded("integer", evolvable="yes"),
    _bounded("integer", rationale=""),
    _bounded("integer", rationale=None),
    _bounded("integer", min=None, max=None),          # evolvable without a range
    _bounded("integer", max=None),                    # min without max
    _bounded("integer", min=1.5),
    _bounded("integer", step=0),
    _bounded("integer", maximum=4),                   # unknown key inside bounds
    _bounded("string"),                               # string without value_template
    _bounded("string", value_template="{value}{value}"),
    _bounded("boolean"),
    {"name": "t", "params": ["p"]},
]


@pytest.mark.parametrize("doc", SCHEMA_EXPRESSIBLE_INVALID)
def test_schema_and_validator_both_reject(schema_validator, doc):
    assert not vb.validate_document(copy.deepcopy(doc)).ok
    assert list(schema_validator.iter_errors(doc)), "schema accepted an invalid document"


def test_schema_and_validator_both_accept_no_bounds(schema_validator):
    for doc in ({"name": "t"}, {"name": "t", "params": None},
                {"name": "t", "params": {"p": {"type": "integer", "minimum": 1}}}):
        assert vb.validate_document(doc).ok
        assert list(schema_validator.iter_errors(doc)) == []
