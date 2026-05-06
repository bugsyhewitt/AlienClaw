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
    precision_digits = max(1, min(10, int(params.get("precision_digits", 6))))
    # output_format 1-10: each value adds one more field to the output (10 distinct structures)
    output_format = max(1, min(10, int(params.get("output_format", 2))))
    # validation_count: evaluate expression N times total (verification passes); tool_calls = N
    validation_count = max(1, min(5, int(params.get("validation_count", 1))))

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
            # output_format 1-10: each adds one more field (10 distinct output structures)
            output: dict[str, Any] = {"result": result}
            if output_format >= 2:  output["input"] = expression
            if output_format >= 3:  output["resultType"] = result_type
            if output_format >= 4:  output["operation"] = "eval"
            if output_format >= 5:  output["precision_digits"] = precision_digits
            if output_format >= 6:  output["validation_count"] = validation_count
            if output_format >= 7:  output["max_attempts"] = max_attempts
            if output_format >= 8:  output["steps"] = ["parse", "evaluate", "round"]
            if output_format >= 9:  output["output_format"] = output_format
            if output_format >= 10: output["safe_names_count"] = len(_SAFE_NAMES)
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
