/**
 * registry.ts — Append-only TS brain registry (T4, PKT-P1).
 *
 * Mirrors the Python BrainRegistry at src/alienclaw/brains/registry.py.
 * Each entry declares the brain's id, name, version, input/output types,
 * annotation class, cost class, and conformance fixtures file.
 *
 * Rules:
 *   - Brain ids are APPEND-ONLY. Never renumber or remove an id.
 *   - Codon values 0..7 map to the 8 defined brains.
 *   - Codon values 8..61 are RESERVED no-ops (documented below).
 *   - msb_version tracks the minimum MSB spec version required by this registry.
 */

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Value types that brains produce and consume. */
export type BrainIOType =
  | 'text'
  | 'bytes'
  | 'json'
  | 'number'
  | 'matches'
  | 'path'
  | 'url'
  | 'none';

/** Annotation class: what the brain may do in the jail. */
export type AnnotationClass =
  | 'read-only'       // may only read; no network, no writes
  | 'additive-in-jail' // may write only within the jail's output directory
  | 'open-world';     // makes outbound network requests (SSRF-guarded)

/** Cost class: billing tier for genome fitness accounting. */
export type CostClass = 'free' | 'local' | 'network' | 'heavy';

export interface BrainEntry {
  /** Numeric codon value (0-based, append-only). Never renumber. */
  id:               number;
  /** Tool name — matches the TOOL: line in the .msb file. */
  name:             string;
  /** MSB VERSION field. */
  version:          string;
  /** Declared input type. */
  in:               BrainIOType;
  /** Declared output type. */
  out:              BrainIOType;
  /** Jail annotation class. */
  annotation_class: AnnotationClass;
  /** Cost class for fitness accounting. */
  cost_class:       CostClass;
  /** Path to the conformance fixtures file (relative to repo root). */
  fixtures:         string;
  /** If true, this brain is deprecated and should not be used in new genomes. */
  deprecated?:      boolean;
}

// ---------------------------------------------------------------------------
// MSB registry version
// ---------------------------------------------------------------------------

/** Minimum MSB spec version required by this registry. */
export const MSB_VERSION = '1.0';

// ---------------------------------------------------------------------------
// The 8 defined brains (append-only; ids 0-7)
// ---------------------------------------------------------------------------

export const BRAIN_REGISTRY: ReadonlyArray<BrainEntry> = [
  {
    id:               0,
    name:             'compute',
    version:          '1.0',
    in:               'text',
    out:              'json',
    annotation_class: 'read-only',
    cost_class:       'local',
    fixtures:         'test/fixtures/genome-spec-fixtures.json',
  },
  {
    id:               1,
    name:             'extract_json',
    version:          '1.0',
    in:               'json',
    out:              'json',
    annotation_class: 'read-only',
    cost_class:       'free',
    fixtures:         'test/fixtures/genome-spec-fixtures.json',
  },
  {
    id:               2,
    name:             'file_read',
    version:          '1.0',
    in:               'path',
    out:              'text',
    annotation_class: 'read-only',
    cost_class:       'free',
    fixtures:         'test/fixtures/genome-spec-fixtures.json',
  },
  {
    id:               3,
    name:             'file_write',
    version:          '1.0',
    in:               'text',
    out:              'path',
    annotation_class: 'additive-in-jail',
    cost_class:       'free',
    fixtures:         'test/fixtures/genome-spec-fixtures.json',
  },
  {
    id:               4,
    name:             'http_get',
    version:          '1.0',
    in:               'url',
    out:              'text',
    annotation_class: 'open-world',
    cost_class:       'network',
    fixtures:         'test/fixtures/genome-spec-fixtures.json',
  },
  {
    id:               5,
    name:             'search_text',
    version:          '1.0',
    in:               'text',
    out:              'matches',
    annotation_class: 'read-only',
    cost_class:       'local',
    fixtures:         'test/fixtures/genome-spec-fixtures.json',
  },
  {
    id:               6,
    name:             'url_fetch',
    version:          '1.0',
    in:               'url',
    out:              'text',
    annotation_class: 'open-world',
    cost_class:       'network',
    fixtures:         'test/fixtures/genome-spec-fixtures.json',
  },
  {
    id:               7,
    name:             'web_search',
    version:          '1.0',
    in:               'text',
    out:              'json',
    annotation_class: 'open-world',
    cost_class:       'network',
    fixtures:         'test/fixtures/genome-spec-fixtures.json',
  },
] as const;

