"""Mangle fitness adapter for the AlienClaw GA.

Runs a bounded mangle fuzz campaign for a candidate genome's config and
returns a scalar fitness = crash_rate (total_crash_aborts / total_iterations).

This is the "real external fitness" that replaces AlienClaw's self-referential
correctness score. The fitness signal is:
  - Deterministic for a fixed (seed_file, seed_rng, iterations)
  - Cheap and local (no third-party targets)
  - Reproducible (can re-run a genome on any machine with mangle installed)

Usage:
    from mangle_tuner.fitness_adapter import evaluate_genome
    fitness = evaluate_genome(genome_str, seed_file="clean.h265", seed_rng=0,
                              iterations=100, work_dir="/tmp/mangle-eval")
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup — add both projects to sys.path
# ---------------------------------------------------------------------------
_TUNER_DIR = Path(__file__).parent
_AC_SRC = _TUNER_DIR.parent / "src"
_NMC_MANGLE_SRC = Path.home() / "dev" / "necromancer" / "projects" / "mangle" / "src"

for _p in (_AC_SRC, _NMC_MANGLE_SRC):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from alienclaw.evolution.generation import FitnessReport  # noqa: E402
from mangle.coverage import coverage_report  # noqa: E402
import mangle.engine as _mangle_engine  # noqa: E402
from mangle.engine import fuzz_file  # noqa: E402
from mangle.scheduler import AdaptiveScheduler, UniformScheduler  # noqa: E402

from .genome_schema import decode_mangle_config  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Default decoder — ffmpeg is assumed installed; swap to libde265 if preferred
_DEFAULT_DECODER: str = "ffmpeg"

# ---------------------------------------------------------------------------
# Scheduler injection
# ---------------------------------------------------------------------------

def _make_patched_make_scheduler(config: dict):
    """Return a make_scheduler replacement that injects our config params.

    mangle.engine.make_scheduler(strategy, mutators) creates AdaptiveScheduler
    with defaults (alpha=1.0, beta=1.0, ef=0.02). To evolve those params we
    monkey-patch make_scheduler before each call, restoring it in `finally`.
    This is a PoC technique; Phase 1b should extend mangle's API properly.
    """
    alpha = config.get("alpha", 1.0)
    beta  = config.get("beta", 1.0)
    ef    = config.get("exploration_floor", 0.02)

    def patched(strategy: str, mutators: list[str]):
        if strategy == "adaptive":
            # Clamp exploration_floor to the valid range [0, 1/len(mutators)]
            safe_ef = min(ef, 1.0 / len(mutators) if mutators else 0.0)
            return AdaptiveScheduler(
                mutators=mutators,
                alpha=alpha,
                beta=beta,
                exploration_floor=safe_ef,
            )
        return UniformScheduler(mutators)

    return patched


# ---------------------------------------------------------------------------
# Core evaluation function
# ---------------------------------------------------------------------------

def run_mangle_candidate(
    config: dict,
    seed_file: str | Path,
    seed_rng: int,
    iterations: int,
    work_dir: str | Path | None = None,
) -> float:
    """Run one bounded mangle campaign and return the crash rate.

    Args:
        config:     Mangle campaign config (from decode_mangle_config or a dict).
        seed_file:  Path to the H.265 seed file.
        seed_rng:   RNG seed for the campaign (fix this for reproducibility).
        iterations: Number of mutate+decode cycles (the budget).
        work_dir:   Parent directory for the temp output dir; defaults to /tmp.

    Returns:
        crash_rate: total_crash_aborts / total_iterations in [0.0, 1.0].
        Returns 0.0 on any error (missing seed, fuzz failure, missing output).
    """
    seed_path = Path(seed_file)
    if not seed_path.exists():
        return 0.0

    output_dir = Path(tempfile.mkdtemp(prefix="mangle-eval-", dir=work_dir))

    # Inject our config's alpha/beta/ef into the adaptive scheduler.
    # Restore the original make_scheduler in finally — this is a serial GA,
    # so there's no concurrency hazard.
    _orig_make_scheduler = _mangle_engine.make_scheduler
    _mangle_engine.make_scheduler = _make_patched_make_scheduler(config)

    try:
        fuzz_file(
            seed_path=seed_path,
            output_dir=output_dir,
            iterations=iterations,
            decoder=_DEFAULT_DECODER,
            timeout=config.get("timeout", 5.0),
            seed_rng=seed_rng,
            concurrency=config.get("concurrency", 4),
            strategy=config.get("strategy", "uniform"),
            scheduler_state=None,  # cold start each eval (reproducible)
            crash_dedup=False,  # keep results.jsonl honest (all crashes counted)
        )

        results_path = output_dir / "results.jsonl"
        if not results_path.exists():
            return 0.0

        report = coverage_report(output_dir)
        total_crash_aborts = sum(m.crash_aborts for m in report.mutators)
        total_iters = report.total_iterations
        if total_iters == 0:
            return 0.0
        return total_crash_aborts / total_iters

    except Exception:  # noqa: BLE001 — any error is a 0.0 score
        return 0.0

    finally:
        # Restore the original make_scheduler before cleaning up
        _mangle_engine.make_scheduler = _orig_make_scheduler
        # Always clean up the temp directory, even on failure
        shutil.rmtree(output_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# AlienClaw RunMartianCallback adapter
# ---------------------------------------------------------------------------

def make_fitness_callback(
    seed_file: str | Path,
    seed_rng: int,
    iterations: int,
    work_dir: str | Path | None = None,
):
    """Return a RunMartianCallback that evaluates mangle genomes.

    The returned callable has signature:
        (martian_type: str, genome: str) -> FitnessReport

    Compatible with alienclaw.evolution.generation.RunMartianCallback.

    Usage:
        from mangle_tuner.fitness_adapter import make_fitness_callback
        callback = make_fitness_callback("clean.h265", seed_rng=0, iterations=100)
        report = callback("mangle", genome_str)
        print(report.fitness)  # crash rate in [0, 1]
    """
    def _callback(martian_type: str, genome: str) -> FitnessReport:
        config = decode_mangle_config(genome)
        fitness = run_mangle_candidate(
            config=config,
            seed_file=seed_file,
            seed_rng=seed_rng,
            iterations=iterations,
            work_dir=work_dir,
        )
        return FitnessReport(
            fitness=fitness,
            run_metadata={
                "martian_type": martian_type,
                "config": config,
                "seed_file": str(seed_file),
                "seed_rng": seed_rng,
                "iterations": iterations,
            },
        )

    return _callback


# ---------------------------------------------------------------------------
# Direct evaluation (bypasses genome codec — takes a config dict directly)
# ---------------------------------------------------------------------------

def evaluate_config(
    config: dict,
    seed_file: str | Path,
    seed_rng: int,
    iterations: int,
    work_dir: str | Path | None = None,
) -> float:
    """Evaluate a config dict directly (for baseline comparison).

    Same as run_mangle_candidate — just a named alias for clarity in
    run_ga.py's baseline section.
    """
    return run_mangle_candidate(config, seed_file, seed_rng, iterations, work_dir)
