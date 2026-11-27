"""necromancer_tuners — GA campaign tuners for necromancer's fuzzers.

Subpackages:
    necromancer_tuners.mangle  evolves mangle (H.265 fuzzer) campaign configs;
                               fitness = crash rate on a fixed seed
    necromancer_tuners.ouija   evolves ouija indirect-prompt-injection carriers
                               against a local Ollama model; fitness = injection ASR

Both run on the alienclaw_ga engine (genome codec + GA spine). They are staged
copies of the in-tree AlienClaw ``mangle_tuner`` and ``ouija_tuner``; see
README.md and PROVENANCE.json.
"""

__version__ = "0.0.0.dev0"
