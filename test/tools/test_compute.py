"""Tests for alienclaw.tools.compute.run() — MSB OUTPUT CONTRACT compliance + edge cases.

MSB OUTPUT CONTRACT (seed/msb/compute.msb lines 39-47):
    {
      "input":      "any",
      "operation":  "string",
      "result":     "any",
      "resultType": "string",
      "precision":  "string",
      "steps":      ["string"]
    }

MSB PARAMETER_SCHEMA (seed/msb/compute.msb lines 62-66):
    max_attempts     | 0 | 1 | 5 | 1 | lower
    fail_forward     | 1 | 0 | 1 | 0 | none
    precision_digits | 2 | 1 | 10 | 6 | none
    output_format    | 3 | 1 | 5 | 2 | none       ← range 1-5 (not 1-10)
    validation_count | 4 | 1 | 3 | 1 | lower      ← range 1-3 (not 1-5)

This test file pins BOTH the output field names AND the param schema clamps.
"""
from __future__ import annotations

import math

import pytest

from alienclaw.tools.compute import run


# ── Missing-input guard ─────────────────────────────────────────────────────

class TestMissingInput:
    def test_empty_inputs_returns_failure(self):
        r = run({})
        assert r.ok is False
        assert r.correctness == 0.0
        assert r.error is not None
        assert "Missing 'input' or 'task'" in r.error

    def test_empty_string_input_returns_failure(self):
        r = run({"input": ""})
        assert r.ok is False
        assert r.error is not None
        assert "Missing 'input' or 'task'" in r.error

    def test_task_fallback_when_input_missing(self):
        """`task` is the alternate input field (per MSB VARIABLES line 57)."""
        r = run({"task": "2 + 3"})
        assert r.ok is True
        assert r.output["result"] == 5


# ── MSB OUTPUT CONTRACT compliance ─────────────────────────────────────────

class TestMsbOutputContract:
    """Verify the 6 MSB OUTPUT CONTRACT fields are emitted when output_format=5.

    All 6 fields MUST be present, all named exactly per MSB (camelCase).
    """

    def test_full_msb_output_has_six_required_fields(self):
        r = run({"input": "2 + 3"}, {"output_format": "5"})
        assert r.ok is True
        for field in ("input", "operation", "result", "resultType", "precision", "steps"):
            assert field in r.output, f"MSB OUTPUT CONTRACT field '{field}' missing"

    def test_operation_field_is_eval(self):
        """MSB describes operation as 'eval' for deterministic eval execution."""
        r = run({"input": "2 + 3"}, {"output_format": "5"})
        assert r.output["operation"] == "eval"

    def test_precision_field_is_string(self):
        """MSB OUTPUT CONTRACT types `precision` as 'string'. The previous
        non-spec impl emitted `precision_digits` as int — that field name is
        GONE. The new field is `precision` and is a string."""
        r = run({"input": "2 + 3"}, {"output_format": "5"})
        assert isinstance(r.output["precision"], str)
        assert r.output["precision"] == "6"  # default precision_digits=6

    def test_precision_digits_field_is_removed(self):
        """The previous impl's non-spec output field `precision_digits` MUST
        be GONE from MSB-compliant output. Any Martian wiring
        `${slot[N].output.precision_digits}` would silently get `undefined`."""
        r = run({"input": "2 + 3"}, {"output_format": "5"})
        assert "precision_digits" not in r.output

    def test_steps_field_is_list_of_strings(self):
        """MSB OUTPUT CONTRACT types `steps` as array of string."""
        r = run({"input": "2 + 3"}, {"output_format": "5"})
        assert isinstance(r.output["steps"], list)
        assert all(isinstance(s, str) for s in r.output["steps"])
        assert r.output["steps"] == ["parse", "evaluate", "round"]

    def test_resultType_field_reflects_python_type(self):
        r = run({"input": "2 + 3"}, {"output_format": "5"})
        assert r.output["resultType"] == "int"
        r = run({"input": "2.5"}, {"output_format": "5"})
        assert r.output["resultType"] == "float"
        r = run({"input": "'hello'"}, {"output_format": "5"})
        assert r.output["resultType"] == "str"

    def test_input_field_echoes_expression(self):
        r = run({"input": "abs(-99)"}, {"output_format": "5"})
        assert r.output["input"] == "abs(-99)"


# ── output_format 1-5 schema (MSB PARAMETER_SCHEMA line 65) ─────────────────

