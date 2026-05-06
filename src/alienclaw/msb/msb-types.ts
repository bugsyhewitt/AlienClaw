/**
 * msb-types.ts
 * Types for .msb MartianBrain files.
 *
 * A MartianBrain is CONDITIONING TEXT ONLY — never control logic.
 * (Hard invariant: MSB describes behavior, it does not implement it.)
 *
 * Each .msb file MUST document:
 *   - What each of the 4 genome sections represents for this tool
 *   - What variables are available in the execution context
 */

/**
 * One machine-readable parameter declaration from a brain's PARAMETER_SCHEMA.
 * Mirrors Python ParameterSchemaField in brains/types.py.
 */
export interface ParameterSchemaField {
  /** Parameter name, e.g. 'max_attempts' */
  name:        string;
  /** Which genome section: 'EXECUTION' or 'BEHAVIOR' */
  section:     'EXECUTION' | 'BEHAVIOR';
  /** Byte within that section (0..63) */
  byteOffset:  number;
  /** How to decode the raw character into a typed value */
  encoding:    string;
  /** Return type */
  type:        'int' | 'float' | 'bool';
  /** Value used when decoding fails */
  default:     number | boolean;
}

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

export interface MartianBrain {
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
  /**
   * Machine-readable parameter schema — typed field definitions that the
   * Python decoder reads to extract behavioral parameters from a genome.
   * Empty array for brains that haven't yet declared a schema.
   */
  parameterSchema: ParameterSchemaField[];
}

export interface MsbValidationResult {
  valid:  boolean;
  errors: string[];
}
