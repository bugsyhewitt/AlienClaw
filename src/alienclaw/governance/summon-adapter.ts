/**
 * Martian summon adapter — interface + mock.
 *
 * Packet 6 mocks the cross-language boundary with MockMartianSummonAdapter.
 * Packet 7 replaces it with a real adapter that calls into the Python
 * genome/brain layers (src/alienclaw/genome/ and src/alienclaw/brains/).
 *
 * WHY this interface design: field set is what Packet 7 needs to populate
 * when calling the real Python bridge — not what Packet 6 finds convenient.
 * The mock has the same shape so the swap-in is clean.
 */

// ── Request/Result ─────────────────────────────────────────────────────────

export interface MartianSummonRequest {
  /** Unique ID for this summon — used as correlation ID in fitness reports. */
  summon_id:    string;
  /** Canonical 256-char Base62 genome the Martian is born with. */
  genome:       string;
  /** Martian type — must match a registered brain selector in the registry. */
  martian_type: string;
  /** Inputs from the summoner (Specialist or, in Packet 6, CreatorBot directly). */
  inputs:       Record<string, unknown>;
  /** Hard wall on how long the Martian may run (ms). */
  timeout_ms:   number;
}

export interface MartianSummonResult {
  summon_id: string;
  /** True if the Martian completed without error. */
  ok:        boolean;
  /** The Martian's structured output (per the brain's output contract). */
  output?:   Record<string, unknown>;
  /** Error description if ok=false. */
  error?:    string;
  /** Fitness score in [0.0, 1.0] computed by the runtime. */
  fitness:   number;
  /** Metadata about the run — tool call count, wall-clock time, etc. */
  run_metadata: {
    tool_calls:    number;
    wall_clock_ms: number;
    [key: string]: unknown;
  };
}

// ── Adapter interface ──────────────────────────────────────────────────────

export interface MartianSummonAdapter {
  summon(request: MartianSummonRequest): Promise<MartianSummonResult>;
}

// ── Mock for Packet 6 ──────────────────────────────────────────────────────

/**
 * Deterministic mock adapter for Packet 6.
 *
 * Same request in → same result out. Tests can set fixedFitness and
 * fixedOutput to exercise different paths in the goal loop without
 * calling real Python code.
 *
 * Packet 7 replaces this with a real adapter that:
 * 1. Decodes the genome (via src/alienclaw/genome/codec.py)
 * 2. Resolves the martian_type to a BrainSpec (via src/alienclaw/brains/registry.py)
 * 3. Executes the brain's execution order with the decoded genome params
 * 4. Returns the output + computed fitness
 */
export class MockMartianSummonAdapter implements MartianSummonAdapter {
  constructor(
    private readonly fixedFitness: number = 0.75,
    private readonly fixedOutput:  Record<string, unknown> = { mock: true, value: 42 },
    private readonly shouldFail:   boolean = false,
    private readonly failMessage:  string  = 'Mock adapter failure',
  ) {}

  async summon(request: MartianSummonRequest): Promise<MartianSummonResult> {
    if (this.shouldFail) {
      return {
        summon_id:    request.summon_id,
        ok:           false,
        error:        this.failMessage,
        fitness:      0.0,
        run_metadata: { tool_calls: 0, wall_clock_ms: 0 },
      };
    }

    return {
      summon_id:    request.summon_id,
      ok:           true,
      output:       { ...this.fixedOutput, echoed_martian_type: request.martian_type },
      fitness:      this.fixedFitness,
      run_metadata: {
        tool_calls:    1,
        wall_clock_ms: 1,
        martian_type:  request.martian_type,
      },
    };
  }
}
