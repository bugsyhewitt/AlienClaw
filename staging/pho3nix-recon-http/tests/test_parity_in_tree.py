"""Parity between the staged tools and the in-tree tools they were lifted from.

Puts ``<repo>/src`` on sys.path (or ``$PHO3NIX_RECON_HTTP_REFERENCE_SRC``), imports
the in-tree tools, runs the SAME mocked inputs through both sides and asserts the
same outcome: every RunResult field (or the same exception type and message). For
the fetch tools the sequence of requests reaching the transport (URL, host, method,
headers, body) must also match, and for web_search the backend URLs and timeouts.

Declared differences are asserted explicitly rather than tolerated, each by its own
test, and their inputs are kept out of the agreement corpora. Each test fails on
purpose if the in-tree side starts behaving like the staged one:

- CGNAT: the staged guard (agent_tool_sandbox) blocks RFC 6598 100.64.0.0/10 and the
  in-tree guard does not (see agent_tool_sandbox's PROVENANCE.json).
- Refusal text (agent_tool_sandbox PR-03 and G7): where the verdict depends on the DNS
  answer, the staged error is "Refusing hostname '<host>': not an allowed destination",
  never the resolved address, and it reads the same for "resolves internally" and "does
  not resolve"; localhost names are refused by name before DNS ("reserved loopback name
  (RFC 6761)"). The in-tree error names the address. Same verdicts, different text.
- DNS pinning (http_get, url_fetch): the staged tools resolve once and dial only the
  vetted addresses; the in-tree tools resolve again at connect time (rebinding).
- Env proxies: the staged pinned opener uses none; the in-tree opener honors them.
- Host header: the staged tools refuse one that names another host; the in-tree
  tools send it.
- Bad input types (http_get, url_fetch, search_text): the in-tree tools raise; the
  staged ones return ok=False with an "Invalid ..." error.
- search_text off the main thread: the in-tree tool raises ValueError; the staged
  one returns its normal result.

Network-free: both sides share the conftest fake DNS and connect stub. Each side gets
its own in-process transport (or fake urlopen), built fresh for every call so that
stateful responders replay identically. Skips cleanly when the in-tree tools are not
importable, so the package stays liftable.
"""
from __future__ import annotations

import copy
import dataclasses
import inspect
import json
import os
import re
import socket
import sys
import threading
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock
from urllib.parse import urlsplit

import pytest

from conftest import PUBLIC_V4, Reply, install_transport
from pho3nix_recon_http import TOOL_REGISTRY, http_get, limits, search_text, url_fetch, web_search
from pho3nix_recon_http.web_search import SEARCH_URL_ENV


def _reference_src() -> Path | None:
    env = os.environ.get("PHO3NIX_RECON_HTTP_REFERENCE_SRC")
    if env:
        return Path(env)
    parents = Path(__file__).resolve().parents  # tests, package, staging, repo
    return parents[3] / "src" if len(parents) > 3 else None


_SRC = _reference_src()
if _SRC is not None and _SRC.is_dir() and str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
try:
    from alienclaw.tools import http_get as ref_http_get
    from alienclaw.tools import limits as ref_limits
    from alienclaw.tools import search_text as ref_search_text
    from alienclaw.tools import url_fetch as ref_url_fetch
    from alienclaw.tools import web_search as ref_web_search
    from alienclaw.tools.registry import TOOL_REGISTRY as REF_REGISTRY
except Exception as exc:  # ImportError, or anything the reference package raises on import
    pytest.skip(f"in-tree tools not importable ({exc!r})", allow_module_level=True)

FETCH = {"http_get": (http_get, ref_http_get), "url_fetch": (url_fetch, ref_url_fetch)}
_NO_PARAMS = object()


def _outcome(fn, inputs, params):
    """Call fn on private copies; reduce the result (or the exception) to comparable data."""
    inputs = copy.deepcopy(inputs)
    try:
        r = fn(inputs) if params is _NO_PARAMS else fn(inputs, copy.deepcopy(params))
    except Exception as exc:
        return ("raised", type(exc).__name__, str(exc))
    fields = tuple(f.name for f in dataclasses.fields(r))
    return ("result", type(r).__name__, fields, dataclasses.asdict(r))


