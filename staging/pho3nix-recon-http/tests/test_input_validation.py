"""Bad input types return ``RunResult(ok=False)`` instead of raising (staged divergence).

The reference tools call ``int()`` on params and use ``text``, ``pattern`` and
``headers`` as given, so ``{"field_count": "x"}``, a list as ``text`` or a string as
``headers`` raised ValueError / TypeError / AttributeError out of ``run()``. The staged
http_get, url_fetch and search_text check these at the same point and return an
``Invalid ...`` error with ``correctness`` 0.0. Values ``int()`` accepts keep working
unchanged. (web_search is kept as is: see test_known_gaps.py.)
"""
from __future__ import annotations

import pytest

from pho3nix_recon_http import http_get, search_text, url_fetch

FETCH = pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])
URL = "http://public.example/"


def _assert_invalid(r, error: str) -> None:
    assert r.ok is False
    assert r.correctness == 0.0
    assert r.error == error


@FETCH
@pytest.mark.parametrize(("params", "error"), [
    ({"field_count": "x"}, "Invalid param 'field_count': expected an integer, got str 'x'"),
    ({"max_attempts": None},
     "Invalid param 'max_attempts': expected an integer, got NoneType None"),
    ({"request_count": [1]}, "Invalid param 'request_count': expected an integer, got list [1]"),
    ({"max_attempts": float("inf")},
     "Invalid param 'max_attempts': expected an integer, got float inf"),
    ({"field_count": float("nan")},
     "Invalid param 'field_count': expected an integer, got float nan"),
    ({"field_count": "1.5"}, "Invalid param 'field_count': expected an integer, got str '1.5'"),
    ({"field_count": "9" * 5000},  # over int()'s 4300-digit limit; repr is shortened
     "Invalid param 'field_count': expected an integer, got str '" + "9" * 56 + "..."),
])
def test_fetch_tools_reject_non_numeric_params(tool, params, error, transport) -> None:
    handler = transport()
    _assert_invalid(tool.run({"url": URL}, params), error)
    assert handler.requests == []


@pytest.mark.parametrize(("tool", "name"), [
    (http_get, "body_preview"), (url_fetch, "content_preview"),
], ids=["http_get", "url_fetch"])
def test_preview_param_is_checked(tool, name, transport) -> None:
    transport()
    r = tool.run({"url": URL}, {name: {}})
    _assert_invalid(r, f"Invalid param {name!r}: expected an integer, got dict {{}}")


@FETCH
@pytest.mark.parametrize(("headers", "error"), [
    ("X-A: 1", "Invalid 'headers': expected a mapping, got str 'X-A: 1'"),
    ([("X-A", "1")], "Invalid 'headers': expected a mapping, got list [('X-A', '1')]"),
    ({1: "v"}, "Invalid 'headers': header name int 1 is not a string"),
])
def test_fetch_tools_reject_bad_headers(tool, headers, error, transport) -> None:
    handler = transport()
    _assert_invalid(tool.run({"url": URL, "headers": headers}), error)
    assert handler.requests == []


@FETCH
@pytest.mark.parametrize("headers", [None, {}, "", [], 0])
def test_empty_headers_still_mean_none(tool, headers, transport) -> None:
    transport()
    assert tool.run({"url": URL, "headers": headers}).ok is True


@FETCH
def test_values_int_accepts_still_work(tool, transport) -> None:
    handler = transport()
    params = {"field_count": "2", "max_attempts": " 2 ", "request_count": 2.9,
              "body_preview": True, "content_preview": "3"}
    r = tool.run({"url": URL}, params)
    assert r.ok is True, r.error
    assert set(r.output) >= {"url", "statusCode", "fetched_url"}
    assert "content" not in r.output  # field_count 2
    assert len(handler.requests) == 2  # request_count int(2.9) == 2


@FETCH
def test_guard_refusal_still_comes_first(tool, transport) -> None:
    """Same order as the reference: a refused URL is reported before any param."""
    transport()
    r = tool.run({"url": "http://127.0.0.1/"}, {"field_count": "x"})
    assert r.ok is False and r.error.startswith("Refusing")


def test_url_fetch_body_with_a_lone_surrogate(transport) -> None:
    handler = transport()
    r = url_fetch.run({"url": URL, "method": "POST", "body": "a\ud800b"})
    _assert_invalid(r, "Invalid 'body': not encodable as UTF-8 (surrogates not allowed)")
    assert handler.requests == []


# ── search_text ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("inputs", "error"), [
    ({"text": ["not", "a", "string"], "pattern": "a"},
     "Invalid 'text': expected a string, got list ['not', 'a', 'string']"),
    ({"text": b"bytes text", "pattern": "a"},
     "Invalid 'text': expected a string, got bytes b'bytes text'"),
    ({"content": 42, "query": "a"}, "Invalid 'text': expected a string, got int 42"),
    ({"text": {"k": "v"}, "pattern": "a"},
     "Invalid 'text': expected a string, got dict {'k': 'v'}"),
    ({"text": "abc", "pattern": 123}, "Invalid 'pattern': expected a string, got int 123"),
    ({"text": "abc", "pattern": ["a"]}, "Invalid 'pattern': expected a string, got list ['a']"),
    ({"text": "abc", "pattern": b"a"}, "Invalid 'pattern': expected a string, got bytes b'a'"),
])
def test_search_text_rejects_non_string_text_or_pattern(inputs, error) -> None:
    _assert_invalid(search_text.run(inputs), error)


@pytest.mark.parametrize(("params", "error"), [
    ({"max_results": "x"}, "Invalid param 'max_results': expected an integer, got str 'x'"),
    ({"context_lines": None},
     "Invalid param 'context_lines': expected an integer, got NoneType None"),
])
def test_search_text_rejects_non_numeric_params(params, error) -> None:
    _assert_invalid(search_text.run({"text": "abc", "pattern": "b"}, params), error)


def test_search_text_numeric_strings_still_work() -> None:
    r = search_text.run({"text": "b\nb\nb", "pattern": "b"}, {"max_results": "2",
                                                                "context_lines": 1.0})
    assert r.ok is True
    assert r.output["totalMatches"] == 3 and len(r.output["matches"]) == 2


def test_search_text_missing_checks_still_come_first() -> None:
    r = search_text.run({"text": [], "pattern": 123})
    assert r.error == "Missing 'text' or 'content' field"


def test_search_text_counts_a_lone_surrogate_instead_of_raising() -> None:
    r = search_text.run({"text": "a\ud800b\nzz", "pattern": "\ud800"})
    assert r.ok is True
    assert r.output["matches"][0]["matchText"] == "\ud800"
