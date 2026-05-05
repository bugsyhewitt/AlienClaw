"""Brain registry — load and index all .msb files in a directory.

Mirrors the load-and-cache pattern in src/alienclaw/msb/msb-loader.ts
(loadMsbCached). Adds a full-directory loader and queryable catalog.

Loading order: alphabetical by filename (deterministic across runs and
across languages). All files matching *.msb are loaded. Validation
failures (missing required sections) cause a hard error at load time.

The registry is read-only after construction. No mutation API.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .parser import parse_msb
from .types import BrainSpec


@dataclass
class CatalogSummary:
    """Compact summary of the loaded brain catalog.

    Used by the shared fixture to verify cross-language catalog agreement
    without comparing full prose content.

    Attributes:
        brain_count:  Total number of brains loaded.
        tool_names:   Sorted list of tool names.
        versions:     Mapping of tool_name → version string.
        warning_count: Number of SHOULD-violation warnings.
    """

    brain_count: int
    tool_names: list[str]
    versions: dict[str, str]
    warning_count: int


class BrainRegistry:
    """Catalog of loaded MartianBrain files, indexed by tool name.

    Constructed via BrainRegistry.load(). Read-only after construction.

    Attributes:
        warnings: List of SHOULD-level lint warnings from load time.
    """

    def __init__(
        self,
        brains: list[BrainSpec],
        warnings: list[str] | None = None,
    ) -> None:
        self._by_name: dict[str, BrainSpec] = {}
        self._ordered: list[BrainSpec] = []
        self.warnings: list[str] = warnings or []

        for brain in brains:
            self._by_name[brain.tool] = brain
            self._ordered.append(brain)

    # ── Queries ───────────────────────────────────────────────────────────

    def lookup_by_name(self, name: str) -> BrainSpec | None:
        """Return the BrainSpec for the given tool name, or None."""
        return self._by_name.get(name)

    def all_brains(self) -> list[BrainSpec]:
        """Return all loaded brains in load order (alphabetical by filename)."""
        return list(self._ordered)

    def catalog_summary(self) -> CatalogSummary:
        """Return a compact summary for fixture comparison."""
        return CatalogSummary(
            brain_count=len(self._ordered),
            tool_names=sorted(self._by_name.keys()),
            versions={b.tool: b.version for b in self._ordered},
            warning_count=len(self.warnings),
        )

    def __len__(self) -> int:
        return len(self._ordered)

    # ── Factory ───────────────────────────────────────────────────────────

    @classmethod
    def load(cls, seed_dir: str | Path) -> "BrainRegistry":
        """Load all *.msb files from seed_dir in alphabetical order.

        Args:
            seed_dir: Path to the directory containing .msb files.

        Returns:
            A fully-loaded BrainRegistry.

        Raises:
            FileNotFoundError: if seed_dir does not exist.
            ValueError: if any .msb file fails required-section validation.
        """
        seed_path = Path(seed_dir)
        if not seed_path.is_dir():
            raise FileNotFoundError(f"Brain registry directory not found: {seed_dir}")

        msb_files = sorted(seed_path.glob("*.msb"))

        brains: list[BrainSpec] = []
        warnings: list[str] = []
        seen_tools: set[str] = set()

        for msb_file in msb_files:
            content = msb_file.read_text(encoding="utf-8")
            brain = parse_msb(content, str(msb_file))

            # MUST: tool names must be unique within a registry
            if brain.tool in seen_tools:
                raise ValueError(
                    f"Duplicate tool name '{brain.tool}' in {msb_file}. "
                    "Each brain must have a unique tool name."
                )
            seen_tools.add(brain.tool)

            # SHOULD: warn on empty prose sections
            for attr_name, section_name in (
                ("capabilities", "CAPABILITIES"),
                ("failure_modes", "FAILURE MODES"),
            ):
                if not getattr(brain, attr_name):
                    warnings.append(
                        f"{msb_file.name}: {section_name} section is empty (SHOULD be non-empty)"
                    )

            brains.append(brain)

        return cls(brains=brains, warnings=warnings)