# ═══════════════════════════════════════════════════════════════════════════
# Static surface
# ═══════════════════════════════════════════════════════════════════════════


def test_registry_and_signatures_match() -> None:
    assert sorted(TOOL_REGISTRY) == ["http_get", "search_text", "url_fetch", "web_search"]
    for name, fn in TOOL_REGISTRY.items():
        ref = REF_REGISTRY[name]
        got = [(p.name, p.kind, p.default) for p in inspect.signature(fn).parameters.values()]
        want = [(p.name, p.kind, p.default) for p in inspect.signature(ref).parameters.values()]
        assert got == want, name


@pytest.mark.parametrize(("staged", "ref", "names"), [
    (http_get, ref_http_get, ["_TIMEOUT_S", "_MAX_RESPONSE_BYTES"]),
    (url_fetch, ref_url_fetch, ["_TIMEOUT_S", "_MAX_RESPONSE_BYTES", "_FIELDS"]),
    (web_search, ref_web_search, ["_TIMEOUT_S", "_SEARCH_BASE"]),
    (search_text, ref_search_text,
     ["_MAX_TEXT_BYTES", "_MAX_PATTERN_LEN", "_REGEX_TIMEOUT_S", "_HAS_SIGALRM"]),
    (limits, ref_limits, ["MAX_TOOL_IO_BYTES"]),
], ids=["http_get", "url_fetch", "web_search", "search_text", "limits"])
def test_module_constants_match(staged, ref, names) -> None:
    for name in names:
        assert getattr(staged, name) == getattr(ref, name), name


def test_search_url_env_name_matches() -> None:
    # Behavior is pinned by test_web_search_agrees_on_backend_config (both sides read the
    # variable the harness sets); this pins the name itself.
    assert SEARCH_URL_ENV == "ALIENCLAW_SEARCH_URL"


# ═══════════════════════════════════════════════════════════════════════════
# http_get / url_fetch
# ═══════════════════════════════════════════════════════════════════════════


class _Seq:
    """Responder that plays its steps in order (the last repeats); a step may raise."""

    def __init__(self, *steps) -> None:
        self.steps = steps
        self.i = 0

    def __call__(self, req):
        step = self.steps[min(self.i, len(self.steps) - 1)]
        self.i += 1
        if isinstance(step, BaseException):
            raise step
        return step


JSON_BODY = b'{"hello":"world"}'


def _ok():
    return Reply(200, {"Content-Type": "application/json", "Content-Length": "17"}, JSON_BODY)


RESPONDERS = {
    "json": lambda: _Seq(_ok()),
    "lines": lambda: _Seq(Reply(200, {"Content-Type": "text/plain"},
                                b"".join(b"line%d\n" % i for i in range(1, 12)))),
    "utf8": lambda: _Seq(Reply(200, {"Content-Type": "text/plain; charset=utf-8",
                                     "Content-Length": "5"}, "café".encode())),
    "latin1": lambda: _Seq(Reply(200, {"Content-Type": "text/plain"},
                                 b"caf\xe9 r\xe9sum\xe9\nl2\nl3")),
    "big": lambda: _Seq(Reply(200, {"Content-Length": str(5 * 1024 * 512)},
                              b"x" * (5 * 1024 * 512))),
    "bad_length": lambda: _Seq(Reply(200, {"Content-Length": "abc"}, b"a\nb")),
    "empty_204": lambda: _Seq(Reply(204, {}, b"")),
    "404": lambda: _Seq(Reply(404, {"Content-Type": "text/plain"}, b"Not Found")),
    "500": lambda: _Seq(Reply(500, {}, b"")),
    "302_file": lambda: _Seq(Reply(302, {"Location": "file:///etc/passwd"}, b"")),
    "307_internal": lambda: _Seq(Reply(307, {"Location": "http://169.254.169.254/"}, b"")),
    "transient_then_ok": lambda: _Seq(urllib.error.URLError("refused"),
                                      urllib.error.URLError("refused"), _ok()),
    "always_transient": lambda: _Seq(urllib.error.URLError("down")),
    "timeout": lambda: _Seq(TimeoutError("timed out")),
    "ok_then_500": lambda: _Seq(_ok(), Reply(500, {}, b"")),
}

