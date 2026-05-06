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

    last_error: str | None = None
    for attempt in range(max_attempts):
        try:
            result = eval(str(expression), {"__builtins__": {}}, _SAFE_NAMES)  # noqa: S307
            # Apply precision rounding for float results
            if isinstance(result, float):
                result = round(result, precision_digits)
            result_type = type(result).__name__
            return RunResult(
                ok=True,
                output={
                    "input": expression,
                    "operation": "eval",
                    "result": result,
                    "resultType": result_type,
                    "precision_digits": precision_digits,
                },
                tool_calls=attempt + 1,
                correctness=1.0,
            )
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
