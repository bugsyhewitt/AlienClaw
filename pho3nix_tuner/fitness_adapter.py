"""Fitness adapter: wraps the offline RewardModel for AlienClaw GA consumption.

This module connects AlienClaw's RunMartianCallback interface to the offline
reward model. The fitness score for a candidate genome is the model's estimated
reward for the decoded param config in the target context bucket.

STOP gate: if inspect_history fires (stop_gate=True), every genome gets
fitness=0.0 and the GA is a no-op. The caller (run_ga.py) checks the STOP
gate BEFORE starting the GA and aborts early — this adapter is the last line
of defence only.
"""

from __future__ import annotations

from pathlib import Path

from pho3nix_tuner.genome_schema import decode_pho_config
from pho3nix_tuner.inspect_history import TARGET_TOOLS, inspect
from pho3nix_tuner.reward_model import RewardModel


def make_fitness_callback(
    history_path: Path,
    target_tool: str,
    target_context_key: str,
):
    """Return an AlienClaw-compatible RunMartianCallback for the GA loop.

    RunMartianCallback signature: Callable[[str, str], FitnessReport]
      — takes (martian_type, genome), returns FitnessReport.

    The returned callback:
      1. Decodes the genome to a Pho3nix param config (PHO00001 schema).
      2. Converts the config to a numeric param vector for the target tool.
      3. Queries the offline RewardModel for the estimated reward in the
         target context bucket.
      4. Returns a FitnessReport(fitness=reward).

    Returns fitness=0.0 on any decoding or model error.

    Args:
        history_path:        Path to the imported run_history JSON file.
        target_tool:         Tool to optimise for ("gobuster", "nmap", "sqlmap").
        target_context_key:  Context bucket key (e.g. "gobuster|https").
    """
    if target_tool not in TARGET_TOOLS:
        raise ValueError(f"target_tool must be one of {TARGET_TOOLS}, got {target_tool!r}")

    # Pre-flight check
    report = inspect(history_path)
    stop_gate_fired = report["stop_gate"]

    if not stop_gate_fired:
        model = RewardModel.from_file(history_path)
    else:
        model = None  # will return 0.0 for every genome

    def callback(martian_type: str, genome: str):  # noqa: ARG001
        from alienclaw.evolution.generation import FitnessReport  # noqa: PLC0415

        if model is None:
            return FitnessReport(fitness=0.0)

        try:
            cfg = decode_pho_config(genome)
            # Build a numeric param vector for the target tool
            if target_tool == "gobuster":
                candidate_params = {
                    "threads": float(cfg["threads"]),
                    "delay_ms": float(cfg["delay_ms"]),
                    "timeout_sec": float(cfg["timeout_sec"]),
                }
            elif target_tool == "nmap":
                candidate_params = {"timing_t": float(cfg["timing_t"])}
            else:
                candidate_params = {}

            fitness = model.estimate(target_tool, target_context_key, candidate_params)
        except Exception:
            fitness = 0.0

        return FitnessReport(fitness=max(0.0, min(1.0, fitness)))

    return callback


def evaluate_config(
    config: dict,
    model: RewardModel,
    target_tool: str,
    target_context_key: str,
) -> float:
    """Synchronous reward estimate for a decoded config (used by run_ga baselines)."""
    if target_tool == "gobuster":
        candidate_params = {
            "threads": float(config["threads"]),
            "delay_ms": float(config["delay_ms"]),
            "timeout_sec": float(config["timeout_sec"]),
        }
    elif target_tool == "nmap":
        candidate_params = {"timing_t": float(config["timing_t"])}
    else:
        candidate_params = {}
    return float(
        max(0.0, min(1.0, model.estimate(target_tool, target_context_key, candidate_params)))
    )