FETCH_PARAMS = [
    _NO_PARAMS, {}, {"field_count": 1}, {"field_count": 2}, {"field_count": 4},
    {"field_count": 5}, {"field_count": -5}, {"field_count": 99}, {"request_count": 3},
    {"request_count": 99}, {"max_attempts": 3}, {"max_attempts": 2, "request_count": 2},
    {"body_preview": 0, "content_preview": 0}, {"body_preview": 3, "content_preview": 7},
    {"body_preview": 99, "content_preview": 99}, {"max_attempts": "2"},
]
# Declared divergence (bad input types): in-tree raises, staged returns an error.
BAD_FETCH_PARAMS = [
    {"field_count": "x"}, {"max_attempts": None}, {"request_count": [2]},
    {"body_preview": "1.5", "content_preview": "1.5"}, {"field_count": float("inf")},
]
BAD_FETCH_INPUTS = [
    {"url": "http://public.example/p", "headers": "X-A: 1"},
    {"url": "http://public.example/p", "headers": [("X-A", "1")]},
    {"url": "http://public.example/p", "headers": {1: "v"}},
]

CGNAT_URLS = [
    "http://100.64.0.1/", "http://100.127.255.254/x", "http://cgnat.example/",
    "http://mapped-cgnat.example/", "http://[::ffff:100.64.0.1]/",
]
# Declared divergence (refusal text, PR-03): both sides refuse after DNS; the staged error is
# generic, the in-tree one names the resolved address (or says "unresolvable").
GENERIC_REFUSAL_URLS = [
    "http://127.0.0.1/", "http://127.1/", "http://0x7f.0.0.1/", "http://2130706433/",
    "http://0/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fe80::1]/",
    "http://[fc00::1]/", "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/", "http://mixed.example/",
    "http://mapped-metadata.example/", "http://ula.example/", "http://nxdomain.example/",
]
# Declared divergence (G7): staged refuses the name before DNS; in-tree via its 127.0.0.1 answer.
LOOPBACK_NAME_URLS = ["http://localhost/"]
MESSAGE_DIVERGENT_URLS = GENERIC_REFUSAL_URLS + LOOPBACK_NAME_URLS  # a list: URLS has lists
_IP_TEXT = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b|[0-9a-f]*:[0-9a-f]*:[0-9a-f:.]*", re.I)
_OLD_REFUSAL = re.compile(
    r"Refusing blocked IP \S+ \(resolved from '.*'\)|Refusing unresolvable hostname '.*'"
)


def _generic_refusal(url: str) -> str:
    return f"Refusing hostname {urlsplit(url).hostname!r}: not an allowed destination"


def _names_no_address(error: str, url: str) -> bool:
    """No IP in ``error`` apart from the URL's own host (a literal the caller supplied)."""
    return not _IP_TEXT.search(error.replace(repr(urlsplit(url).hostname), ""))

URLS = [
    # fetched (after canonicalisation)
    "http://public.example/", "https://public.example/a?b=c#d",
    "HTTP://Public.Example:080/a;p?q=1#f", "https://bücher.example/x", "http://public6.example/",
    "http://dual.example/", "http://[2606:4700:4700::1111]:8443/", "http://93.184.216.34/",
    "http://public.example./", "http://public.example:/", "http://my_host.example/",
    # missing / non-string
    "", None, 123, ["http://public.example/"],
    # scheme / malformed
    "file:///etc/passwd", "ftp://public.example/", "gopher://public.example:70/_x",
    "data:text/plain,hi", "javascript:alert(1)", "http://", "http:///x", "//public.example/",
    "http://[::1/", "http://public.example:99999/",
    # internal literals and names
    "http://127.0.0.1/", "http://127.1/", "http://0x7f.0.0.1/", "http://2130706433/",
    "http://0/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fe80::1]/",
    "http://[fc00::1]/", "http://169.254.169.254/latest/meta-data/", "http://localhost/",
    "http://metadata.google.internal/", "http://mixed.example/", "http://mapped-metadata.example/",
    "http://ula.example/", "http://nxdomain.example/",
    # parse differentials
    "http://user:pw@public.example/", "http://127.0.0.1@public.example/",
    "http://%31%32%37.0.0.1/", "http://public%2eexample/", "http://a.x:b.x:80/",
    "http://public.example:80:80/", "http://127.0.0.1\\@public.example/",
    "http://public.example/a b", " http://public.example/", "http://public.example\t/",
    "http://a!b.example/",
    *CGNAT_URLS,
]

