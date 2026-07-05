# Governance-Integrated Evolution Loop

## What was closed
run_experiment (src/alienclaw/evolution/experiment.py) already ran N generations
headless with fitness feeding tournament selection and per-generation persistence
(storage.py). The open link was governance: generations advanced unconditionally.
A GovernanceGate seam (src/alienclaw/evolution/governance_gate.py) is now consulted
after every generation; a halt stops the run cleanly, leaving the Martian
population persisted and resumable.

## How to run
    python3 -m alienclaw.evolution run-experiment --martian-type compute \
        --generations 3 --population-size 5 --seed 42

## Programmatic gate
    from alienclaw.evolution.experiment import run_experiment
    from alienclaw.evolution.governance_gate import GateDecision
    class MyGate:
        def review(self, generation, stats) -> GateDecision:
            return GateDecision(approved=stats.mean_fitness >= 0.0)
    pop, stats = run_experiment(config, run_martian, generations=3, governance_gate=MyGate())

## Resume
Populations persist under ALIENCLAW_POPULATIONS_ROOT (default ~/.alienclaw/populations).
Re-invoking run_experiment with the same EvolutionConfig calls Population.load_or_create,
continuing from the last persisted generation.

## Production wiring (engineering only)
- Adapt the TypeScript governance decision (BossBot/AdvisorBot review of the Martian
  population) into a GovernanceGate via the bridge, mirroring run_martian.
- Surface each GateDecision.reason into the governance OnlineFitnessLog for audit.
