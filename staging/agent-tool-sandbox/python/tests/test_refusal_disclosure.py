"""PR-03: refusal messages must not disclose what a name resolved to.

In an agent tool the error text goes back into the model's context, so a message that
names the resolved address (or tells "resolves somewhere internal" from "does not
resolve") lets a prompt-injected page map internal DNS through the guard. ``str(exc)``
is now the same for both; the detail stays on the exception for logs.
"""
from __future__ import annotations

import ipaddress
import pickle
import re

import pytest

from agent_tool_sandbox import (
    SsrfBlockedError,
    assert_safe_fetch_url,
    pinned_urlopen,
    resolve_and_validate,
)

_IPV4 = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
_IPV6 = re.compile(r"[0-9a-f]{0,4}:[0-9a-f]{0,4}:[0-9a-f:.]*", re.IGNORECASE)


def _generic(host: str) -> str:
    return f"Refusing hostname {host!r}: not an allowed destination"


GUARDS = [assert_safe_fetch_url, resolve_and_validate,
          lambda url: pinned_urlopen(url, timeout=5)]


@pytest.mark.parametrize("guard", GUARDS, ids=["assert_safe_fetch_url", "resolve_and_validate",
                                               "pinned_urlopen"])
@pytest.mark.parametrize(
    "host,address",
    [
        ("mixed.example", "10.0.0.1"),
        ("metadata.google.internal", "169.254.169.254"),
        ("mapped-metadata.example", "169.254.169.254"),
        ("ula.example", "fd00::1"),
        ("linklocal6.example", "fe80::1"),
        ("cgnat.example", "100.64.0.1"),
    ],
)
def test_a_name_that_resolves_internally_does_not_name_the_address(guard, host, address) -> None:
    with pytest.raises(SsrfBlockedError) as excinfo:
        guard(f"http://{host}/")
    exc = excinfo.value
    message = str(exc)
    assert message == _generic(host)
    assert address not in message
    assert not _IPV4.search(message) and not _IPV6.search(message), message
    # The detail is still there for callers that log it.
    assert exc.blocked_address == ipaddress.ip_address(address)
    assert exc.hostname == host
    assert exc.detail == f"Refusing blocked IP {address} (resolved from {host!r})"


def test_unresolvable_and_blocked_read_the_same(fake_dns) -> None:
    # Otherwise the message is an existence oracle for internal names.
    with pytest.raises(SsrfBlockedError) as missing:
        resolve_and_validate("http://nxdomain.example/")
    with pytest.raises(SsrfBlockedError) as internal:
        resolve_and_validate("http://mixed.example/")
    assert str(missing.value) == _generic("nxdomain.example")
    assert str(missing.value).replace("nxdomain", "X") == str(internal.value).replace("mixed", "X")
    assert missing.value.blocked_address is None
    assert missing.value.detail == "Refusing unresolvable hostname 'nxdomain.example'"


@pytest.mark.parametrize("url,host", [("http://10.0.0.1/", "10.0.0.1"),
                                      ("http://2130706433/", "2130706433"),
                                      ("http://[::ffff:127.0.0.1]/", "::ffff:127.0.0.1")])
def test_literals_get_the_generic_message_too(url, host) -> None:
    with pytest.raises(SsrfBlockedError) as excinfo:
        assert_safe_fetch_url(url)
    assert str(excinfo.value) == _generic(host)
    assert excinfo.value.blocked_address is not None
    assert excinfo.value.detail.startswith("Refusing blocked IP ")


def test_the_exception_type_is_unchanged() -> None:
    assert issubclass(SsrfBlockedError, ValueError)
    plain = SsrfBlockedError("custom")
    assert (str(plain), plain.detail, plain.blocked_address, plain.hostname) == (
        "custom", "custom", None, None)


def test_the_detail_survives_pickling() -> None:
    with pytest.raises(SsrfBlockedError) as excinfo:
        resolve_and_validate("http://mixed.example/")
    clone = pickle.loads(pickle.dumps(excinfo.value))
    assert str(clone) == str(excinfo.value)
    assert (clone.detail, clone.blocked_address, clone.hostname) == (
        excinfo.value.detail, excinfo.value.blocked_address, excinfo.value.hostname)


def test_other_refusals_keep_their_message() -> None:
    # Only the post-DNS verdict is generic; input-only refusals still say what was wrong.
    with pytest.raises(SsrfBlockedError, match="^Refusing non-http"):
        assert_safe_fetch_url("ftp://public.example/")
    with pytest.raises(SsrfBlockedError, match="^Refusing URL with userinfo"):
        assert_safe_fetch_url("http://u@public.example/")
    with pytest.raises(SsrfBlockedError, match="^Refusing URL with port 0"):
        assert_safe_fetch_url("http://public.example:0/")