U = "http://public.example/p"
INPUT_VARIANTS = [
    {"url": U, "headers": {"X-Test": "1", "User-Agent": "recon/1"}},
    {"url": U, "headers": None},
    {"url": U, "headers": {}},
    {"url": U, "headers": {"Host": "public.example"}},
    {"url": U, "method": "post", "body": {"a": 1}},
    {"url": U, "method": "PUT", "body": 0},
    {"url": U, "method": "HEAD"},
    {"url": U, "body": ""},
]


def _fetch_both(name, inputs, params, responder="json"):
    """[(outcome, requests seen)] for the staged then the in-tree tool."""
    out = []
    for mod in FETCH[name]:
        with pytest.MonkeyPatch.context() as mp:
            handler = install_transport(mp, [mod], RESPONDERS[responder]())
            outcome = _outcome(mod.run, inputs, params)
        out.append((outcome, handler.requests))
    return out


@pytest.mark.parametrize("name", sorted(FETCH))
def test_fetch_tools_agree_on_url_corpus(name) -> None:
    mismatches = []
    for url in URLS:
        if url in CGNAT_URLS or url in MESSAGE_DIVERGENT_URLS:
            continue
        (staged, staged_reqs), (ref, ref_reqs) = _fetch_both(name, {"url": url}, {})
        if (staged, staged_reqs) != (ref, ref_reqs):
            mismatches.append((url, staged, ref, staged_reqs, ref_reqs))
    assert not mismatches, mismatches


@pytest.mark.parametrize("name", sorted(FETCH))
@pytest.mark.parametrize("url", CGNAT_URLS)
def test_cgnat_is_the_declared_divergence(name, url) -> None:
    (staged, staged_reqs), (ref, ref_reqs) = _fetch_both(name, {"url": url}, {})
    staged_result, ref_result = staged[3], ref[3]
    assert staged_result["ok"] is False
    assert staged_result["error"] == _generic_refusal(url)  # PR-03: no address in the text
    assert _names_no_address(staged_result["error"], url)
    assert staged_reqs == []
    assert ref_result["ok"] is True, "in-tree now blocks CGNAT: drop this divergence"
    assert len(ref_reqs) == 1


@pytest.mark.parametrize("name", sorted(FETCH))
@pytest.mark.parametrize("url", MESSAGE_DIVERGENT_URLS)
def test_refusal_text_is_the_declared_divergence(name, url) -> None:
    (staged, staged_reqs), (ref, ref_reqs) = _fetch_both(name, {"url": url}, {})
    staged_result, ref_result = dict(staged[3]), dict(ref[3])
    staged_error, ref_error = staged_result.pop("error"), ref_result.pop("error")
    # Same verdict and every other field the same; nothing reached either transport.
    assert staged[:3] == ref[:3] and staged_result == ref_result
    assert staged_result["ok"] is False and staged_reqs == ref_reqs == []
    if url in LOOPBACK_NAME_URLS:
        host = urlsplit(url).hostname
        assert staged_error == f"Refusing hostname {host!r}: reserved loopback name (RFC 6761)"
        assert ref_error.startswith("Refusing blocked IP 127.0.0.1 "), ref_error
    else:
        assert staged_error == _generic_refusal(url)
        assert _OLD_REFUSAL.fullmatch(ref_error), (
            f"in-tree no longer names the address ({ref_error!r}): drop this divergence"
        )
    assert _names_no_address(staged_error, url), staged_error
    assert staged_error != ref_error


