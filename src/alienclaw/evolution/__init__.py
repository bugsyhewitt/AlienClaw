"""AlienClaw evolution layer — population storage, selection, generational evolution."""
from .types import EvolutionConfig, PopulationEntry, GenerationStats
from .population import Population

__all__ = ["EvolutionConfig", "PopulationEntry", "GenerationStats", "Population"]
