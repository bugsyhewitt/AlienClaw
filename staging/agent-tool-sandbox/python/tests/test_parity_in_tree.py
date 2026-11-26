"""Decision parity between this package and the reference (in-tree) sources it was lifted from.

Puts ``<repo>/src`` on sys.path (or ``$AGENT_TOOL_SANDBOX_REFERENCE_SRC``), imports
the reference guard and jail, and asserts identical decisions AND identical
messages on a shared vector corpus. Two differences are declared, and each is
asserted explicitly rather than tolerated:

1. CGNAT (the only DECISION difference at equivalent configuration): the
   staged guard blocks 100.64.0.0/10 (RFC 6598, from the reference repo's
   unmerged PR #630); the reference guard does not.
2. Denied roots (API shape, not a decision difference): the reference jail
   hardcodes ``~/.openclaw`` as a denied root; the staged jail takes
   ``deny_roots`` from the caller. With ``deny_roots=[Path.home() / ".openclaw"]``
   every decision is identical; only the deny message text differs. With the
   default (no deny roots) exactly the deny-category vectors are accepted.

Network-free: DNS is the fake resolver from conftest.py (shared by both
implementations, since both call ``socket.getaddrinfo`` at call time).

Skips cleanly when the reference sources are not importable, so the package
stays liftable.
"""
from __future__ import annotations

import ipaddress
import os
import socket
import sys
from pathlib import Path

import pytest

import agent_tool_sandbox.boundary as staged_boundary
import agent_tool_sandbox.ssrf_guard as staged_ssrf


def _reference_src() -> Path | None:
    env = os.environ.get("AGENT_TOOL_SANDBOX_REFERENCE_SRC")
    if env:
        return Path(env)
    parents = Path(__file__).resolve().parents
    return parents[4] / "src" if len(parents) > 4 else None


_SRC = _reference_src()
if _SRC is not None and _SRC.is_dir() and str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
try:
    from alienclaw.tools import _boundary as ref_boundary
    from alienclaw.tools import _ssrf_guard as ref_ssrf
except Exception as exc:  # ImportError, or anything the reference package raises on import
    pytest.skip(f"reference sources not importable ({exc!r})", allow_module_level=True)

CGNAT = ipaddress.ip_network("100.64.0.0/10")


# ═══════════════════════════════════════════════════════════════════════════
# SSRF guard: URL corpus
# ═══════════════════════════════════════════════════════════════════════════