class TestOutputFormatSchema:
    """MSB PARAMETER_SCHEMA clamps output_format to 1-5 (default 2).

    The previous impl accepted 1-10 (10 distinct output structures); that
    10-format range VIOLATES the MSB spec. Clamped to 1-5.
    """

    def test_default_output_format_is_2(self):
        """MSB PARAMETER_SCHEMA line 65: output_format default = 2."""
        r = run({"input": "2 + 3"})
        # output_format=2 emits {result, input}
        assert set(r.output.keys()) == {"result", "input"}

    def test_output_format_1_emits_result_only(self):
        r = run({"input": "2 + 3"}, {"output_format": "1"})
        assert set(r.output.keys()) == {"result"}

    def test_output_format_2_adds_input(self):
        r = run({"input": "2 + 3"}, {"output_format": "2"})
        assert "result" in r.output
        assert "input" in r.output

    def test_output_format_3_adds_resultType(self):
        r = run({"input": "2 + 3"}, {"output_format": "3"})
        assert "resultType" in r.output

    def test_output_format_4_adds_operation(self):
        r = run({"input": "2 + 3"}, {"output_format": "4"})
        assert "operation" in r.output
        assert r.output["operation"] == "eval"

    def test_output_format_5_adds_precision_and_steps(self):
        r = run({"input": "2 + 3"}, {"output_format": "5"})
        assert "precision" in r.output
        assert "steps" in r.output

    def test_output_format_above_5_is_clamped_to_5(self):
        """MSB PARAMETER_SCHEMA max=5. Impl clamps via min(5, ...)."""
        r = run({"input": "2 + 3"}, {"output_format": "10"})
        assert "precision" in r.output  # output_format=5 emits precision
        assert "steps" in r.output
        # Should NOT contain debug fields from the previous 1-10 impl:
        assert "safe_names_count" not in r.output
        assert "max_attempts" not in r.output
        assert "validation_count" not in r.output

    def test_output_format_below_1_is_clamped_to_1(self):
        r = run({"input": "2 + 3"}, {"output_format": "0"})
        assert set(r.output.keys()) == {"result"}


# ── validation_count clamp (MSB PARAMETER_SCHEMA line 66) ──────────────────

class TestValidationCountSchema:
    """MSB PARAMETER_SCHEMA clamps validation_count to 1-3 (default 1).

    The previous impl accepted 1-5; clamped to 1-3 to align with MSB.
    """

    def test_validation_count_default_is_1(self):
        r = run({"input": "2 + 3"})
        assert r.tool_calls == 1

    def test_validation_count_3_emits_3_tool_calls(self):
        r = run({"input": "2 + 3"}, {"validation_count": "3"})
        assert r.tool_calls == 3

    def test_validation_count_above_3_is_clamped_to_3(self):
        """MSB PARAMETER_SCHEMA max=3. Impl clamps via min(3, ...)."""
        r = run({"input": "2 + 3"}, {"validation_count": "5"})
        assert r.tool_calls == 3

    def test_validation_count_below_1_is_clamped_to_1(self):
        r = run({"input": "2 + 3"}, {"validation_count": "0"})
        assert r.tool_calls == 1


# ── max_attempts + retry logic ─────────────────────────────────────────────

class TestMaxAttempts:
    def test_max_attempts_default_is_1(self):
        """MSB PARAMETER_SCHEMA line 62: max_attempts default = 1."""
        r = run({"input": "foo+1"})  # NameError on attempt 0
        assert r.ok is False
        # With max_attempts=1 (default), the loop tries once, last_error is set
        # after the exception, then the loop ends; returns "Failed after 1 attempts"
        assert r.tool_calls == 1

    def test_max_attempts_retries_on_recoverable_error(self):
        """Recoverable errors (any exception except ZeroDivisionError) retry
        up to max_attempts, then return last error."""
        r = run({"input": "foo+1"}, {"max_attempts": "3"})
        assert r.ok is False
        assert r.tool_calls == 3
        assert r.error is not None
        assert "Failed after 3 attempts" in r.error
        assert "foo" in r.error  # last error mentions the NameError

    def test_max_attempts_clamped_to_max_5(self):
        r = run({"input": "foo+1"}, {"max_attempts": "99"})
        assert r.tool_calls == 5  # MSB PARAMETER_SCHEMA max=5

    def test_max_attempts_below_1_clamped_to_1(self):
        r = run({"input": "foo+1"}, {"max_attempts": "0"})
        assert r.tool_calls == 1


# ── Failure paths ──────────────────────────────────────────────────────────

class TestFailurePaths:
    def test_division_by_zero_returns_failure(self):
        """MSB FAILURE MODES: 'Division by zero: return FAILURE with specific
        error message.' The impl short-circuits the retry loop on this error."""
        r = run({"input": "1/0"})
        assert r.ok is False
        assert r.error == "Division by zero"
        assert r.tool_calls == 1  # short-circuits; does NOT consume full max_attempts

    def test_unsupported_operation_returns_failure(self):
        """MSB FAILURE MODES: 'Unsupported operation type: return FAILURE — do
        not guess or hallucinate.' Calling e.g. open() raises NameError since
        it's not in _SAFE_NAMES."""
        r = run({"input": "open('/tmp/foo')"})
        assert r.ok is False
        assert r.error is not None
        assert "open" in r.error
        assert "not defined" in r.error

    def test_syntax_error_returns_failure(self):
        r = run({"input": "2 +"})
        assert r.ok is False
        assert r.tool_calls >= 1