@pytest.mark.parametrize("name", sorted(FETCH))
@pytest.mark.parametrize("responder", sorted(RESPONDERS))
def test_fetch_tools_agree_on_responses_and_params(name, responder) -> None:
    mismatches = []
    for params in FETCH_PARAMS:
        (staged, staged_reqs), (ref, ref_reqs) = _fetch_both(name, {"url": U}, params, responder)
        if (staged, staged_reqs) != (ref, ref_reqs):
            mismatches.append((params, staged, ref))
    assert not mismatches, mismatches


@pytest.mark.parametrize("name", sorted(FETCH))
def test_fetch_tools_agree_on_input_variants(name) -> None:
    mismatches = []
    for inputs in INPUT_VARIANTS:
        for responder in ("json", "404", "302_file"):
            (staged, s_reqs), (ref, r_reqs) = _fetch_both(name, inputs, {}, responder)
            if (staged, s_reqs) != (ref, r_reqs):
                mismatches.append((inputs, responder, staged, ref, s_reqs, r_reqs))
    assert not mismatches, mismatches


def _is_invalid_input(outcome) -> bool:
    return (outcome[0] == "result" and outcome[3]["ok"] is False
            and outcome[3]["correctness"] == 0.0 and outcome[3]["error"].startswith("Invalid "))


def _ref_raised(outcome) -> bool:
    return outcome[0] == "raised" and outcome[1] in ("TypeError", "ValueError",
                                                     "AttributeError", "OverflowError")


@pytest.mark.parametrize("name", sorted(FETCH))
def test_bad_input_types_are_a_declared_divergence(name) -> None:
    cases = [({"url": U}, p) for p in BAD_FETCH_PARAMS] + [(i, {}) for i in BAD_FETCH_INPUTS]
    for inputs, params in cases:
        (staged, staged_reqs), (ref, _ref_reqs) = _fetch_both(name, inputs, params)
        assert _is_invalid_input(staged), (inputs, params, staged)
        assert staged_reqs == []
        assert _ref_raised(ref), ("in-tree no longer raises: drop this divergence", ref)


@pytest.mark.parametrize("name", sorted(FETCH))
def test_foreign_host_header_is_a_declared_divergence(name) -> None:
    inputs = {"url": U, "headers": {"Host": "internal.vhost"}}
    (staged, staged_reqs), (ref, ref_reqs) = _fetch_both(name, inputs, {})
    assert staged[3]["ok"] is False
    assert staged[3]["error"] == (
        "Refusing Host header 'internal.vhost': the pinned request is for 'public.example'"
    )
    assert staged_reqs == []
    assert ref[3]["ok"] is True, "in-tree now refuses a foreign Host: drop this divergence"
    assert [r.header("Host") for r in ref_reqs] == ["internal.vhost"]


def _dials(mod, monkeypatch, url="http://rebind.example/"):
    """Run mod's tool with NO transport; return the addresses it tried to connect to."""
    attempts: list = []

    def connect(self, address, *args, **kwargs):
        attempts.append(address[:2])
        raise ConnectionRefusedError(111, "Connection refused")

    with monkeypatch.context() as mp:
        mp.setattr(socket.socket, "connect", connect)
        mod.run({"url": url})
    return attempts


@pytest.mark.parametrize("name", sorted(FETCH))
def test_dns_pinning_is_a_declared_divergence(name, monkeypatch) -> None:
    staged_mod, ref_mod = FETCH[name]
    results = []
    for mod in (staged_mod, ref_mod):
        answers = iter([PUBLIC_V4])  # public for the check, loopback afterwards

        def rebinding(host, port, family=0, type=0, proto=0, flags=0, answers=answers):
            addr = next(answers, "127.0.0.1")
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, port or 0))]

        monkeypatch.setattr(socket, "getaddrinfo", rebinding)
        results.append(_dials(mod, monkeypatch))
    staged, ref = results
    assert staged == [(PUBLIC_V4, 80)]
    assert ref == [("127.0.0.1", 80)], "in-tree now pins: drop this divergence"


@pytest.mark.parametrize("name", sorted(FETCH))
def test_env_proxy_is_a_declared_divergence(name, monkeypatch, fake_dns) -> None:
    monkeypatch.setenv("http_proxy", "http://proxy.example:3128")
    fake_dns.records["proxy.example"] = ["198.51.100.7"]
    staged_mod, ref_mod = FETCH[name]
    url = "http://public.example/"
    assert _dials(staged_mod, monkeypatch, url) == [(PUBLIC_V4, 80)]
    assert _dials(ref_mod, monkeypatch, url) == [("198.51.100.7", 3128)], (
        "in-tree no longer uses the env proxy: drop this divergence"
    )