URL_CORPUS = [
    # ── non-strings / empty / malformed
    "", " ", "http://", "http:///x", "http:public.example", "//public.example/",
    "http://[::1/", "http://[not-an-ip]/", "http://public.example:99999/",
    "<URL:http://127.0.0.1/>", " http://127.0.0.1/", "http://127.0.0.1\t/",
    # ── schemes
    "file:///etc/passwd", "file://localhost/etc/passwd", "ftp://public.example/",
    "gopher://public.example:70/_x", "data:text/plain,hi", "javascript:alert(1)",
    "dict://127.0.0.1:11211/", "ws://public.example/", "HTTP://public.example/",
    "hTTps://public.example/", "https://public.example/",
    # ── userinfo
    "http://user@127.0.0.1/", "http://user:pw@public.example/",
    "http://127.0.0.1@public.example/",       # guard checks public.example
    "http://public.example@127.0.0.1/", "http://a@b@127.0.0.1/",
    "http://public.example%40@127.0.0.1/", "http://evil@x.public.example/",
    # ── percent-encoding
    "http://%31%32%37.0.0.1/", "http://public%2eexample/", "http://127.0.0.1%3a/",
    "http://a%2ex.public.example/",
    # ── IDNA / unicode
    "http://bücher.example/", "http://xn--bcher-kva.example/",
    "http://ｌｏｃａｌｈｏｓｔ/",  # fullwidth localhost
    "http://ⓛⓞⓒⓐⓛⓗⓞⓢⓣ/",  # circled localhost
    "http://127。0。0。1/",                                # ideographic full stop
    "http://①②⑦.0.0.1/",                                # circled digits
    "http://" + "a" * 300 + ".com/", "http://a..com/", "http://xn--/",
    "http://xn--" + "a" * 70 + ".com/",
    # ── decimal / octal / hex / short IPv4
    "http://2130706433/", "http://017700000001/", "http://0x7f000001/", "http://0x7f.1/",
    "http://127.1/", "http://127.0.1/", "http://0177.0.0.01/", "http://00000177.0.0.1/",
    "http://3232235521/", "http://0xa9fea9fe/", "http://2852039166/", "http://08.0.0.1/",
    "http://1.2.3/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://4294967295/",
    "http://4294967296/",
    # ── IPv6
    "http://[::1]/", "http://[::]/", "http://[0:0:0:0:0:0:0:1]/", "http://[::1]:8080/",
    "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/",
    "http://[::ffff:169.254.169.254]/", "http://[::ffff:10.0.0.1]/",
    "http://[::127.0.0.1]/", "http://[fc00::1]/", "http://[fd12:3456::1]/",
    "http://[fe80::1]/", "http://[fe80::1%25lo]/", "http://[fe80::1%25eth0]/",
    "http://[fec0::1]/", "http://[ff02::1]/", "http://[64:ff9b::7f00:1]/",
    "http://[2002:7f00:1::]/", "http://[2001:db8::1]/", "http://[2001::1]/",
    "http://[2606:4700:4700::1111]/", "http://[::ffff:8.8.8.8]/",
    # ── cloud metadata
    "http://169.254.169.254/latest/meta-data/", "http://169.254.170.2/v2/credentials",
    "http://[fd00:ec2::254]/", "http://metadata.google.internal/computeMetadata/v1/",
    "http://192.0.0.192/", "http://mapped-metadata.example/",
    # ── localhost variants / trailing dots / wildcard-zero
    "http://localhost/", "http://LOCALHOST/", "http://localhost./", "http://localhost:22/",
    "http://127.0.0.1./", "http://public.example./", "http://0.0.0.0/", "http://0/",
    "http://127.255.255.254/", "http://127.0.0.1\x00.public.example/",
    "http://public.example\x00.127.0.0.1/",
    # ── resolved names
    "http://public.example/", "http://public6.example/", "http://dual.example/",
    "http://mixed.example/", "http://ula.example/", "http://linklocal6.example/",
    "http://nxdomain.example/",
    # ── RFC1918 / special-purpose IPv4
    "http://10.0.0.1/", "http://172.16.0.1/", "http://172.31.255.255/", "http://172.32.0.1/",
    "http://192.168.1.1/", "http://198.18.0.1/", "http://192.0.2.1/", "http://240.0.0.1/",
    "http://255.255.255.255/", "http://224.0.0.1/", "http://8.8.8.8/",
    # ── CGNAT (declared divergence) and its edges (no divergence)
    "http://100.64.0.1/", "http://100.127.255.255/", "http://100.100.100.200/",
    "http://1681915905/", "http://[::ffff:100.64.0.1]/", "http://cgnat.example/",
    "http://mapped-cgnat.example/", "http://100.63.255.255/", "http://100.128.0.0/",
]

# Exactly these vectors may decide differently: the staged guard blocks, the reference allows.
CGNAT_DIVERGENT_URLS = frozenset({
    "http://100.64.0.1/", "http://100.127.255.255/", "http://100.100.100.200/",
    "http://1681915905/", "http://[::ffff:100.64.0.1]/", "http://cgnat.example/",
    "http://mapped-cgnat.example/",
})

NON_STRING_INPUTS = [None, b"http://public.example/", 123, ["http://public.example/"]]


@pytest.fixture(autouse=True)
def _corpus_dns(fake_dns):
    fake_dns.records["a%2ex.public.example"] = ["93.184.216.34"]
    fake_dns.records["x.public.example"] = ["93.184.216.34"]
    return fake_dns


def _url_outcome(mod, url):
    try:
        return ("allow", mod.assert_safe_fetch_url(url))
    except mod.SsrfBlockedError as exc:
        return ("block", str(exc))
    except Exception as exc:  # any other escape is a decision too, and must match
        return ("raise", type(exc).__name__, str(exc))


def test_corpus_has_no_duplicates() -> None:
    assert len(URL_CORPUS) == len(set(URL_CORPUS))
    assert CGNAT_DIVERGENT_URLS <= set(URL_CORPUS)


@pytest.mark.parametrize("url", URL_CORPUS)
def test_url_decision_parity(url: str) -> None:
    staged = _url_outcome(staged_ssrf, url)
    ref = _url_outcome(ref_ssrf, url)
    if url in CGNAT_DIVERGENT_URLS:
        assert staged[0] == "block" and "Refusing blocked IP 100." in staged[1], staged
        assert ref == ("allow", url), (
            f"reference now blocks {url!r} ({ref!r}): PR #630 is probably merged — "
            "drop the CGNAT divergence from PROVENANCE.json and this test"
        )
    else:
        assert staged == ref


