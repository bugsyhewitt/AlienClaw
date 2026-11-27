"""G5: opt-in redirect following for ``pinned_urlopen`` (``follow_redirects=N``).

The default stays 0: every 301/302/303/307/308 raises ``SsrfBlockedError``. With N > 0,
each hop is checked and pinned afresh (its own single resolution), https never drops to
http, credentials stay on their origin, 307/308 replay the method and body, 301/302/303
become a body-less GET, and every hop spends the same total deadline.

Network-free: ``hops`` replaces ``socket.socket`` with a fake that serves the next canned
response to each new connection and records where it connected and what it sent.
"""
from __future__ import annotations

import io
import socket
import ssl
import time
import urllib.error
from types import SimpleNamespace

import pytest

from agent_tool_sandbox import SsrfBlockedError, pinned_urlopen, pinning

PUBLIC_V4 = "93.184.216.34"
OTHER_V4 = "93.184.216.35"


def _reply(code: int, headers: dict[str, str] | None = None, body: bytes = b"") -> bytes:
    lines = [f"HTTP/1.1 {code} X", f"Content-Length: {len(body)}", "Connection: close"]
    lines += [f"{k}: {v}" for k, v in (headers or {}).items()]
    return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + body


def _to(code: int, location: str) -> bytes:
    return _reply(code, {"Location": location}, b"redirect body, never read")


class _HopSocket:
    state: SimpleNamespace

    def __init__(self, *args, **kwargs) -> None:
        self.connected_to = None
        self.sent = bytearray()
        self.state.sockets.append(self)

    def settimeout(self, value) -> None:
        pass

    def setsockopt(self, *args) -> None:
        pass

    def connect(self, addr) -> None:
        time.sleep(self.state.connect_delay)
        self.connected_to = addr

    def sendall(self, data) -> None:
        self.sent += data

    def makefile(self, mode="rb", *args, **kwargs):
        index = len(self.state.sockets) - 1
        replies = self.state.replies
        return io.BytesIO(replies[min(index, len(replies) - 1)])

    def close(self) -> None:
        pass

    def request(self) -> tuple[str, dict[str, str], bytes]:
        head, _, body = bytes(self.sent).partition(b"\r\n\r\n")
        lines = head.decode("latin-1").split("\r\n")
        headers = {}
        for line in lines[1:]:
            name, _, value = line.partition(":")
            headers[name.strip().lower()] = value.strip()
        return lines[0], headers, body


@pytest.fixture
def hops(monkeypatch: pytest.MonkeyPatch, fake_dns) -> SimpleNamespace:
    state = SimpleNamespace(sockets=[], replies=[_reply(200, body=b"ok")], connect_delay=0.0)
    monkeypatch.setattr(socket, "socket", type("HopSocket", (_HopSocket,), {"state": state}))
    fake_dns.records["other.example"] = [OTHER_V4]
    return state


