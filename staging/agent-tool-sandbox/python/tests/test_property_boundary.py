"""Property: the boundary jail never hands back a path outside the root or naming a dotfile.

A fixed tmp tree holds directories, files, dotfiles and dot-directories, and hostile symlinks
(relative and absolute escapes, a symlink to the root's parent, to a sibling whose name has
the root's name as a prefix, to a dotfile and a dot-directory, dangling links, self and
mutual loops, a link into a denied root). Generated paths are made of those names, ``..``,
``.``, empty segments, dot-names, odd names, trailing slashes and absolute prefixes.

``assert_inside_boundary(path, root, deny_roots=...)`` must either

  - return ``os.path.realpath(root / path)``, which is the root or inside it (checked with
    ``os.path.commonpath``, not with the jail's string-prefix test), is not inside a denied
    root, and whose final component (unless it is the root) does not start with '.', while
    the input's own final naming component does not start with '.' either; or
  - raise ``ValueError`` (never ``OSError`` or anything else).

It must also reject exactly when one of those documented rules is broken.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

hypothesis = pytest.importorskip("hypothesis")
from hypothesis import HealthCheck, event, given, settings  # noqa: E402
from hypothesis import strategies as st  # noqa: E402

from agent_tool_sandbox import assert_inside_boundary  # noqa: E402

_SCALE = max(1, int(os.environ.get("ATS_PROPERTY_SCALE", "1")))


@pytest.fixture(scope="module")
def tree(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    base = tmp_path_factory.mktemp("jail")
    root = base / "root"
    for d in ("a/b", ".git", "sub", "denied/inner", "outside-dummy"):
        (root / d).mkdir(parents=True)
    for f in ("a/file.txt", "a/.env", ".git/config", ".env", "sub/x.txt", "denied/inner/f"):
        (root / f).write_text("x")
    (base / "outside").mkdir()
    (base / "outside" / "secret.txt").write_text("x")
    (base / "root-evil").mkdir()
    (base / "root-evil" / "x.txt").write_text("x")
    links = {
        "link_in": "a", "link_file": "a/file.txt", "link_out": str(base / "outside"),
        "link_out_file": str(base / "outside" / "secret.txt"), "link_up": "..",
        "link_abs_root": str(root), "link_dot": ".env", "link_dotdir": ".git",
        "dangling": "nope", "dangling_out": "../nope_outside", "loop": "loop",
        "loop_a": "loop_b", "loop_b": "loop_a", "a/up2": "../..",
        "sub/link_sibling": "../../root-evil", "link_denied": "denied",
        "a/link_env": "../.env",
    }
    for name, target in links.items():
        os.symlink(target, root / name)
    return {"base": base, "root": root, "denied": root / "denied"}


_SEGMENTS = st.sampled_from([
    "a", "b", "sub", "file.txt", "x.txt", "config", "inner", "f", "new", "root", "root-evil",
    "outside", "secret.txt", ".env", ".git", ".hidden", "..", "..", ".", "", "...", "..foo",
    "link_in", "link_file", "link_out", "link_out_file", "link_up", "link_abs_root",
    "link_dot", "link_dotdir", "dangling", "dangling_out", "loop", "loop_a", "up2",
    "link_sibling", "denied", "link_denied", "link_env", " ", "a b", "x" * 300, "a\x00b",
])


@st.composite
def _paths(draw: st.DrawFn, tree: dict[str, Path]) -> str:
    path = "/".join(draw(st.lists(_SEGMENTS, max_size=6)))
    prefix = draw(st.sampled_from(["", "", "", "./", "/", "//", "ROOT/", "BASE/"]))
    if prefix == "ROOT/":
        prefix = str(tree["root"]) + "/"
    elif prefix == "BASE/":
        prefix = str(tree["base"]) + "/"
    suffix = draw(st.sampled_from(["", "", "", "/", "/.", "//", "/./"]))
    return prefix + path + suffix


def _inside(path: str, root: str) -> bool:
    return os.path.commonpath([path, root]) == root


def _final_naming_component(path: str) -> str:
    parts = [p for p in path.split("/") if p not in ("", ".")]
    return parts[-1] if parts else ""


def _check(tree: dict[str, Path], path: str, deny_roots) -> str:
    root = tree["root"]
    root_real = os.path.realpath(root)
    denied = [os.path.realpath(d) for d in (
        [deny_roots] if isinstance(deny_roots, (str, os.PathLike)) else deny_roots)]
    try:
        want_path = os.path.realpath(str(root / path))
    except ValueError:  # an embedded NUL: nothing to resolve
        want_path = None
    rules_broken = (
        want_path is None
        or os.path.basename(path).startswith(".")
        or _final_naming_component(path).startswith(".")
        or not _inside(want_path, root_real)
        or (want_path != root_real and os.path.basename(want_path).startswith("."))
        or any(_inside(want_path, d) for d in denied)
    )
    try:
        got = assert_inside_boundary(path, root, deny_roots=deny_roots)
    except ValueError:
        assert rules_broken, f"rejected although no documented rule is broken: {path!r}"
        return "rejected"

    assert not rules_broken, f"accepted although a documented rule is broken: {path!r} -> {got}"
    assert isinstance(got, Path)
    assert str(got) == want_path
    assert _inside(str(got), root_real)
    assert got == Path(root_real) or not got.name.startswith(".")
    assert not any(_inside(str(got), d) for d in denied)
    return "accepted"


def _settings(max_examples: int) -> settings:
    return settings(
        max_examples=max_examples * _SCALE,
        derandomize=True,
        database=None,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
    )


@_settings(600)
@given(data=st.data(), deny=st.sampled_from(["none", "list", "single"]))
def test_jail_result_is_inside_and_never_a_dotfile(tree, data, deny) -> None:
    path = data.draw(_paths(tree), label="path")
    deny_roots = {"none": (), "list": [tree["denied"]], "single": str(tree["denied"])}[deny]
    event(_check(tree, path, deny_roots))


@pytest.mark.parametrize("path", [
    "a/file.txt", "", ".", "./", "a/..", "a/.env/", "a/.env/./", "link_dot", "link_dotdir/config",
    "link_up/outside/secret.txt", "a/up2/root-evil/x.txt", "sub/link_sibling/x.txt",
    "link_abs_root/a/file.txt", "loop", "loop_a/x", "dangling", "dangling_out", "link_env",
    "link_denied/inner/f", "a/b/../../link_out", "x" * 300, "a\x00b", "//etc/passwd",
    "link_up/root/a/file.txt", "link_up/root-evil/x.txt",
])
@pytest.mark.parametrize("deny", ["none", "list"])
def test_jail_examples(tree, path, deny) -> None:
    _check(tree, path, {"none": (), "list": [tree["denied"]]}[deny])

