"""G7: localhost names refused before DNS; no credentials or query strings in messages.

RFC 6761 §6.3: ``localhost`` and every name under ``.localhost`` are loopback, and
resolvers (systemd-resolved, browsers) answer them without asking DNS. A rule that
trusts the resolver's answer lets a hosts file or resolver that says otherwise through.
"""
from __future__ import annotations

import ipaddress
import socket

import pytest

from agent_tool_sandbox import (
    PinnedTarget,
    SsrfBlockedError,
    assert_safe_fetch_url,
    build_pinned_opener,
    pinned_urlopen,
    resolve_and_validate,
    ssrf_guard,
)

PUBLIC_V4 = "93.184.216.34"
SECRETS = ("hunter2", "SECRET", "tok3n", "alice")


@pytest.fixture
def lying_dns(fake_dns):
    """Every name answers a PUBLIC address, so only a name rule can refuse."""
    inner = fake_dns.getaddrinfo

    def resolver(host, port, *args, **kwargs):
        try:
            return inner(host, port, *args, **kwargs)
        except socket.gaierror:
            fake_dns.calls.append(("lying", host))
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_V4, port or 0))]

    fake_dns.records.pop("localhost")
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(socket, "getaddrinfo", resolver)
        yield fake_dns


@pytest.mark.parametrize(
    "host",
    [
        "localhost", "LOCALHOST", "localhost.", "foo.localhost", "foo.localhost.",
        "a.b.LocalHost", "x-y.localhost", "ip6-localhost", "ip6-loopback", "ip6-localhost.",
        "ｌｏｃａｌｈｏｓｔ", "ⓛocalhost", "foo.ｌｏｃａｌｈｏｓｔ",
    ],
)
def test_localhost_names_are_refused_before_dns(host, lying_dns) -> None:
    lying_dns.calls.clear()
    for guard in (assert_safe_fetch_url, resolve_and_validate):
        with pytest.raises(SsrfBlockedError, match=r"loopback name \(RFC 6761\)$") as excinfo:
            guard(f"http://{host}:8080/x")
        assert excinfo.value.hostname is not None
    assert lying_dns.calls == []  # never resolved


@pytest.mark.parametrize(
    "host",
    ["localhost.public.example", "notlocalhost.example", "localhost-dev.example",
     "mylocalhost", "localhostx", "localhost.example"],
)
def test_names_that_merely_contain_localhost_are_resolved_normally(host, lying_dns) -> None:
    assert assert_safe_fetch_url(f"http://{host}/") == f"http://{host}/"


# ── Redaction ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url,expected",
    [
        ("http://alice:hunter2@internal.example/cb?code=SECRET#tok3n",
         "http://REDACTED@internal.example/cb?REDACTED#REDACTED"),
        ("https://h.example/p?SECRET", "https://h.example/p?REDACTED"),
        ("https://h.example/p#tok3n?x", "https://h.example/p#REDACTED"),
        ("//alice@h.example/p", "//REDACTED@h.example/p"),
        ("http://a@b@h.example:81/", "http://REDACTED@h.example:81/"),
        ("http://a\\@h.example/", "http://REDACTED@h.example/"),
        ("/relative/path?SECRET", "/relative/path?REDACTED"),
        ("http://h.example/path@not-userinfo", "http://h.example/path@not-userinfo"),
        ("http://h.example", "http://h.example"),
    ],
)
def test_redact_url(url, expected) -> None:
    assert ssrf_guard._redact_url(url) == expected


def test_redact_url_leaves_non_strings_alone() -> None:
    assert ssrf_guard._redact_url(None) is None


def _wire(monkeypatch, response: bytes) -> None:
    import io

    class Sock:
        def __init__(self, *a, **k) -> None:
            pass

        def settimeout(self, v) -> None:
            pass

        def setsockopt(self, *a) -> None:
            pass

        def connect(self, addr) -> None:
            pass

        def sendall(self, data) -> None:
            pass

        def makefile(self, *a, **k):
            return io.BytesIO(response)

        def close(self) -> None:
            pass

    monkeypatch.setattr(socket, "socket", Sock)


def test_a_refused_redirect_does_not_echo_credentials_or_query(monkeypatch) -> None:
    location = "http://alice:hunter2@internal.example/cb?code=SECRET#tok3n"
    _wire(monkeypatch, (f"HTTP/1.1 302 Found\r\nLocation: {location}\r\n"
                        "Content-Length: 0\r\nConnection: close\r\n\r\n").encode())
    with pytest.raises(SsrfBlockedError) as excinfo:
        pinned_urlopen("http://public.example/", timeout=5)
    message = str(excinfo.value)
    assert message == "Redirect to 'http://REDACTED@internal.example/cb?REDACTED#REDACTED' blocked"
    assert not any(s in message for s in SECRETS)


def test_the_pinned_to_message_redacts_the_query() -> None:
    opener = build_pinned_opener(resolve_and_validate("http://public.example/?token=SECRET"))
    with pytest.raises(SsrfBlockedError, match="pinned to") as excinfo:
        opener.open("https://public.example/", timeout=5)
    assert "SECRET" not in str(excinfo.value)


def _target(**overrides) -> PinnedTarget:
    fields = dict(scheme="http", host="public.example", port=80,
                  canonical_url="http://public.example/?token=SECRET",
                  addresses=(ipaddress.IPv4Address(PUBLIC_V4),))
    fields.update(overrides)
    return PinnedTarget(**fields)


@pytest.mark.parametrize(
    "overrides",
    [
        {"port": 8080},
        {"canonical_url": "gopher://alice:hunter2@public.example/?token=SECRET"},
    ],
)
def test_inconsistent_target_messages_redact_the_url(overrides) -> None:
    with pytest.raises(SsrfBlockedError) as excinfo:
        build_pinned_opener(_target(**overrides))
    message = str(excinfo.value)
    assert not any(s in message for s in SECRETS), message
    assert "REDACTED" in message


def test_refusals_never_carry_the_query_string() -> None:
    for url in ("http://127.0.0.1/?token=SECRET", "http://mixed.example/x?token=SECRET",
                "http://localhost/?token=SECRET", "http://public.example:0/?SECRET",
                "http://a.public.example:b.public.example:80/?SECRET"):
        with pytest.raises(SsrfBlockedError) as excinfo:
            assert_safe_fetch_url(url)
        assert "SECRET" not in str(excinfo.value)
        assert "SECRET" not in excinfo.value.detail
