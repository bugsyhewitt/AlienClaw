# Parked: Governance Engine (v0.2 candidate)

This folder holds the "Meeseeks genome" governance engine originally built for AlienClaw v0.1. It is **parked** and not shipped by v0.1's installer. The v0.1 installer instead wires three OpenClaw-native agents with `AGENTS.md` routing — a much simpler model.

This code is preserved for a possible future v0.2 that adds:

- 256-char Base62 genomes for execution bots
- Genome fitness evolution
- A full state-machine governance loop

To revisit: see `alienclaw-HANDOFF-v0.9.md` at the repo root for the original design doc.

## Do not reference this folder from the installer or from runtime paths.
