"""Tool-level regression: http_get / url_fetch fetch the URL the guard vetted.

Ported from the tool-level part of the in-tree test_ssrf_guard_connect_host.py (the
guard-level part already lives in agent_tool_sandbox's tests/test_connect_host.py).
The guard refuses every URL spelling on which parsers can disagree and returns a
canonical URL; the tools must fetch THAT URL and report it in ``output["url"]``.

Network-free: every NAME resolves to a public address (wildcard fake DNS), IP
literals keep their real meaning, and the transport is in-process.
"""
from __future__ import annotations

import pytest

from conftest import PUBLIC_V4
from pho3nix_recon_http import http_get, url_fetch


@pytest.fixture(autouse=True)
def _wildcard_dns(fake_dns) -> None:
    fake_dns.wildcard = PUBLIC_V4


@pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])
@pytest.mark.parametrize("url", [
    "http://%31%32%37.0.0.1/",
    "http://evil@x.attacker.example/",
    "http://a.attacker.example:b.attacker.example:80/",
    "http://169.254.169.254\\@example.com/../latest/meta-data/",
    "http://%31%36%39.254.169.254/latest/meta-data/",
    "http://127.0.0.1%23.attacker.example/",
    "http://x.attacker.example\t.y/",
])
def test_tool_never_connects_to_unvetted_host(tool, url: str, transport, fake_dns) -> None:
    handler = transport()
    r = tool.run({"url": url})
    assert r.ok is False, f"{url!r} was fetched from {[s.host for s in handler.requests]!r}"
    assert r.error.startswith("Refusing")
    assert handler.requests == []


@pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])
@pytest.mark.parametrize(("raw", "canonical", "host"), [
    ("http://Public.Example/x", "http://public.example/x", "public.example"),
    ("HTTP://Public.Example:080/a;p?q=1#f", "http://public.example:80/a;p?q=1#f",
     "public.example:80"),
    ("https://bücher.example/x", "https://xn--bcher-kva.example/x", "xn--bcher-kva.example"),
])
def test_tool_fetches_and_reports_canonical_url(tool, raw, canonical, host, transport) -> None:
    handler = transport()
    r = tool.run({"url": raw})
    assert r.ok is True, r.error
    assert [s.host for s in handler.requests] == [host]
    assert r.output["url"] == canonical
