"""PKT-727: _resolve_host_ips must catch UnicodeEncodeError from the idna codec.

Reproduces the defect: IDNA-illegal hostnames (overlong label, empty label,
IDNA-illegal ACE prefix) raise UnicodeEncodeError inside socket.getaddrinfo,
which was not caught by the original 'except socket.gaierror' clause.

After the fix, all three surfaces must return a clean SsrfBlockedError /
ok=False result instead of propagating the raw UnicodeEncodeError.
"""
from __future__ import annotations

import pytest

from alienclaw.tools._ssrf_guard import (
    SsrfBlockedError,
    _resolve_host_ips,
    assert_safe_fetch_url,
)
from alienclaw.tools.http_get import run as http_get_run
from alienclaw.tools.url_fetch import run as url_fetch_run

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


# ---------------------------------------------------------------------------
# Layer 2 — assert_safe_fetch_url must raise SsrfBlockedError (NOT UnicodeEncodeError)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("url", _IDNA_ILLEGAL_URLS)
def test_assert_safe_fetch_url_raises_ssrf_blocked_not_unicode_error(url: str) -> None:
    """assert_safe_fetch_url must raise SsrfBlockedError, never UnicodeEncodeError."""
    with pytest.raises(SsrfBlockedError):
        assert_safe_fetch_url(url)


@pytest.mark.parametrize("url", _IDNA_ILLEGAL_URLS)
def test_assert_safe_fetch_url_does_not_raise_unicode_encode_error(url: str) -> None:
    """Explicit: UnicodeEncodeError must NOT propagate from assert_safe_fetch_url."""
    try:
        assert_safe_fetch_url(url)
    except SsrfBlockedError:
        pass  # correct — this is the expected outcome
    except UnicodeEncodeError as exc:
        pytest.fail(
            f"UnicodeEncodeError leaked from assert_safe_fetch_url for {url!r}: {exc}"
        )


# ---------------------------------------------------------------------------
# Layer 3 — url_fetch.run() must return ok=False (NOT raise) for IDNA-illegal URLs
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("url", _IDNA_ILLEGAL_URLS)
def test_url_fetch_run_returns_ok_false_for_idna_illegal(url: str) -> None:
    """url_fetch.run() must not crash; it must return ok=False, correctness=0.0."""
    try:
        result = url_fetch_run({"url": url})
    except UnicodeEncodeError as exc:
        pytest.fail(
            f"url_fetch.run() raised UnicodeEncodeError for {url!r}: {exc}"
        )
    assert result.ok is False, f"Expected ok=False for {url!r}, got ok={result.ok!r}"
    assert result.correctness == 0.0, (
        f"Expected correctness=0.0 for {url!r}, got {result.correctness!r}"
    )


# ---------------------------------------------------------------------------
# Layer 4 — http_get.run() must return ok=False (NOT raise) for IDNA-illegal URLs
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("url", _IDNA_ILLEGAL_URLS)
def test_http_get_run_returns_ok_false_for_idna_illegal(url: str) -> None:
    """http_get.run() must not crash; it must return ok=False, correctness=0.0."""
    try:
        result = http_get_run({"url": url})
    except UnicodeEncodeError as exc:
        pytest.fail(
            f"http_get.run() raised UnicodeEncodeError for {url!r}: {exc}"
        )
    assert result.ok is False, f"Expected ok=False for {url!r}, got ok={result.ok!r}"
    assert result.correctness == 0.0, (
        f"Expected correctness=0.0 for {url!r}, got {result.correctness!r}"
    )
