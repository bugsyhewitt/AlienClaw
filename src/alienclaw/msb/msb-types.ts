/**
 * msb-types.ts
 * Types for .msb MeeseeksBrain files.
 *
 * A MeeseeksBrain is CONDITIONING TEXT ONLY — never control logic.
 * (Hard invariant: MSB describes behavior, it does not implement it.)
 *
 * Each .msb file MUST document:
 *   - What each of the 4 genome sections represents for this tool
 *   - What variables are available in the execution context
 */

/**
 * Documents what each genome section (0–3) encodes for a specific tool.
 * Written by CreatorBot; read by humans and AdvisorBot for debugging/tuning.
 */
export interface GenomeSectionDocs {
  /** Section 0 (IDENTITY, chars 0–63): what the identity bits mean for this tool */
  identity:  string;
  /** Section 1 (EXECUTION, chars 64–127): what the execution bits encode */
  execution: string;
  /** Section 2 (BEHAVIOR, chars 128–191): what the behavior bits encode */
  behavior:  string;
  /** Section 3 (CHECKSUM, chars 192–255): always "FNV-1a checksum of sections 0–2" */
  checksum:  string;
}

export interface MeeseeksBrain {
  /** Tool name this brain conditions, e.g. "web_search" */
  tool:        string;
  version:     string;
  capabilities: string;
  limitations:  string;
  failureModes: string;
  bestPractices: string;
  /** Ordered execution steps */
  executionOrder: string[];
  /** JSON schema string describing expected output */
  outputContract: string;
  /**
   * Documents what each genome section encodes for this specific tool.
   * Used by AdvisorBot and CreatorBot to interpret and tune genomes.
   */
  genomeSections: GenomeSectionDocs;
  /**
   * Documents variables available in the execution context.
   * Key: variable name. Value: description of what it contains.
   */
  variables: Record<string, string>;
}

export interface MsbValidationResult {
  valid:  boolean;
  errors: string[];
}
