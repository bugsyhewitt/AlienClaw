/**
 * Proposer — Sonnet renders reflections into valid Genome objects.
 *
 * applyMutation: takes a ReflectionResult and produces a new valid Genome.
 * merge: system-aware merge of two Pareto-optimal candidates.
 *
 * INVARIANT: proposer NEVER persists an invalid genome.
 * assertValidGenome is called before returning any Genome.
 */
import type { Genome, CandidateScore, ReflectionResult } from "./types.js";
import { assertValidGenome, InvalidGenomeError, contentHash } from "./genome-codec.js";

export interface Proposer {
  applyMutation(parent: Genome, reflection: ReflectionResult): Promise<Genome>;
  merge(a: CandidateScore, b: CandidateScore): Promise<Genome>;
}

// ── Mock proposer for tests ──────────────────────────────────────────────────

export class MockProposer implements Proposer {
  private readonly store: Map<string, Genome>;

  constructor(genomeStore: Map<string, Genome> = new Map()) {
    this.store = genomeStore;
  }

  async applyMutation(parent: Genome, reflection: ReflectionResult): Promise<Genome> {
    // No-op: mutate the editable component only, keep raw unchanged
    // In a real proposer, Sonnet would re-encode the raw string.
    // For tests, we produce a new genome with the updated editable.
    const newEditable = { ...parent.editable, [reflection.component]: reflection.proposedValue };
    const child: Genome = {
      ...parent,
      editable: newEditable,
      // Keep id/raw same for no-op; in production Sonnet re-generates raw
    };
    // If proposedValue is genuinely different, we'd need a new raw string.
    // For the mock, the raw stays the same, id stays the same (dedup is fine).
    assertValidGenome(child);
    return child;
  }

  async merge(a: CandidateScore, b: CandidateScore): Promise<Genome> {
    // Take the genome from the store for each candidate, blend editables
    const ga = this.store.get(a.genomeId);
    const gb = this.store.get(b.genomeId);
    if (!ga || !gb) throw new Error("Genome not found in mock store for merge");

    // System-aware merge: take each parent's winning components
    // With one component today (tool_slots), take the one from the higher-correctness parent
    const aWins = a.aggregate.correctness >= b.aggregate.correctness;
    const merged: Genome = {
      ...( aWins ? ga : gb ),
      editable: {
        ...gb.editable,
        ...( aWins ? ga.editable : gb.editable ),
      },
    };
    assertValidGenome(merged);
    return merged;
  }
}

/**
 * Validate and retry helper used by real Proposer implementations.
 * A proposer that produces an invalid genome must not persist it.
 */
export async function withRetryAndValidation(
  fn: () => Promise<Genome>,
  maxRetries: number,
  knownTools?: Set<string>,
): Promise<Genome> {
  let lastError: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const g = await fn();
      assertValidGenome(g, knownTools);
      return g;
    } catch (e) {
      if (e instanceof InvalidGenomeError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError ?? new InvalidGenomeError("Max retries exceeded");
}