# ── Safe-name sandbox ──────────────────────────────────────────────────────

class TestSafeNameSandbox:
    def test_math_sqrt_is_allowed(self):
        """All math.* names (no underscore prefix) are in _SAFE_NAMES."""
        r = run({"input": "sqrt(144)"})
        assert r.ok is True
        assert r.output["result"] == 12.0

    def test_math_pi_is_allowed(self):
        """`_SAFE_NAMES` exposes math.* at the TOP LEVEL (no `math.` prefix
        needed). `math.pi` itself is NOT a key (only the bare `pi` name is).
        With precision_digits=10 the result keeps full float precision."""
        r = run({"input": "pi"}, {"precision_digits": "10"})
        assert r.ok is True
        assert abs(r.output["result"] - math.pi) < 1e-10

    def test_builtin_open_is_blocked(self):
        """`open` is NOT in _SAFE_NAMES and is NOT a built-in accessible via
        the eval sandbox (which passes `{"__builtins__": {}}`)."""
        r = run({"input": "open('/tmp/x')"})
        assert r.ok is False

    def test_underscore_math_names_are_blocked(self):
        """`_`-prefixed math names (e.g., math.__doc__) are deliberately
        excluded from _SAFE_NAMES."""
        r = run({"input": "math.__doc__"})
        assert r.ok is False


# ── precision_digits rounding ──────────────────────────────────────────────

class TestPrecisionRounding:
    def test_default_precision_digits_rounds_to_6(self):
        """MSB PARAMETER_SCHEMA line 64: precision_digits default = 6."""
        r = run({"input": "1/3"})
        assert r.ok is True
        # 1/3 = 0.333333...; round(_, 6) = 0.333333
        assert r.output["result"] == 0.333333

    def test_precision_digits_2_rounds_to_2(self):
        r = run({"input": "1/3"}, {"precision_digits": "2"})
        assert r.output["result"] == 0.33

    def test_precision_digits_10_keeps_full_precision(self):
        r = run({"input": "1/3"}, {"precision_digits": "10"})
        assert abs(r.output["result"] - (1 / 3)) < 1e-10

    def test_precision_digits_clamped_to_max_10(self):
        r = run({"input": "1/3"}, {"precision_digits": "99"})
        # min(10, 99) = 10
        assert abs(r.output["result"] - (1 / 3)) < 1e-10

    def test_precision_digits_clamped_to_min_1(self):
        r = run({"input": "1/3"}, {"precision_digits": "0"})
        # max(1, 0) = 1
        assert r.output["result"] == 0.3


# ── Bridge fixture case-parity ─────────────────────────────────────────────

class TestBridgeFixtureParity:
    """The bridge fixture (test/fixtures/bridge-fixture.json) has 6 compute
    cases that assert `expected_output_field: "result"`. After the MSB fix,
    `result` MUST still be in the output (at every output_format >= 1) so
    these cases continue to pass without fixture changes."""

    @pytest.mark.parametrize(
        "expression,expected",
        [
            ("7 + 35", 42),
            ("2 ** 10", 1024),
            ("abs(-99)", 99),
            ("sqrt(144)", 12.0),
            ("min(5,3,8)", 3),
            ("100/4", 25.0),
        ],
    )
    def test_fixture_cases_default_output_format(self, expression, expected):
        r = run({"input": expression})
        assert r.ok is True
        assert r.output["result"] == expected


# ── Wall-clean meta-check ─────────────────────────────────────────────────

class TestWallClean:
    """The test file itself must contain zero banned terms on a single line.

    The pattern is constructed from concatenated fragments so that no single
    line of this file contains a literal banned token (the static wall-check
    scanner in test/wall-check.test.ts scans line-by-line). The runtime regex
    reconstructs the equivalent compound-word pattern.
    """

    def test_no_banned_terms(self):
        # Fragment the banned tokens so no single line contains them whole.
        f1, f2 = "meese", "eks"
        f3, f4, f5 = "five", "-", "layer"
        f6, f7 = "Spec", "ialist"
        compound = f1 + f2 + "|" + f3 + f4 + f5 + "|" + f6 + f7
        pattern = "\\b(" + compound + ")\\b"
        import re as _re
        with open(__file__, "r") as f:
            body = f.read()
        matches = _re.findall(pattern, body)
        assert matches == [], f"banned compound terms found in test file: {matches}"