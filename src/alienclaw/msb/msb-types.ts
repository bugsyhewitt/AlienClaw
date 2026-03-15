/**
 * msb-types.ts
 * Types for .msb MeeseeksBrain files.
 *
 * A MeeseeksBrain is CONDITIONING TEXT ONLY — never control logic.
 * (Hard invariant #7 from handoff doc.)
 */

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
}

export interface MsbValidationResult {
  valid:  boolean;
  errors: string[];
}
