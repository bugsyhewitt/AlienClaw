"""docs/parity.md must equal a fresh render of its inputs (gate G3 evidence drift test).

Run: python3 -m pytest tools/test_render_parity.py -q
If the first test fails, an input changed: run python3 tools/render_parity.py, review the
diff of docs/parity.md, and commit it with the change that caused it.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
_SPEC = importlib.util.spec_from_file_location("render_parity", HERE / "render_parity.py")
assert _SPEC is not None and _SPEC.loader is not None
render_parity = importlib.util.module_from_spec(_SPEC)
sys.modules["render_parity"] = render_parity  # dataclasses resolve their module by name
_SPEC.loader.exec_module(render_parity)

ROOT = render_parity.default_root()
PAGE = render_parity.default_out()


def test_committed_page_equals_a_fresh_render() -> None:
    assert PAGE.is_file(), f"{PAGE} is missing: run python3 tools/render_parity.py"
    assert PAGE.read_text(encoding="utf-8") == render_parity.render(ROOT), (
        "docs/parity.md is stale: run python3 tools/render_parity.py and commit the result"
    )


def test_every_policy_entry_has_exactly_one_row() -> None:
    doc = json.loads((ROOT / render_parity.POLICY).read_text(encoding="utf-8"))
    page = PAGE.read_text(encoding="utf-8")
    rows = [line for line in page.splitlines() if line.startswith("| ") and "| `" in line]
    for entry in doc["entries"]:
        hits = [r for r in rows if r.split(" | ")[1] == f"`{entry['id']}`"]
        assert len(hits) == 1, entry["id"]


def test_check_mode_reports_a_stale_page(tmp_path: Path) -> None:
    stale = tmp_path / "parity.md"
    shutil.copyfile(PAGE, stale)
    assert render_parity.main(["--check", "--out", str(stale)]) == 0
    stale.write_text(stale.read_text(encoding="utf-8") + "edited by hand\n", encoding="utf-8")
    assert render_parity.main(["--check", "--out", str(stale)]) == 1


def test_any_input_edit_changes_the_render(tmp_path: Path) -> None:
    """A rationale-only edit must make the page stale (the header carries input hashes)."""
    for rel in ("policy", "vectors/DIFFERENCES.md", "vectors/ssrf-vectors.json"):
        source = ROOT / rel
        target = tmp_path / rel
        if source.is_dir():
            shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__"))
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    assert render_parity.render(tmp_path) == render_parity.render(ROOT)
    policy = tmp_path / render_parity.POLICY
    before = policy.read_text(encoding="utf-8")
    after = before.replace('"rationale": "Loopback."', '"rationale": "Loopback (edited)."', 1)
    assert after != before, "fixture rationale not found; pick another entry"
    policy.write_text(after, encoding="utf-8")
    assert render_parity.render(tmp_path) != render_parity.render(ROOT)


SUMMARY = """\
Of 10 vectors, **4 differ**. Python is the stricter side on 3 vectors, and TS on 1.

## Summary by range

| Group | Range / rule | Vectors | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| [g1](#g1) | a range | 3 | block | allow | block |
| [g2](#g2) | a spelling | 1 (one left) | allow | block | reject |
| [g3](#g3) | resolved | 0 (resolved) | block | block | block |

## Next section
"""


def test_parse_differences_reads_counts_and_rows() -> None:
    parsed = render_parity.parse_differences(SUMMARY)
    assert (parsed.total, parsed.differ, parsed.prose_stricter) == (10, 4, (3, 1))
    assert [(r.group, r.vectors, r.python, r.ts) for r in parsed.rows] == [
        ("g1", 3, "block", "allow"), ("g2", 1, "allow", "block"), ("g3", 0, "block", "block"),
    ]


@pytest.mark.parametrize("broken", [
    SUMMARY.replace("**4 differ**", "4 differ"),
    SUMMARY.replace("## Summary by range", "## Summary"),
    SUMMARY.replace("| Strictest wins |", "| Strictest |"),
    SUMMARY.replace("| 3 | block |", "| three | block |"),
])
def test_parse_differences_fails_loudly_on_a_changed_shape(broken: str) -> None:
    with pytest.raises(render_parity.RenderError):
        render_parity.parse_differences(broken)
