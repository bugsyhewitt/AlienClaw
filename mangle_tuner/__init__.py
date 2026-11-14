"""mangle_tuner — AlienClaw GA adapter for the mangle H.265 fuzzer.

Phase 1 of the AlienClaw repurpose roadmap:
  - Replace AlienClaw's self-referential fitness with real external fitness
    from mangle's crash-rate metric.
  - Encode mangle campaign config as a checksummed AlienClaw genome.
  - Reuse AlienClaw's selection/mutation/crossover operators unchanged.

Requires both projects on sys.path (see run_ga.py for setup).
"""
