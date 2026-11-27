"""AlienClaw evolution layer — population storage, selection, generational evolution."""
from .population import Population
from .types import EvolutionConfig, GenerationStats, PopulationEntry

__all__ = ["EvolutionConfig", "PopulationEntry", "GenerationStats", "Population"]
