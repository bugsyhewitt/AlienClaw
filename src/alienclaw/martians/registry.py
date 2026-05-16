"""MartianRegistry — loads and indexes all .martian files."""
from __future__ import annotations
from pathlib import Path
from typing import Any

from .parser import parse_martian, MartianParseError
from .types import MartianSpec
from .validator import validate_martian


class MartianRegistry:
    """Read-only registry of MartianSpec objects."""

    def __init__(self, specs: list[MartianSpec]) -> None:
        self._by_type: dict[str, MartianSpec] = {}
        self._ordered: list[MartianSpec] = []
        for spec in specs:
            self._by_type[spec.martian_type] = spec
            self._ordered.append(spec)
        # Aliases: single-slot Martians named "<tool>_alone" → also register as "<tool>"
        for spec in specs:
            if spec.martian_type.endswith("_alone") and len(spec.slots) == 1:
                bare_name = spec.martian_type[: -len("_alone")]
                if bare_name not in self._by_type:
                    self._by_type[bare_name] = spec

    def get(self, martian_type: str) -> MartianSpec:
        if martian_type not in self._by_type:
            raise KeyError(
                f"Unknown martian_type '{martian_type}'. "
                f"Available: {sorted(self._by_type.keys())}"
            )
        return self._by_type[martian_type]

    def has(self, martian_type: str) -> bool:
        return martian_type in self._by_type

    def all(self) -> list[MartianSpec]:
        """Return the primary Martian types (not aliases)."""
        return list(self._ordered)

    @classmethod
    def load(cls, martians_dir: str | Path, brain_registry: Any) -> "MartianRegistry":
        """Load all *.martian files from the directory.

        Hard-fails (raises) on any parse or validation error.
        """
        seed_path = Path(martians_dir)
        if not seed_path.is_dir():
            raise FileNotFoundError(f"Martians directory not found: {martians_dir}")

        specs: list[MartianSpec] = []
        seen: set[str] = set()

        for martian_file in sorted(seed_path.glob("*.martian")):
            content = martian_file.read_text(encoding="utf-8")
            spec = parse_martian(content, str(martian_file))

            if spec.martian_type in seen:
                raise ValueError(
                    f"Duplicate martian_type '{spec.martian_type}' in {martian_file}."
                )
            seen.add(spec.martian_type)

            result = validate_martian(spec, brain_registry)
            if not result.valid:
                raise ValueError(
                    f"Invalid .martian file {martian_file}: {'; '.join(result.errors)}"
                )

            specs.append(spec)

        return cls(specs)
