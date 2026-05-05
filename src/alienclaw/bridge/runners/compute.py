import math
from typing import Any
from .types import RunResult

_SAFE_NAMES = {
    "abs": abs, "round": round, "min": min, "max": max, "sum": sum,
    "len": len, "int": int, "float": float, "str": str, "bool": bool,
    "pow": pow, "divmod": divmod,
    **{k: getattr(math, k) for k in dir(math) if not k.startswith("_")},
}


def run(inputs: dict[str, Any]) -> RunResult:
    task = inputs.get("task", "")
    expression = inputs.get("input", task)
    if not expression:
        return RunResult(ok=False, error="Missing 'input' or 'task' field", correctness=0.0)
    try:
        result = eval(str(expression), {"__builtins__": {}}, _SAFE_NAMES)  # noqa: S307
    except ZeroDivisionError:
        return RunResult(ok=False, error="Division by zero", correctness=0.0)
    except Exception as exc:
        return RunResult(ok=False, error=f"Compute error: {exc}", correctness=0.0)
    result_type = type(result).__name__
    return RunResult(
        ok=True,
        output={
            "input": expression,
            "operation": "eval",
            "result": result,
            "resultType": result_type,
        },
        correctness=1.0,
    )
