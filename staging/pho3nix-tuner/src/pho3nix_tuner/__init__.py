"""pho3nix_tuner — AlienClaw × Pho3nix GA PoC (Phase 3).

Offline profile tuner: evolves Pho3nix tool parameter profiles using AlienClaw's
GA, scored by a reward model fit from real rig run-history imported from xil-1 or
sentry. Alfred's local history is synthetic smoke-test noise — the Step-1 STOP gate
in inspect_history.py correctly catches it before any GA run.

Sub-packages:
  genome_schema   — PHO00001 codec (gobuster/nmap gene space)
  inspect_history — Step-1 pre-flight data inspection (the hard STOP gate)
  reward_model    — Scalar reward from run_history entries; k-NN with shrinkage
  fitness_adapter — AlienClaw RunMartianCallback wrapping the reward model
  run_ga          — GA runner (mirrors ouija_tuner/run_ga.py)
  tooltime_bounds — Min/max/direction documentation for in-scope tool params

Version: 0.0.0.dev0 (staged copy; in-tree pho3nix_tuner says 0.1.0)
"""

__version__ = "0.0.0.dev0"