# ═══════════════════════════════════════════════════════════════════════════
# web_search
# ═══════════════════════════════════════════════════════════════════════════


class _Backend:
    """Stands in for urllib.request.urlopen; steps are JSON bytes or exceptions."""

    def __init__(self, *steps) -> None:
        self.steps = steps
        self.i = 0
        self.calls: list = []

    def __call__(self, url, timeout=None):
        self.calls.append((url, timeout))
        step = self.steps[min(self.i, len(self.steps) - 1)]
        self.i += 1
        if isinstance(step, BaseException):
            raise step
        resp = MagicMock()
        resp.read.return_value = step
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp


def _results(n: int, start: int = 1) -> list[dict]:
    return [{"title": f"T{i}", "href": f"https://r.example/{i}", "body": f"B{i}"}
            for i in range(start, start + n)]


def _503():
    return urllib.error.HTTPError("http://stub.test/search", 503, "Service Unavailable", {},
                                  BytesIO(b""))


BACKENDS = {
    "list15": lambda: _Backend(json.dumps(_results(15)).encode()),
    "dict_results": lambda: _Backend(json.dumps({"results": _results(4)}).encode()),
    "dupes_and_junk": lambda: _Backend(json.dumps(
        [*_results(2), *_results(2), {"title": "no href"}, {}, "str", 7, None]).encode()),
    "empty": lambda: _Backend(b"[]"),
    "null": lambda: _Backend(b"null"),
    "results_int": lambda: _Backend(b'{"results": 42}'),
    "not_json": lambda: _Backend(b"<html>"),
    "http_503": lambda: _Backend(_503()),
    "transient_then_ok": lambda: _Backend(urllib.error.URLError("down"),
                                          json.dumps(_results(3)).encode()),
    "always_down": lambda: _Backend(urllib.error.URLError("down")),
    "ok_then_503": lambda: _Backend(json.dumps(_results(3)).encode(), _503()),
}

WS_INPUTS = [
    {"query": "test"}, {"task": "alt query"}, {"query": "a b&c=d/é?"}, {"query": 123},
    {"query": ""}, {}, {"query": "q", "num_results": 3}, {"query": "q", "num_results": -3},
    {"query": "q", "num_results": 50}, {"query": "q", "num_results": "x"},
]
WS_PARAMS = [
    _NO_PARAMS, {"page_count": 2}, {"page_count": 9}, {"max_results": 0},
    {"max_results": 3, "page_count": 3}, {"max_results": 99}, {"max_attempts": 3},
    {"max_attempts": 3, "page_count": 2},
]
STUB = "http://stub.test/search"


def _search_both(backend, inputs, params, env=STUB):
    out = []
    for mod in (web_search, ref_web_search):
        fake = BACKENDS[backend]()
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(urllib.request, "urlopen", fake)
            if env is None:
                mp.delenv(SEARCH_URL_ENV, raising=False)
            else:
                mp.setenv(SEARCH_URL_ENV, env)
            outcome = _outcome(mod.run, inputs, params)
        out.append((outcome, fake.calls))
    return out


@pytest.mark.parametrize("backend", sorted(BACKENDS))
def test_web_search_agrees(backend) -> None:
    mismatches = []
    for inputs in WS_INPUTS:
        for params in WS_PARAMS:
            staged, ref = _search_both(backend, inputs, params)
            if staged != ref:
                mismatches.append((inputs, params, staged, ref))
    assert not mismatches, mismatches


@pytest.mark.parametrize("env", [None, "", "   ", f"  {STUB}  ", STUB])
def test_web_search_agrees_on_backend_config(env) -> None:
    mismatches = []
    for inputs in WS_INPUTS:
        staged, ref = _search_both("list15", inputs, {"page_count": 2}, env)
        if staged != ref:
            mismatches.append((inputs, staged, ref))
    assert not mismatches, mismatches


