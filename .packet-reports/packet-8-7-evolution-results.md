# Packet 8.7 — Evolution Results

## Summary

Packet 8.7 confirmed what Packet 8.6 first showed: the genome evolution mechanism produces directed improvement on the `search_text` Martian. The second run (different RNG state due to Packet 8.7's additional MSB params) produced the same convergence curve.

---

## search_text evolution — Packet 8.7 run

**Config:** population_size=16, generations=50, seed=42  
**Input:** 20-line text, pattern="fox" (20 matches)  
**Fitness formula:** `1.0 × 1/max_results` (search_text tool_calls = max_results)

| Gen | Mean fitness | Max fitness | Min fitness | Distinct genomes |
| --- | --- | --- | --- | --- |
| 0 | 0.528 | 1.000 | 0.100 | 16 |
| 1 | 0.872 | 1.000 | 0.125 | 13 |
| 2 | 1.000 | 1.000 | 1.000 | 14 |
| 4 | 1.000 | 1.000 | 1.000 | 15 |
| 9 | 1.000 | 1.000 | 1.000 | 13 |
| 19 | 1.000 | 1.000 | 1.000 | 13 |
| 49 | 1.000 | 1.000 | 1.000 | 14 |

**Initial mean fitness:** 0.000 (uneval seeds)  
**Final mean fitness:** 1.000  
**Convergence:** 3 generations  
**Improved:** ✓

---

## Interpretation

The evolution curve mirrors Packet 8.6's finding: tournament selection rapidly converges on genomes whose BEHAVIOR[1] byte decodes to max_results=1 (minimum tool calls = maximum fitness). Once a genome with max_results=1 appears in the population, it dominates within 2-3 generations.

The convergence at generation 2 (mean=1.0) is complete. Genetic diversity is maintained (14-16 distinct genomes per generation) despite all having max_fitness=1.0 — this is neutral evolution within the fitness-1.0 basin, where crossover and mutation produce new genomes that also happen to have max_results=1 or quickly converge to it via selection.

---

## Honest assessment of "directed" vs "trivial" evolution

**For search_text:** The evolution IS directed. The fitness signal (1/tool_calls) creates genuine selection pressure. Genomes with max_results=1 are ~10× more fit than genomes with max_results=10. Tournament selection finds this optimum in 3 generations.

**For previously-BLIND runners (http_get, file_read, etc.):** The audit confirms these runners now respond to genome content — different genomes produce different outputs. However, all these runners return tool_calls=1 and correctness=1.0 for successful operations. Their fitness is always 1.0, so evolution on them shows only "trivial improvement" (0→1 from uneval to eval), not directed improvement.

**Implication for Packet 10:** The leaderboard can rank genomes on search_text meaningfully. Genomes with max_results=1 (fewest tool calls) will naturally rise to the top. For other runners where fitness is binary (1.0 success or 0.0 failure), the leaderboard will rank on SUCCESS RATE, which is also meaningful — it rewards genomes that don't fail.

**Path forward:** Wire genome params to tool_calls for more runners. Packet 8.8 candidates: file_read using chunk_count (number of reads to complete the task), http_get using retry_on_4xx (genomes that retry on errors use more tool_calls), search_text context_lines already affects output distinctly.
