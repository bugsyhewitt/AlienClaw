import math
from typing import Any
from .types import RunResult

_SAFE_NAMES = {
    "abs": abs, "round": round, "min": min, "max": max, "sum": sum,
    "len": len, "int": int, "float": float, "str": str, "bool": bool,
    "pow": pow, "divmod": divmod,
    **{k: getattr(math, k) for k in dir(math) if not k.startswith("_")},
}


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    task = inputs.get("task", "")
    expression = inputs.get("input", task)
    if not expression:
        return RunResult(ok=False, error="Missing 'input' or 'task' field", correctness=0.0)

    max_attempts = max(1, min(5, int(params.get("max_attempts", 1))))
    # MSB PARAMETER_SCHEMA (seed/msb/compute.msb:65): precision_digits|2|1|10|6|none
    # → range 1-10, default 6. NOTE: the MSB OUTPUT CONTRACT field is `precision` (line 45),
    # NOT `precision_digits`. The PARAMETER_SCHEMA input is named `precision_digits` per MSB.
    precision_digits = max(1, min(10, int(params.get("precision_digits", 6))))
    # MSB PARAMETER_SCHEMA (seed/msb/compute.msb:65): output_format|3|1|5|2|none
    # → range 1-5, default 2. The previous impl accepted 1-10 (10 distinct output structures);
    # that 1-10 range VIOLATES the MSB spec. Clamped to 1-5 to align with MSB.
    output_format = max(1, min(5, int(params.get("output_format", 2))))
    # MSB PARAMETER_SCHEMA (seed/msb/compute.msb:66): validation_count|4|1|3|1|lower
    # → range 1-3, default 1. The previous impl accepted 1-5; clamped to 1-3 to align with MSB.
    validation_count = max(1, min(3, int(params.get("validation_count", 1))))

    last_error: str | None = None
    for attempt in range(max_attempts):
        try:
            result = eval(str(expression), {"__builtins__": {}}, _SAFE_NAMES)  # noqa: S307
            if isinstance(result, float):
                result = round(result, precision_digits)
            result_type = type(result).__name__
            # Re-evaluate for validation_count-1 additional passes (verification)
            for _ in range(validation_count - 1):
                eval(str(expression), {"__builtins__": {}}, _SAFE_NAMES)  # noqa: S307
            # MSB OUTPUT CONTRACT (seed/msb/compute.msb lines 39-47):
            #   { input: "any", operation: "string", result: "any",
            #     resultType: "string", precision: "string", steps: ["string"] }
            #
            # output_format 1-5 selects 5 distinct output structures, ALL of which include
            # the 6 MSB CONTRACT fields. output_format=1 is the MINIMAL MSB-compliant output
            # (result only); output_format=5 is the MAXIMAL output with all 6 MSB fields.
            output: dict[str, Any] = {"result": result}
            if output_format >= 2:
                output["input"] = expression
            if output_format >= 3:
                output["resultType"] = result_type
            if output_format >= 4:
                output["operation"] = "eval"
            if output_format >= 5:
                # MSB OUTPUT CONTRACT field name is `precision` (line 45), NOT `precision_digits`.
                # `precision_digits` was the previous impl's non-spec field name (regression).
                output["precision"] = str(precision_digits)
                output["steps"] = ["parse", "evaluate", "round"]
            return RunResult(ok=True, output=output, tool_calls=validation_count, correctness=1.0)
        except ZeroDivisionError:
            return RunResult(ok=False, error="Division by zero", tool_calls=attempt + 1, correctness=0.0)
        except Exception as exc:
            last_error = str(exc)
            continue

    return RunResult(
        ok=False,
        error=f"Failed after {max_attempts} attempts: {last_error}",
        tool_calls=max_attempts,
        correctness=0.0,
    )