@pytest.mark.parametrize("value", NON_STRING_INPUTS, ids=repr)
def test_non_string_input_parity(value) -> None:
    assert _url_outcome(staged_ssrf, value) == _url_outcome(ref_ssrf, value)


def test_error_type_shape_parity() -> None:
    assert issubclass(staged_ssrf.SsrfBlockedError, ValueError)
    assert issubclass(ref_ssrf.SsrfBlockedError, ValueError)
    assert staged_ssrf._ALLOWED_SCHEMES == ref_ssrf._ALLOWED_SCHEMES


# ═══════════════════════════════════════════════════════════════════════════
# SSRF guard: resolver + IP predicate (getaddrinfo mocked)
# ═══════════════════════════════════════════════════════════════════════════

HOST_CORPUS = [
    "localhost", "public.example", "public6.example", "dual.example", "mixed.example",
    "mapped-metadata.example", "nxdomain.example", "127.1", "::ffff:127.0.0.1",
    "fe80::1%lo", "a..com", "a" * 300 + ".com", "garbage-v6.example", "partial-garbage.example",
    "unix-family.example", "short-sockaddr.example", "raises-unicode.example",
    "raises-gaierror.example", "cgnat.example",
]


@pytest.fixture
def _resolver_faults(fake_dns):
    stream = socket.SOCK_STREAM
    fake_dns.raw["garbage-v6.example"] = [(socket.AF_INET6, stream, 6, "", ("not-an-ip", 0, 0, 0))]
    fake_dns.raw["partial-garbage.example"] = [
        (socket.AF_INET6, stream, 6, "", ("not-an-ip", 0, 0, 0)),
        (socket.AF_INET, stream, 6, "", ("93.184.216.34", 0)),
    ]
    fake_dns.raw["unix-family.example"] = [(socket.AF_UNIX, stream, 0, "", "/tmp/x")]
    fake_dns.raw["short-sockaddr.example"] = [(socket.AF_INET, stream, 6, "", ())]
    fake_dns.raises["raises-unicode.example"] = UnicodeError("label empty or too long")
    fake_dns.raises["raises-gaierror.example"] = socket.gaierror(socket.EAI_AGAIN, "try again")
    return fake_dns


@pytest.mark.parametrize("host", HOST_CORPUS)
def test_resolve_host_ips_parity(host: str, _resolver_faults) -> None:
    assert staged_ssrf._resolve_host_ips(host) == ref_ssrf._resolve_host_ips(host)


IP_CORPUS = [
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "100.63.255.255", "100.64.0.0", "100.64.0.1",
    "100.100.100.200", "100.127.255.255", "100.128.0.0", "127.0.0.1", "127.255.255.255",
    "169.254.169.254", "169.254.170.2", "172.15.255.255", "172.16.0.0", "172.31.255.255",
    "172.32.0.0", "192.0.0.1", "192.0.0.9", "192.0.0.170", "192.0.2.1", "192.88.99.1",
    "192.168.0.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.250",
    "240.0.0.1", "255.255.255.255", "1.1.1.1", "8.8.8.8", "93.184.216.34",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:100.64.0.1", "::ffff:8.8.8.8", "::127.0.0.1",
    "64:ff9b::7f00:1", "64:ff9b:1::1", "100::1", "2001::1", "2001:db8::1", "2001:4860::8888",
    "2002:7f00:1::", "2002:808:808::", "fc00::1", "fd00:ec2::254", "fe80::1", "fe80::1%lo",
    "febf::1", "fec0::1", "feff::1", "ff02::1", "ff0e::1", "2606:4700:4700::1111",
]


def _cgnat_v4(ip) -> bool:
    return isinstance(ip, ipaddress.IPv4Address) and ip in CGNAT


def _assert_ip_parity(ip) -> None:
    staged = staged_ssrf._ip_is_blocked(ip)
    ref = ref_ssrf._ip_is_blocked(ip)
    if _cgnat_v4(ip):
        assert staged is True
        assert ref is False, f"reference now blocks CGNAT {ip}: PR #630 is probably merged"
    else:
        assert staged == ref, f"decision differs for {ip}: staged={staged} ref={ref}"


@pytest.mark.parametrize("ip", IP_CORPUS)
def test_ip_is_blocked_parity(ip: str) -> None:
    _assert_ip_parity(ipaddress.ip_address(ip))


