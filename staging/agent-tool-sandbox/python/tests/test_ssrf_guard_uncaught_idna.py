"""_resolve_host_ips must catch UnicodeError from the idna codec.

IDNA-illegal hostnames (overlong label, empty label, overlong ACE label) raise
UnicodeEncodeError (3.13+) or bare UnicodeError (<=3.12) inside
socket.getaddrinfo's host encoding. The guard must surface a clean
SsrfBlockedError instead of propagating it.

Ported at guard level (layers 1-2 of the reference suite); the tool-level
layers are out of scope for this package. The fake resolver in conftest.py
calls the real getaddrinfo with AI_NUMERICHOST, so the idna encoding error
raised here is the interpreter's own.
"""
from __future__ import annotations

import pytest

from agent_tool_sandbox.ssrf_guard import (
    SsrfBlockedError,
    _resolve_host_ips,
    assert_safe_fetch_url,
)

# ---------------------------------------------------------------------------
# IDNA-illegal hostnames that trigger UnicodeEncodeError inside getaddrinfo
# ---------------------------------------------------------------------------
_OVERLONG_LABEL = "a" * 300 + ".com"
_EMPTY_LABEL_HOST = "a..com"
_OVERLONG_ACE = "xn--" + "a" * 70 + ".com"

_IDNA_ILLEGAL_HOSTS = [
    _OVERLONG_LABEL,
    _EMPTY_LABEL_HOST,
    _OVERLONG_ACE,
]

_IDNA_ILLEGAL_URLS = [
    f"http://{_OVERLONG_LABEL}/x",
    f"http://{_EMPTY_LABEL_HOST}/x",
    f"http://{_OVERLONG_ACE}/",
]


def test_fixture_hosts_really_are_idna_illegal() -> None:
    """Guards the premise: each host must make the idna codec raise."""
    for host in _IDNA_ILLEGAL_HOSTS:
        with pytest.raises(UnicodeError):
            host.encode("idna")


# ---------------------------------------------------------------------------
# Layer 1 — _resolve_host_ips must return [] (NOT raise) for IDNA-illegal hosts
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("host", _IDNA_ILLEGAL_HOSTS)
def test_resolve_host_ips_returns_empty_for_idna_illegal(host: str) -> None:
    """_resolve_host_ips must return [] instead of raising UnicodeEncodeError."""
    result = _resolve_host_ips(host)
    assert result == [], (
        f"Expected [] for IDNA-illegal host {host!r}, got {result!r}"
    )


def test_resolve_host_ips_catches_base_unicode_error(fake_dns) -> None:
    """Python <=3.12 raises the base UnicodeError (not the subclass)."""
    fake_dns.raises["base-unicode.example"] = UnicodeError("label empty or too long")
    assert _resolve_host_ips("base-unicode.example") == []


# ---------------------------------------------------------------------------
# Layer 2 — assert_safe_fetch_url must raise SsrfBlockedError (NOT UnicodeEncodeError)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("url", _IDNA_ILLEGAL_URLS)
def test_assert_safe_fetch_url_raises_ssrf_blocked_not_unicode_error(url: str) -> None:
    """assert_safe_fetch_url must raise SsrfBlockedError, never UnicodeEncodeError."""
    with pytest.raises(SsrfBlockedError):
        assert_safe_fetch_url(url)


@pytest.mark.parametrize("url", _IDNA_ILLEGAL_URLS)
def test_assert_safe_fetch_url_does_not_raise_unicode_error(url: str) -> None:
    """Explicit: UnicodeError (base or subclass) must NOT propagate from assert_safe_fetch_url.

    Python <=3.12 raises bare UnicodeError; 3.13+ raises UnicodeEncodeError
    (a subclass). Catching the base covers both.
    """
    try:
        assert_safe_fetch_url(url)
    except SsrfBlockedError:
        pass  # correct — this is the expected outcome
    except UnicodeError as exc:
        pytest.fail(
            f"UnicodeError leaked from assert_safe_fetch_url for {url!r}: "
            f"{type(exc).__name__}: {exc}"
        )
