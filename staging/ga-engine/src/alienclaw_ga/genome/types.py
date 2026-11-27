"""Genome section types.

The genome is parsed into four raw 64-character string sections.
This mirrors the TypeScript GenomeSections interface in
src/alienclaw/registry/genome-codec.ts.

The section strings are NOT further decoded here — that is the
responsibility of callers that need specific fields (e.g., retry count,
escalation mode). The genome module works with raw sections.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ParsedGenome:
    """A genome split into its four 64-character sections.

    All four fields are exactly 64 Base62 characters each. The checksum
    field reflects the stored value — use genome.checksum.verify_checksum()
    to check that it matches the computed value.

    Attributes:
        identity:  Section 0 — Martian ID, generation, namespace, family.
        execution: Section 1 — Retry policy, backoff, flow, performance mode.
        behavior:  Section 2 — Escalation mode, output contract type.
        checksum:  Section 3 — FNV-1a of sections 0-2 (read-only; see checksum.py).
    """

    identity: str
    execution: str
    behavior: str
    checksum: str

    def body(self) -> str:
        """Return the mutable 192-char body (identity + execution + behavior)."""
        return self.identity + self.execution + self.behavior

    def full(self) -> str:
        """Reconstruct the full 256-char genome string."""
        return self.identity + self.execution + self.behavior + self.checksum

    # Convenience sub-field accessors (per GENOME_SPEC.md section semantics)

    @property
    def id_tag(self) -> str:
        """The 8-character Martian ID tag from the IDENTITY section (chars 0-7)."""
        return self.identity[:8]

    @property
    def generation_marker(self) -> str:
        """The 2-character generation marker from IDENTITY (chars 8-9)."""
        return self.identity[8:10]

    @property
    def namespace(self) -> str:
        """The 10-character origin namespace from IDENTITY (chars 10-19)."""
        return self.identity[10:20]

    @property
    def retry_count(self) -> int:
        """Decoded retry count from EXECUTION section char 0.

        Decode: (ord(char) - 48) % 5 + 1 → range [1, 5].
        """
        return (ord(self.execution[0]) - 48) % 5 + 1

    @property
    def backoff_ms(self) -> int:
        """Decoded backoff interval in milliseconds from EXECUTION section char 1.

        Decode: (ord(char) - 48) % 10 * 500 → range [0, 4500ms].
        """
        return (ord(self.execution[1]) - 48) % 10 * 500

    @property
    def fail_forward(self) -> bool:
        """True if the escalation mode is fail-forward ('F'), False for standard ('E').

        Per GENOME_SPEC.md §11: 'E' = EscalateStd (failForward=False),
        'F' = FailForward (failForward=True). Any other char defaults to False.
        """
        return self.behavior[0] == "F"