def test_cgnat_is_the_whole_declared_divergence_and_it_is_real() -> None:
    """The declared CGNAT set must be exactly 100.64.0.0/10, and must differ today."""
    for ip in (CGNAT.network_address, CGNAT.broadcast_address, ipaddress.ip_address("100.96.1.1")):
        assert staged_ssrf._ip_is_blocked(ip) and not ref_ssrf._ip_is_blocked(ip)
    for ip in (CGNAT.network_address - 1, CGNAT.broadcast_address + 1):
        assert staged_ssrf._ip_is_blocked(ip) == ref_ssrf._ip_is_blocked(ip)


try:
    from hypothesis import HealthCheck, given, settings
    from hypothesis import strategies as st
except ImportError:  # pragma: no cover - hypothesis is an optional test dependency
    given = None

if given is not None:
    _NETS = [
        "100.64.0.0/10", "100.0.0.0/8", "0.0.0.0/8", "169.254.0.0/16", "192.0.0.0/24",
        "::ffff:0:0/96", "64:ff9b::/96", "2002::/16", "2001::/23", "fe80::/10", "fec0::/10",
        "fc00::/7", "ff00::/8", "::/8",
    ]
    _IPS = st.one_of(
        st.ip_addresses(v=4),
        st.ip_addresses(v=6),
        *[st.ip_addresses(network=n) for n in _NETS],
    )
    _HYP = settings(
        max_examples=1500,
        deadline=None,
        database=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
    )

    @_HYP
    @given(ip=_IPS)
    def test_ip_is_blocked_parity_property(ip) -> None:
        _assert_ip_parity(ip)


# ═══════════════════════════════════════════════════════════════════════════
# Boundary jail
# ═══════════════════════════════════════════════════════════════════════════

@pytest.fixture
def tree(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    """A sandbox home with a workspace, an ~/.openclaw, siblings, and hostile symlinks."""
    home = tmp_path / "home"
    ws = home / "ws"
    oc = home / ".openclaw"
    (oc / "agents" / "a").mkdir(parents=True)
    (oc / "agents" / "a" / "SOUL.md").write_text("x")
    (ws / "real_dir").mkdir(parents=True)
    (ws / "real_dir" / "file.txt").write_text("x")
    (ws / ".env").write_text("x")
    (home / "ws-evil").mkdir()
    (tmp_path / "outside.txt").write_text("x")
    links = {
        "link_out": tmp_path / "outside.txt",
        "link_up": tmp_path,
        "link_in": ws / "real_dir",
        "dangling": tmp_path / "nope",
        "link_oc": oc,
        "chain1": ws / "chain2",
        "chain2": tmp_path / "outside.txt",
        "loop1": ws / "loop2",
        "loop2": ws / "loop1",
        "dotlink": ws / ".env",
        "rel_up": Path("../.."),
    }
    try:
        for name, target in links.items():
            (ws / name).symlink_to(target)
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"symlinks unavailable: {exc}")
    # The reference jail derives its OpenClaw deny root from Path.home().
    monkeypatch.setenv("HOME", str(home))
    assert Path.home() == home
    return {"tmp": tmp_path, "home": home, "ws": ws}


PATH_CORPUS = [
    "data/result.json", "output.txt", "real_dir/file.txt", "a/b/../c", "a/./b", "./a", "a//b",
    "../x", "../../../../../../etc/shadow", "/etc/passwd", "//etc/passwd", "{ws}/inside.txt",
    "{ws}", "{ws}/", "{tmp}/outside.txt", "{home}/ws-evil/x", "../ws-evil/x", "../ws", "..",
    ".", "a/..", "a/../", ".env", ".env/", ".env//", "./.env", "sub/.secret", "sub/.secret/",
    ".git/config", "~/x", "~", "link_out", "link_up/outside.txt", "link_up/home/ws/x",
    "link_in/file.txt", "link_in/../real_dir/file.txt", "dangling", "link_oc/agents/a/SOUL.md",
    "link_oc", "chain1", "loop1", "loop1/x", "dotlink", "rel_up/ws/x", "rel_up/outside.txt",
    "unicode-ä/ß.txt", "a\x00b", "x" * 300, "x" * 5000,
    ".openclaw/agents/a/SOUL.md", ".openclaw/", ".openclaw", "{home}/.openclaw",
    "{home}/.openclaw/agents", "ws/link_oc/agents/a/SOUL.md", "ws/../.openclaw/x",
]


def _expand(path_tpl: str, tree: dict[str, Path]) -> str:
    return path_tpl.format(**{k: str(v) for k, v in tree.items()}) if "{" in path_tpl else path_tpl


