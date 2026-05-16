"""Migration: rename pre-16 per-tool population dirs to <tool>_alone.

Usage:
    PYTHONPATH=src python3 -m alienclaw.evolution migrate-pre-packet-16

Idempotent: safe to run multiple times.
"""
from __future__ import annotations

from pathlib import Path


TOOL_NAMES = {
    "compute", "extract_json", "file_read", "file_write",
    "http_get", "search_text", "url_fetch", "web_search",
}


def migrate(populations_root: Path | None = None) -> dict[str, str]:
    """Rename <tool> population dirs to <tool>_alone.

    Returns a dict of {old_name: new_name} for dirs that were renamed.
    Idempotent: if <tool>_alone already exists, the <tool> dir is left alone.
    """
    from alienclaw.evolution.storage import populations_root as default_root
    root = populations_root if populations_root is not None else default_root()
    if not root.exists():
        return {}

    renamed: dict[str, str] = {}
    for tool in sorted(TOOL_NAMES):
        old_path = root / tool
        new_path = root / f"{tool}_alone"
        if old_path.exists() and old_path.is_dir() and not new_path.exists():
            old_path.rename(new_path)
            renamed[tool] = f"{tool}_alone"
    return renamed
