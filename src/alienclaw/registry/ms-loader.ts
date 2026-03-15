/**
 * ms-loader.ts
 * READ-ONLY .ms file parser and validator.
 *
 * Hard rules enforced:
 *  - Only parses. Never writes. Writing is CreatorBot's exclusive domain.
 *  - Genome hard invariants checked via genome-codec.
 *  - Malformed files throw MsParseError — not silently ignored.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';

import { validateGenome, parseGenome } from './genome-codec.js';
import type { MeeseeksSpec, MeeseeksStatus, GraveyardEntry } from './ms-types.js';

// ---------------------------------------------------------------------------
// Custom error — lets callers distinguish parse failures from other errors
// ---------------------------------------------------------------------------

export class MsParseError extends Error {
  constructor(message: string, public readonly filePath?: string) {
    super(filePath ? `${filePath}: ${message}` : message);
    this.name = 'MsParseError';
  }
}

// ---------------------------------------------------------------------------
// Section parsers
// ---------------------------------------------------------------------------

function parseHeader(lines: string[]): Partial<MeeseeksSpec> {
  const spec: Partial<MeeseeksSpec> = {};
  for (const line of lines) {
    const m = line.match(/^#\s*(\w+):\s*(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    switch (key.toLowerCase()) {
      case 'description': spec.description = val.trim();  break;
      case 'generation':  spec.generation  = parseInt(val, 10); break;
      case 'status':      spec.status      = val.trim() as MeeseeksStatus; break;
      case 'fitness':     spec.fitness     = parseFloat(val); break;
    }
  }
  return spec;
}

function parseFirstCommentId(lines: string[]): string | undefined {
  for (const line of lines) {
    const m = line.match(/^#\s*(MS_[A-Z0-9]+)\s*$/);
    if (m) return m[1];
  }
  return undefined;
}

function extractSection(raw: string, sectionName: string): string | undefined {
  const re = new RegExp(`\\[${sectionName}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)`);
  const m  = raw.match(re);
  return m ? m[1].trim() : undefined;
}

function parseTools(toolsSection: string): { tools: string[]; msbRefs: string[] } {
  const tools:   string[] = [];
  const msbRefs: string[] = [];
  for (const line of toolsSection.split('\n')) {
    // Accept both numbered ("1. web_search → ...") and unnumbered ("web_search → ...")
    const m = line.match(/^(?:\d+\.\s+)?(\S+)\s*→\s*(\S+\.msb)\s*$/);
    if (m) {
      tools.push(m[1]!);
      msbRefs.push(m[2]!);
    }
  }
  return { tools, msbRefs };
}

function parseGraveyard(graveyardSection: string | undefined): GraveyardEntry[] {
  if (!graveyardSection) return [];
  const entries: GraveyardEntry[] = [];
  for (const line of graveyardSection.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([\d.]+)\s+G(\d+)\s+([0-9A-Za-z]{256})$/);
    if (m) {
      entries.push({
        fitnessScore: parseFloat(m[1]!),
        generation:   parseInt(m[2]!, 10),
        genome:       m[3]!,
      });
    }
  }
  return entries;
}

function deriveToolTags(tools: string[]): string[] {
  return [...tools];
}

// ---------------------------------------------------------------------------
// Public API — read-only
// ---------------------------------------------------------------------------

/**
 * Parse a single .ms file from disk.
 * Throws MsParseError on any format violation or genome invariant breach.
 */
export function loadMsFile(filePath: string): MeeseeksSpec {
  if (!fs.existsSync(filePath)) {
    throw new MsParseError('File not found', filePath);
  }

  const raw   = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  // --- Header metadata ---
  const headerLines = lines.filter(l => l.startsWith('#'));
  const partialSpec = parseHeader(headerLines);

  const id = parseFirstCommentId(lines);
  if (!id) throw new MsParseError('Missing Meeseeks ID comment (# MS_XXXXXXXX)', filePath);

  if (!partialSpec.description) throw new MsParseError('Missing # description', filePath);
  if (partialSpec.generation  == null) throw new MsParseError('Missing # generation', filePath);
  if (!partialSpec.status)     throw new MsParseError('Missing # status', filePath);
  if (partialSpec.fitness      == null) throw new MsParseError('Missing # fitness', filePath);

  // --- [TOOLS] ---
  const toolsSection = extractSection(raw, 'TOOLS');
  if (!toolsSection) throw new MsParseError('Missing [TOOLS] section', filePath);
  const { tools, msbRefs } = parseTools(toolsSection);
  if (tools.length === 0) throw new MsParseError('[TOOLS] section is empty', filePath);

  // --- [GENOME] ---
  const genomeSection = extractSection(raw, 'GENOME');
  if (!genomeSection) throw new MsParseError('Missing [GENOME] section', filePath);

  const genome     = genomeSection.trim();
  const validation = validateGenome(genome);
  if (!validation.valid) {
    throw new MsParseError(
      `Genome validation failed:\n  ${validation.errors.join('\n  ')}`,
      filePath
    );
  }

  void parseGenome(genome); // confirm parse is consistent (throws on bad format)

  // --- [GRAVEYARD] ---
  const graveyard = parseGraveyard(extractSection(raw, 'GRAVEYARD'));

  return {
    id,
    description: partialSpec.description,
    generation:  partialSpec.generation,
    status:      partialSpec.status,
    fitness:     partialSpec.fitness,
    tools,
    msbRefs,
    toolTags:    deriveToolTags(tools),
    genome,
    graveyard,
  };
}

/**
 * Load all .ms files from a directory.
 * Skips files that fail validation when strict=false (default).
 * Throws on first error when strict=true.
 */
export function loadMsDirectory(
  dir:     string,
  options: { strict?: boolean } = {}
): { specs: MeeseeksSpec[]; errors: { file: string; error: string }[] } {
  const specs:  MeeseeksSpec[]                    = [];
  const errors: { file: string; error: string }[] = [];

  if (!fs.existsSync(dir)) {
    if (options.strict) throw new MsParseError(`Registry directory not found: ${dir}`);
    return { specs, errors };
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ms'));
  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      specs.push(loadMsFile(fullPath));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ file: fullPath, error: msg });
      if (options.strict) throw err;
    }
  }

  return { specs, errors };
}
