"""In-process stand-ins for necromancer's ``mangle`` and ``ouija`` packages.

The staged fitness adapters import mangle / ouija at module import time. The
tests must never run the real fuzzer (mangle spawns ffmpeg / libde265 decoder
subprocesses), never talk to Ollama, and must not need necromancer checked out.
``install()`` registers these fakes in ``sys.modules`` before any tuner module
is imported, so the adapters bind to them whatever is on ``sys.path``.

Each fake mirrors only the surface the adapters use, with the real semantics as
read from necromancer/projects/{mangle,ouija} when this package was staged:

  mangle.engine      fuzz_file (raises: tests replace the adapter's binding),
                     make_scheduler re-exported from mangle.scheduler
  mangle.scheduler   UniformScheduler, AdaptiveScheduler (same validation), make_scheduler
  mangle.coverage    coverage_report(output_dir): reads results.jsonl; crash + abort
                     outcomes count as crash_aborts; total_iterations = record count
  ouija.encoders     CARRIERS / CARRIER_ORDER (same seven pure transforms)
  ouija.oracle       Verdict, Oracle.judge_text_marker (marker substring => hit)
  ouija.findings     measure(probe_fn, *, repeats): asr = hits / max(1, repeats)
  ouija.targets      Turn; RawLLM (send raises: tests replace the adapter's binding)

``test_dependency_conformance.py`` checks this surface against the real sources
(AST only, nothing imported or executed) when necromancer is present.
"""

from __future__ import annotations

import base64
import codecs
import json
import sys
import types
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

FAKE_MARKER = "__necromancer_tuners_fake__"


# ---------------------------------------------------------------------------
# mangle
# ---------------------------------------------------------------------------

class UniformScheduler:
    name = "uniform"

    def __init__(self, mutators: list[str]):
        if not mutators:
            raise ValueError("scheduler requires a non-empty mutator pool")
        self.mutators = list(mutators)


@dataclass
class AdaptiveScheduler:
    mutators: list[str]
    alpha: float = 1.0
    beta: float = 1.0
    exploration_floor: float = 0.02

    def __post_init__(self) -> None:
        if not self.mutators:
            raise ValueError("scheduler requires a non-empty mutator pool")
        if self.alpha <= 0 or self.beta <= 0:
            raise ValueError("alpha and beta must be positive")
        n = len(self.mutators)
        if not 0.0 <= self.exploration_floor <= 1.0 / n:
            raise ValueError("exploration_floor must be in [0, 1/len(mutators)]")


def make_scheduler(strategy: str, mutators: list[str]):
    if strategy == "uniform":
        return UniformScheduler(mutators)
    if strategy == "adaptive":
        return AdaptiveScheduler(mutators)
    raise ValueError(f"unknown scheduler strategy '{strategy}'")


def fuzz_file(*args: Any, **kwargs: Any):
    raise RuntimeError(
        "fake mangle.engine.fuzz_file called: a test must replace "
        "necromancer_tuners.mangle.fitness_adapter.fuzz_file"
    )


REWARD_OUTCOMES = frozenset({"crash", "abort"})


@dataclass
class MutatorCoverage:
    mutator: str
    iterations: int = 0
    crash_aborts: Any = 0


@dataclass
class CoverageReport:
    total_iterations: Any = 0
    mutators: list[MutatorCoverage] = field(default_factory=list)


def coverage_report(output_dir: str | Path, frame_depth: int = 3) -> CoverageReport:
    results_path = Path(output_dir) / "results.jsonl"
    if not results_path.exists():
        raise FileNotFoundError(f"no results.jsonl in {output_dir}")
    iters: Counter[str] = Counter()
    crashes: Counter[str] = Counter()
    for line in results_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        name = rec.get("mutator", "unknown")
        iters[name] += 1
        if rec.get("outcome", "") in REWARD_OUTCOMES:
            crashes[name] += 1
    return CoverageReport(
        total_iterations=sum(iters.values()),
        mutators=[
            MutatorCoverage(mutator=n, iterations=iters[n], crash_aborts=crashes[n])
            for n in sorted(iters)
        ],
    )


def write_results_jsonl(output_dir: str | Path, outcomes: list[tuple[str, str]]) -> Path:
    """Write a results.jsonl shaped like mangle's IterationResult rows."""
    path = Path(output_dir) / "results.jsonl"
    with path.open("w") as fh:
        for i, (mutator, outcome) in enumerate(outcomes):
            fh.write(json.dumps({
                "iteration": i,
                "mutator": mutator,
                "seed_rng": 0,
                "outcome": outcome,
                "returncode": -11 if outcome == "crash" else 0,
                "bytes_changed": 1,
                "detail": "",
                "crash_hash": None,
            }) + "\n")
    return path


# ---------------------------------------------------------------------------
# ouija
# ---------------------------------------------------------------------------

# Latin -> Cyrillic confusables (same seven letters as ouija.encoders._HOMO).
_HOMO = str.maketrans({
    "a": "а", "c": "с", "e": "е", "o": "о",
    "p": "р", "x": "х", "y": "у",
})

