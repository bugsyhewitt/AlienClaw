"""Opt-in diagnostic infrastructure for AlienClaw.

Enabled only when ALIENCLAW_DIAGNOSTICS=1. Production paths are
byte-identical when the flag is absent or any other value.
"""
from .instrumentation import CaptureHook, is_enabled

__all__ = ["CaptureHook", "is_enabled"]