// ---------------------------------------------------------------------------
// Reserved / no-op codon values (8..61)
// ---------------------------------------------------------------------------

/**
 * Codon values 8..61 are reserved for future brains.
 * At runtime they behave as no-ops: the Martian skips that slot.
 * They MUST NOT be assigned to new brains without appending a new BrainEntry
 * to BRAIN_REGISTRY above.
 */
export const RESERVED_CODON_RANGE = { min: 8, max: 61 } as const;

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

/** Look up a brain by its numeric codon id (0-7). Returns undefined for reserved values. */
export function getBrainById(id: number): BrainEntry | undefined {
  return BRAIN_REGISTRY.find((b) => b.id === id);
}

/** Look up a brain by its tool name. Returns undefined if not found. */
export function getBrainByName(name: string): BrainEntry | undefined {
  return BRAIN_REGISTRY.find((b) => b.name === name);
}

/** All registered brain names in id order. */
export function allBrainNames(): string[] {
  return [...BRAIN_REGISTRY].sort((a, b) => a.id - b.id).map((b) => b.name);
}

// ---------------------------------------------------------------------------
// Codon → brain mapping with no-op sentinel
// ---------------------------------------------------------------------------

export interface CodonMapping {
  codon:   number;
  brain?:  BrainEntry;  // undefined = reserved no-op
  is_noop: boolean;
}

/** Map every codon value 0..61 to a brain or no-op. */
export function allCodonMappings(): CodonMapping[] {
  const result: CodonMapping[] = [];
  for (let codon = 0; codon <= 61; codon++) {
    const brain = getBrainById(codon);
    result.push({ codon, brain, is_noop: !brain });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Composition validity (T5)
// ---------------------------------------------------------------------------

/**
 * Declared coercions: output type → set of input types it can feed into.
 * A coercion means the types are compatible (possibly with an implicit cast).
 */
const COERCIONS: ReadonlyMap<BrainIOType, ReadonlySet<BrainIOType>> = new Map([
  ['json',    new Set<BrainIOType>(['text', 'json'])],   // json → text (stringify)
  ['text',    new Set<BrainIOType>(['text', 'json'])],   // text → json (attempt parse)
  ['matches', new Set<BrainIOType>(['text', 'json'])],   // matches → text/json (format)
  ['path',    new Set<BrainIOType>(['text', 'path'])],   // path → text
  ['url',     new Set<BrainIOType>(['text', 'url'])],    // url → text
  ['number',  new Set<BrainIOType>(['text', 'number'])], // number → text
  ['bytes',   new Set<BrainIOType>(['bytes', 'text'])],  // bytes → text (decode)
  ['none',    new Set<BrainIOType>(['none'])],            // none can't feed anything
]);

export type CompositionResult = 'valid' | 'repairable' | 'invalid';

/**
 * Check whether `outputType` is compatible with `inputType` as an adjacency
 * in a brain chain.
 * - 'valid'     — exact type match
 * - 'repairable' — a declared coercion exists
 * - 'invalid'   — no coercion; this chain pair produces a smooth penalty
 */
export function checkComposition(
  outputType: BrainIOType,
  inputType: BrainIOType,
): CompositionResult {
  if (outputType === inputType) return 'valid';
  const allowed = COERCIONS.get(outputType);
  if (allowed?.has(inputType)) return 'repairable';
  return 'invalid';
}

/**
 * Validate the full chain of brains in a genome slot sequence.
 * Returns the worst classification across all adjacent pairs.
 * An empty chain or single-brain chain is always 'valid'.
 */
export function validateChain(brains: BrainEntry[]): CompositionResult {
  if (brains.length <= 1) return 'valid';
  let worst: CompositionResult = 'valid';
  for (let i = 0; i < brains.length - 1; i++) {
    const result = checkComposition(brains[i]!.out, brains[i + 1]!.in);
    if (result === 'invalid') return 'invalid';
    if (result === 'repairable') worst = 'repairable';
  }
  return worst;
}