CARRIERS: dict[str, Callable[[str], str]] = {
    "plain": lambda s: s,
    "b64": lambda s: base64.b64encode(s.encode("utf-8")).decode("ascii"),
    "hex": lambda s: s.encode("utf-8").hex(),
    "rot13": lambda s: codecs.encode(s, "rot_13"),
    "homoglyph": lambda s: s.translate(_HOMO),
    "zwsp": lambda s: "​".join(s),
    "utag": lambda s: "".join(chr(0xE0000 + ord(c)) if ord(c) < 0x80 else c for c in s),
}
CARRIER_ORDER = ("plain", "b64", "hex", "rot13", "homoglyph", "zwsp", "utag")


@dataclass
class Turn:
    sent: str | dict
    received: str | dict
    tool_calls: list[dict] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    def received_text(self) -> str:
        if isinstance(self.received, str):
            return self.received
        return str(self.received)


@dataclass
class Verdict:
    effect: str | None
    confidence: float
    evidence: str

    @property
    def hit(self) -> bool:
        return self.effect is not None


class Oracle:
    def __init__(self, oob=None) -> None:
        self._oob = oob

    def judge_text_marker(self, turn: Turn, marker: str, effect: str) -> Verdict:
        text = turn.received_text()
        if marker and marker in text:
            return Verdict(effect, 0.9, "response leaked planted marker")
        return Verdict(None, 0.0, "")


async def measure(probe_fn, *, repeats: int = 20, rng=None) -> dict:
    outcomes: list[int] = []
    for _ in range(max(1, repeats)):
        v = await probe_fn()
        outcomes.append(1 if v.hit else 0)
    asr = sum(outcomes) / len(outcomes)
    return {"asr": round(asr, 4), "n": len(outcomes)}


class RawLLM:
    kind = "raw_llm"

    def __init__(
        self,
        url: str,
        *,
        api_key_env: str | None = None,
        request_template: str | None = None,
        response_path: str | None = None,
        timeout: float = 20.0,
    ) -> None:
        self.url = url

    async def send(self, payload: str | dict) -> Turn:
        raise RuntimeError(
            "fake ouija RawLLM.send called: a test must replace "
            "necromancer_tuners.ouija.fitness_adapter.RawLLM"
        )


def scripted_raw_llm(reply: Callable[[str], Any]):
    """Return (RawLLM subclass, call log). ``reply(payload)`` gives the model text.

    If ``reply`` returns an exception instance, ``send`` raises it (transport
    failure / timeout). The log records every constructor call and payload.
    """
    log: dict[str, list] = {"init": [], "sent": []}

    class ScriptedRawLLM(RawLLM):
        def __init__(self, url: str, **kwargs: Any) -> None:
            super().__init__(url, **kwargs)
            log["init"].append({"url": url, **kwargs})

        async def send(self, payload: str | dict) -> Turn:
            log["sent"].append(payload)
            out = reply(payload)
            if isinstance(out, BaseException):
                raise out
            return Turn(sent=payload, received=out)

    return ScriptedRawLLM, log


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def _module(name: str, package: bool = False, **attrs: Any) -> types.ModuleType:
    mod = types.ModuleType(name)
    if package:
        mod.__path__ = []  # a package with no on-disk submodules
    mod.__dict__.update(attrs)
    setattr(mod, FAKE_MARKER, True)
    return mod


def install() -> None:
    """Register the fakes in sys.modules (idempotent)."""
    if getattr(sys.modules.get("mangle"), FAKE_MARKER, False):
        return
    scheduler = _module(
        "mangle.scheduler",
        UniformScheduler=UniformScheduler,
        AdaptiveScheduler=AdaptiveScheduler,
        make_scheduler=make_scheduler,
    )
    engine = _module("mangle.engine", fuzz_file=fuzz_file, make_scheduler=make_scheduler)
    coverage = _module(
        "mangle.coverage",
        coverage_report=coverage_report,
        CoverageReport=CoverageReport,
        MutatorCoverage=MutatorCoverage,
    )
    mangle = _module("mangle", package=True, engine=engine, scheduler=scheduler,
                     coverage=coverage)

    encoders = _module("ouija.encoders", CARRIERS=CARRIERS, CARRIER_ORDER=CARRIER_ORDER)
    oracle = _module("ouija.oracle", Oracle=Oracle, Verdict=Verdict)
    findings = _module("ouija.findings", measure=measure)
    base = _module("ouija.targets.base", Turn=Turn)
    raw_llm = _module("ouija.targets.raw_llm", RawLLM=RawLLM)
    targets = _module("ouija.targets", package=True, base=base, raw_llm=raw_llm)
    ouija = _module("ouija", package=True, encoders=encoders, oracle=oracle,
                    findings=findings, targets=targets)

    for mod in (mangle, engine, scheduler, coverage,
                ouija, encoders, oracle, findings, targets, base, raw_llm):
        sys.modules[mod.__name__] = mod
