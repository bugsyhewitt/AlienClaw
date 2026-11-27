"""Input checks shared by http_get, url_fetch and search_text (no in-tree counterpart).

The reference tools pass params straight to ``int()`` and use ``text``, ``pattern`` and
``headers`` as given, so a wrong type raises out of ``run()`` (ValueError, TypeError,
AttributeError). An agent produces such inputs easily, and a host such as a Flask
handler then gets an exception instead of a result. These helpers raise
``InvalidInputError``, whose message the tool returns as ``RunResult(ok=False, error=...)``.

Accepted values are exactly what ``int()`` accepts (``2``, ``"2"``, ``" 2 "``, ``2.9``,
``True``), so every call that worked before still gets the same number.
"""
from collections.abc import Mapping
from typing import Any

_SHOW_CHARS = 60


class InvalidInputError(ValueError):
    """An input or param has the wrong type. ``str(exc)`` is the tool's error message."""


def _show(value: Any) -> str:
    text = repr(value)
    if len(text) > _SHOW_CHARS:
        text = text[: _SHOW_CHARS - 3] + "..."
    return f"{type(value).__name__} {text}"


def int_param(params: Mapping[str, Any], name: str, default: int) -> int:
    """``int(params.get(name, default))``, or InvalidInputError when int() refuses the value."""
    value = params.get(name, default)
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        raise InvalidInputError(
            f"Invalid param {name!r}: expected an integer, got {_show(value)}"
        ) from None


def str_input(value: Any, name: str) -> str:
    """``value`` itself when it is a str, else InvalidInputError."""
    if not isinstance(value, str):
        raise InvalidInputError(f"Invalid {name!r}: expected a string, got {_show(value)}")
    return value


def headers_input(value: Any) -> Mapping[str, Any]:
    """The ``headers`` input: a mapping with str names; None or empty means no headers.

    (A bad header VALUE is not checked here: http.client rejects it inside the
    request, which the tools already report as a failed request.)
    """
    if not value:
        return {}
    if not isinstance(value, Mapping):
        raise InvalidInputError(f"Invalid 'headers': expected a mapping, got {_show(value)}")
    for name in value:
        if not isinstance(name, str):
            raise InvalidInputError(f"Invalid 'headers': header name {_show(name)} is not a string")
    return value