@pytest.fixture
def tls(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    names: list[str] = []

    def wrap_socket(ctx, sock, *args, server_hostname=None, **kwargs):
        names.append(server_hostname)
        return sock

    monkeypatch.setattr(ssl.SSLContext, "wrap_socket", wrap_socket)
    return names


# ── Default: unchanged ──────────────────────────────────────────────────────


@pytest.mark.parametrize("code", [301, 302, 303, 307, 308])
def test_default_still_refuses_every_redirect(code, hops) -> None:
    hops.replies = [_to(code, "http://public.example/next")]
    refused = "^Redirect to 'http://public.example/next' blocked$"
    with pytest.raises(SsrfBlockedError, match=refused):
        pinned_urlopen("http://public.example/", timeout=5)
    assert len(hops.sockets) == 1


@pytest.mark.parametrize("bad,exc", [(-1, ValueError), (21, ValueError), (True, TypeError),
                                     ("2", TypeError), (1.0, TypeError)])
def test_follow_redirects_is_validated(bad, exc, hops) -> None:
    with pytest.raises(exc, match="follow_redirects"):
        pinned_urlopen("http://public.example/", timeout=5, follow_redirects=bad)
    assert hops.sockets == []


# ── Following ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("code", [301, 302, 303, 307, 308])
def test_a_redirect_is_followed_and_each_hop_is_pinned(code, hops, fake_dns) -> None:
    hops.replies = [_to(code, "http://other.example/next?x=1"), _reply(200, body=b"final")]
    with pinned_urlopen("http://public.example/", timeout=5, follow_redirects=1) as resp:
        assert resp.read() == b"final"
        assert resp.url == "http://other.example/next?x=1"
    assert [s.connected_to for s in hops.sockets] == [(PUBLIC_V4, 80), (OTHER_V4, 80)]
    assert fake_dns.calls == ["public.example", "other.example"]  # one resolution per hop
    line, headers, _ = hops.sockets[1].request()
    assert line == "GET /next?x=1 HTTP/1.1"
    assert headers["host"] == "other.example"


def test_a_relative_location_is_resolved_against_the_current_url(hops) -> None:
    hops.replies = [_to(302, "../b/c"), _reply(200, body=b"rel")]
    with pinned_urlopen("http://public.example/a/x/y", timeout=5, follow_redirects=1) as resp:
        assert resp.read() == b"rel"
    assert hops.sockets[1].request()[0] == "GET /a/b/c HTTP/1.1"


@pytest.mark.parametrize(
    "location",
    ["http://127.0.0.1/admin", "http://mixed.example/", "http://localhost/",
     "file:///etc/passwd", "http://169.254.169.254/latest/meta-data/",
     "http://user:pw@other.example/", "http://other.example:0/"],
)
def test_every_hop_is_re_validated(location, hops) -> None:
    hops.replies = [_to(302, location), _reply(200, body=b"must not be fetched")]
    with pytest.raises(SsrfBlockedError):
        pinned_urlopen("http://public.example/", timeout=5, follow_redirects=3)
    assert len(hops.sockets) == 1


def test_a_hop_whose_name_rebinds_internal_is_refused(hops, fake_dns) -> None:
    fake_dns.records["other.example"] = ["10.1.2.3"]
    hops.replies = [_to(307, "http://other.example/")]
    with pytest.raises(SsrfBlockedError) as excinfo:
        pinned_urlopen("http://public.example/", timeout=5, follow_redirects=1)
    assert "10.1.2.3" not in str(excinfo.value)
    assert len(hops.sockets) == 1


def test_the_hop_limit(hops) -> None:
    hops.replies = [_to(302, "/1"), _to(302, "/2"), _to(302, "/3"), _reply(200)]
    refused = r"^Redirect to '/3' blocked: more than 2 redirects$"
    with pytest.raises(SsrfBlockedError, match=refused):
        pinned_urlopen("http://public.example/", timeout=5, follow_redirects=2)
    assert len(hops.sockets) == 3
    hops.sockets.clear()
    with pinned_urlopen("http://public.example/", timeout=5, follow_redirects=3) as resp:
        assert resp.status == 200


def test_a_redirect_without_location_is_an_http_error(hops) -> None:
    hops.replies = [_reply(302)]
    with pytest.raises(urllib.error.HTTPError) as excinfo:
        pinned_urlopen("http://public.example/", timeout=5, follow_redirects=1)
    assert excinfo.value.code == 302


@pytest.mark.parametrize("location", ["", " "])
def test_an_empty_location_is_a_missing_one(location, hops) -> None:
    """Not a reference to the current URL (RFC 3986 5.2), which loops until the hop cap."""
    hops.replies = [_to(302, location), _reply(200, body=b"must not be fetched")]
    with pytest.raises(urllib.error.HTTPError) as excinfo:
        pinned_urlopen("http://public.example/", timeout=5, follow_redirects=3)
    assert excinfo.value.code == 302
    assert len(hops.sockets) == 1


def test_more_than_one_location_is_refused(hops) -> None:
    """Browsers refuse it (ERR_RESPONSE_HEADERS_MULTIPLE_LOCATION); urllib took the first."""
    two = (b"HTTP/1.1 302 X\r\nLocation: http://other.example/one\r\n"
           b"Location: http://public.example/two\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    hops.replies = [two, _reply(200, body=b"must not be fetched")]
    refused = r"^Refusing redirect \(status 302\): 2 Location headers$"
    with pytest.raises(SsrfBlockedError, match=refused):
        pinned_urlopen("http://public.example/", timeout=5, follow_redirects=3)
    assert len(hops.sockets) == 1


@pytest.mark.parametrize(
    "location,request_line",
    [
        ("/café", "GET /caf%C3%A9 HTTP/1.1"),
        ("/s?q=é&r=ü#frag-é", "GET /s?q=%C3%A9&r=%C3%BC HTTP/1.1"),
        ("http://public.example/naïve/x", "GET /na%C3%AFve/x HTTP/1.1"),
    ],
)
def test_a_utf8_location_is_percent_encoded(location, request_line, hops) -> None:
    """UTF-8 on the wire, as browsers and fetch() read it: decoded, then percent-encoded.

    http.client decodes header bytes as Latin-1, so before this the hop's request line held
    non-ASCII and http.client raised UnicodeEncodeError out of pinned_urlopen.
    """
    hops.replies = [_to(302, location.encode().decode("latin-1")), _reply(200, body=b"enc")]
    with pinned_urlopen("http://public.example/", timeout=5, follow_redirects=1) as resp:
        assert resp.read() == b"enc"
    assert hops.sockets[1].request()[0] == request_line


def test_a_location_that_is_not_utf8_gets_replacement_characters(hops) -> None:
    """A lone Latin-1 byte is not UTF-8: U+FFFD, as fetch() and the TS twin decode it."""
    hops.replies = [_to(302, "/caf\xe9"), _reply(200, body=b"enc")]
    with pinned_urlopen("http://public.example/", timeout=5, follow_redirects=1) as resp:
        assert resp.read() == b"enc"
    assert hops.sockets[1].request()[0] == "GET /caf%EF%BF%BD HTTP/1.1"


def test_a_utf8_host_in_a_location_is_idna_encoded(hops, fake_dns) -> None:
    fake_dns.records["xn--bcher-kva.example"] = [OTHER_V4]
    hops.replies = [_to(302, "http://bücher.example/b".encode().decode("latin-1")),
                    _reply(200, body=b"idna")]
    with pinned_urlopen("http://public.example/", timeout=5, follow_redirects=1) as resp:
        assert resp.read() == b"idna"
    assert hops.sockets[1].connected_to == (OTHER_V4, 80)
    assert hops.sockets[1].request()[1]["host"] == "xn--bcher-kva.example"


@pytest.mark.parametrize(
    "location", ["/a b", "/a　b", "/a\u0085b", "http://bücher x.example/"]
)
def test_percent_encoding_launders_no_whitespace_or_control(location, hops) -> None:
    """The guard's character rule is applied to the decoded Location, before encoding.

    It refuses whitespace and control characters anywhere in the URL (ASCII ones too, the
    documented difference with the TS twin), so encoding must not turn them into %XX.
    """
    hops.replies = [_to(302, location.encode().decode("latin-1")), _reply(200, body=b"ws")]
    with pytest.raises(SsrfBlockedError, match="^Refusing URL containing "):
        pinned_urlopen("http://public.example/", timeout=5, follow_redirects=1)
    assert len(hops.sockets) == 1


@pytest.mark.parametrize("code", [300, 304, 305, 306])
def test_a_3xx_that_is_not_a_redirect_is_an_http_error(code, hops) -> None:
    """Only 301/302/303/307/308 are followed, Location or not (the TS twin agrees)."""
    hops.replies = [_to(code, "http://other.example/x"), _reply(200, body=b"must not be fetched")]
    with pytest.raises(urllib.error.HTTPError) as excinfo:
        pinned_urlopen("http://public.example/", timeout=5, follow_redirects=3)
    assert excinfo.value.code == code
    assert len(hops.sockets) == 1


# ── Scheme downgrade ────────────────────────────────────────────────────────


@pytest.mark.parametrize("location", ["http://public.example/", "HTTP://other.example/x"])
def test_https_to_http_is_refused(location, hops, tls) -> None:
    hops.replies = [_to(301, location), _reply(200)]
    with pytest.raises(SsrfBlockedError, match="https to http downgrade"):
        pinned_urlopen("https://public.example/", timeout=5, follow_redirects=2)
    assert len(hops.sockets) == 1


def test_http_to_https_is_allowed(hops, tls) -> None:
    hops.replies = [_to(301, "https://public.example/s"), _reply(200, body=b"tls")]
    with pinned_urlopen("http://public.example/", timeout=5, follow_redirects=1) as resp:
        assert resp.read() == b"tls"
    assert hops.sockets[1].connected_to == (PUBLIC_V4, 443)
    assert tls == ["public.example"]


# ── Credentials stay on their origin ───────────────────────────────────────


SENSITIVE = {"Authorization": "Bearer t0k", "Cookie": "sid=1", "Proxy-Authorization": "Basic x"}


@pytest.mark.parametrize(
    "location",
    ["http://other.example/", "http://public.example:8080/", "https://public.example/"],
)
def test_cross_origin_hops_drop_credentials(location, hops, tls) -> None:
    hops.replies = [_to(307, location), _reply(200)]
    headers = {**SENSITIVE, "X-Keep": "1", "authorization": "dup"}
    with pinned_urlopen("http://public.example/", headers=headers, timeout=5,
                        follow_redirects=1) as resp:
        resp.read()
    first, second = (s.request()[1] for s in hops.sockets)
    assert {"authorization", "cookie", "proxy-authorization"} <= set(first)
    assert not {"authorization", "cookie", "proxy-authorization"} & set(second)
    assert second["x-keep"] == "1"


def test_same_origin_hops_keep_credentials(hops) -> None:
    hops.replies = [_to(302, "/next"), _reply(200)]
    with pinned_urlopen("http://public.example/", headers=SENSITIVE, timeout=5,
                        follow_redirects=1) as resp:
        resp.read()
    second = hops.sockets[1].request()[1]
    assert second["authorization"] == "Bearer t0k" and second["cookie"] == "sid=1"


def test_a_caller_host_header_is_dropped_on_a_cross_origin_hop(hops) -> None:
    hops.replies = [_to(302, "http://other.example/"), _reply(200)]
    with pinned_urlopen("http://public.example/", headers={"Host": "public.example"},
                        timeout=5, follow_redirects=1) as resp:
        resp.read()
    assert hops.sockets[1].request()[1]["host"] == "other.example"


# ── Method and body ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("code", [307, 308])
def test_307_and_308_keep_method_and_body(code, hops) -> None:
    hops.replies = [_to(code, "/again"), _reply(200)]
    with pinned_urlopen("http://public.example/api", b'{"a":1}', method="PUT", timeout=5,
                        headers={"Content-Type": "application/json"},
                        follow_redirects=1) as resp:
        resp.read()
    line, headers, body = hops.sockets[1].request()
    assert line == "PUT /again HTTP/1.1"
    assert body == b'{"a":1}' and headers["content-length"] == "7"
    assert headers["content-type"] == "application/json"


@pytest.mark.parametrize("code", [301, 302, 303])
@pytest.mark.parametrize("method", [None, "POST", "PUT", "DELETE"])
def test_301_302_303_become_a_get_without_body(code, method, hops) -> None:
    hops.replies = [_to(code, "/after"), _reply(200)]
    with pinned_urlopen("http://public.example/form", b"a=1", method=method, timeout=5,
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                        follow_redirects=1) as resp:
        resp.read()
    line, headers, body = hops.sockets[1].request()
    assert line == "GET /after HTTP/1.1"
    assert body == b""
    assert "content-length" not in headers and "content-type" not in headers


def test_head_stays_head(hops) -> None:
    hops.replies = [_to(303, "/h"), _reply(200)]
    with pinned_urlopen("http://public.example/", method="HEAD", timeout=5,
                        follow_redirects=1) as resp:
        resp.read()
    assert hops.sockets[1].request()[0] == "HEAD /h HTTP/1.1"


# ── One deadline for every hop ─────────────────────────────────────────────


def test_hops_share_the_total_deadline(hops) -> None:
    hops.connect_delay = 0.12
    hops.replies = [_to(302, f"/{i}") for i in range(1, 10)] + [_reply(200)]
    start = time.monotonic()
    with pytest.raises(pinning.DeadlineExceededError):
        pinned_urlopen("http://public.example/", timeout=0.4, follow_redirects=10)
    assert time.monotonic() - start < 0.4 + 0.4
    assert 2 <= len(hops.sockets) <= 5
