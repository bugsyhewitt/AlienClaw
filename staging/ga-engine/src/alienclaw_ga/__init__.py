"""alienclaw_ga — AlienClaw's genetic-algorithm engine, staged as a standalone package.

Subpackages:
    alienclaw_ga.genome       256-char Base62 genome codec, checksum, operators (stdlib only)
    alienclaw_ga.evolution    population, selection, generation step, storage (stdlib only)
    alienclaw_ga.diagnostics  optional analysis helpers (numpy / scipy / scikit-learn)

Nothing here imports the retired AlienClaw product (bridge, brains, martians,
governance, ...). See README.md and PROVENANCE.json.
"""

__version__ = "0.0.0.dev0"