def _category(msg: str) -> str:
    for prefix, cat in (
        ("Dotfile rejected", "dotfile"),
        ("Path traversal rejected", "traversal"),
        ("OpenClaw workspace denied", "deny"),
        ("Denied root", "deny"),
        ("Symlink rejected on write", "symlink"),
        ("Symlink in path rejected on write", "symlink-ancestor"),
    ):
        if msg.startswith(prefix):
            return cat
    return "other"


def _jail_outcome(fn, *args, **kwargs):
    try:
        result = fn(*args, **kwargs)
        return ("ok", None if result is None else str(result))
    except ValueError as exc:
        return ("err", _category(str(exc)), str(exc))
    except Exception as exc:
        return ("raise", type(exc).__name__, str(exc))


def _assert_jail_parity(path_str: str, boundary: Path) -> str:
    """Assert parity for one vector; return the reference outcome category."""
    deny = [Path.home() / ".openclaw"]
    ref = _jail_outcome(ref_boundary.assert_inside_boundary, path_str, boundary)
    staged_eq = _jail_outcome(
        staged_boundary.assert_inside_boundary, path_str, boundary, deny_roots=deny
    )
    staged_default = _jail_outcome(staged_boundary.assert_inside_boundary, path_str, boundary)
    if ref[:2] == ("err", "deny"):
        # Declared: same decision with an equivalent deny root, generic message...
        assert staged_eq[:2] == ("err", "deny"), (path_str, staged_eq)
        assert staged_eq[2].startswith("Denied root: ")
        # ...and no built-in deny root by default.
        expected_path = os.path.realpath(str(boundary / path_str))
        assert staged_default == ("ok", expected_path), (path_str, staged_default)
        return "deny"
    assert staged_eq == ref, path_str
    assert staged_default == ref, path_str
    return ref[1] if ref[0] == "err" else ref[0]


@pytest.mark.parametrize("which", ["ws", "home"])
def test_assert_inside_boundary_parity(tree, which: str) -> None:
    boundary = tree[which]
    seen = {_assert_jail_parity(_expand(p, tree), boundary) for p in PATH_CORPUS}
    # Corpus sanity: every outcome class is exercised.
    expected = {"ok", "dotfile", "traversal"} | ({"deny"} if which == "home" else set())
    assert expected <= seen, seen


@pytest.mark.parametrize("which", ["ws", "home"])
def test_assert_no_symlink_parity(tree, which: str) -> None:
    boundary = tree[which]
    seen = set()
    for p in PATH_CORPUS:
        target = boundary / _expand(p, tree)
        staged = _jail_outcome(staged_boundary.assert_no_symlink, target)
        ref = _jail_outcome(ref_boundary.assert_no_symlink, target)
        assert staged == ref, p
        seen.add(staged[1] if staged[0] == "err" else staged[0])
    assert {"ok", "symlink", "symlink-ancestor"} <= seen or which == "home", seen


def test_boundary_parity_with_symlinked_boundary(tree) -> None:
    alias = tree["tmp"] / "ws_alias"
    alias.symlink_to(tree["ws"])
    for p in PATH_CORPUS:
        _assert_jail_parity(_expand(p, tree), alias)


def test_staged_jail_has_no_environment_helpers() -> None:
    for name in ("workspace_root", "file_write_root", "_openclaw_home"):
        assert hasattr(ref_boundary, name)
        assert not hasattr(staged_boundary, name)


if given is not None:
    _TOKENS = [
        "..", ".", "a", "real_dir", "file.txt", ".env", "link_out", "link_up", "link_in",
        "link_oc", "agents", "dangling", "chain1", "loop1", "rel_up", "ws", "home", "ws-evil",
        ".openclaw", "", "~", "dotlink", "outside.txt",
    ]
    _PATHS = st.tuples(
        st.sampled_from(["", "/", "{ws}/", "{home}/", "{tmp}/"]),
        st.lists(st.sampled_from(_TOKENS), min_size=1, max_size=7),
        st.sampled_from(["", "/"]),
    ).map(lambda t: t[0] + "/".join(t[1]) + t[2])

    @settings(
        max_examples=600,
        deadline=None,
        database=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
    )
    @given(path_tpl=_PATHS, which=st.sampled_from(["ws", "home"]))
    def test_boundary_parity_property(tree, path_tpl: str, which: str) -> None:
        _assert_jail_parity(_expand(path_tpl, tree), tree[which])
        target = tree[which] / _expand(path_tpl, tree)
        assert _jail_outcome(staged_boundary.assert_no_symlink, target) == _jail_outcome(
            ref_boundary.assert_no_symlink, target
        )