# ═══════════════════════════════════════════════════════════════════════════
# search_text (pure)
# ═══════════════════════════════════════════════════════════════════════════

TEXT = "alpha foo\nBeta FOO bar\n\ngamma f.o\nfoo*?\n" + "\n".join(
    f"line {i} foo" for i in range(12)
)
ST_INPUTS = [
    {"text": TEXT, "pattern": "foo"},
    {"content": TEXT, "query": "FOO"},
    {"text": TEXT, "pattern": "foo", "case_sensitive": True},
    {"text": TEXT, "pattern": r"f.o", "regex": True},
    {"text": TEXT, "pattern": r"f.o", "flavor": "regex"},
    {"text": TEXT, "pattern": "f.o"},
    {"text": TEXT, "pattern": "*foo", "flavor": "glob"},
    {"text": TEXT, "pattern": "line ? foo", "flavor": "glob"},
    {"text": TEXT, "pattern": "foo", "flavor": "bogus"},
    {"text": TEXT, "pattern": "[unclosed", "regex": True},
    {"text": TEXT, "pattern": "x" * 200},
    {"text": TEXT, "pattern": "x" * 201},
    {"text": "", "pattern": "foo"},
    {"text": TEXT, "pattern": ""},
    {"text": TEXT, "pattern": "(?i)FOO", "regex": True, "case_sensitive": True},
    {"text": "café\nCAFÉ\nstraße", "pattern": "CAFÉ"},
    {"text": "a\r\nfoo\r\nb", "pattern": "foo"},
    {"text": TEXT, "pattern": "^$", "regex": True},
]
ST_PARAMS = [
    _NO_PARAMS, {}, {"max_results": 1}, {"max_results": 0}, {"max_results": 5},
    {"context_lines": 0}, {"context_lines": 3}, {"context_lines": 99},
]
# Declared divergence (bad input types): in-tree raises, staged returns an error.
BAD_ST_CASES = [
    ({"text": ["not", "a", "string"], "pattern": "a"}, {}),
    ({"text": b"bytes", "pattern": "a"}, {}),
    ({"text": TEXT, "pattern": 123}, {}),
    ({"text": TEXT, "pattern": "foo"}, {"max_results": "x"}),
    ({"text": TEXT, "pattern": "foo"}, {"context_lines": None}),
]


def test_search_text_agrees() -> None:
    mismatches = []
    for inputs in ST_INPUTS:
        for params in ST_PARAMS:
            staged = _outcome(search_text.run, inputs, params)
            ref = _outcome(ref_search_text.run, inputs, params)
            if staged != ref:
                mismatches.append((inputs, params, staged, ref))
    assert not mismatches, mismatches


def test_search_text_agrees_on_size_cap() -> None:
    for size in (limits.MAX_TOOL_IO_BYTES, limits.MAX_TOOL_IO_BYTES + 1):
        inputs = {"text": "x" * size, "pattern": "y"}
        assert _outcome(search_text.run, inputs, {}) == _outcome(ref_search_text.run, inputs, {})


def test_search_text_bad_input_types_are_a_declared_divergence() -> None:
    for inputs, params in BAD_ST_CASES:
        staged = _outcome(search_text.run, inputs, params)
        ref = _outcome(ref_search_text.run, inputs, params)
        assert _is_invalid_input(staged), (inputs, params, staged)
        assert _ref_raised(ref), ("in-tree no longer raises: drop this divergence", ref)


def test_search_text_off_main_thread_is_a_declared_divergence() -> None:
    inputs = {"text": TEXT, "pattern": "f.o", "regex": True}
    want = _outcome(search_text.run, inputs, {})  # main thread: both sides agree here
    assert want == _outcome(ref_search_text.run, inputs, {})
    got: dict = {}

    def work() -> None:
        got["staged"] = _outcome(search_text.run, inputs, {})
        got["ref"] = _outcome(ref_search_text.run, inputs, {})

    t = threading.Thread(target=work)
    t.start()
    t.join(timeout=60)
    assert got["staged"] == want
    assert got["ref"][:2] == ("raised", "ValueError"), (
        "in-tree now works off the main thread: drop this divergence", got["ref"]
    )
