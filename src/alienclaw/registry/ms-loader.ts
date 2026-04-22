/**
 * ms-loader.ts
 * READ-ONLY .ms file parser and validator.
 *
 * .ms file format (in order):
 *   [GENOME]
 *   <256-char Base62 genome — 4 sections × 64 chars>
 *
 *   # MS_XXXXXXXX
 *   # description: <text>
 *   # generation: <int>
 *   # status: active | retired | graveyard
 *   # fitness: <float 0.0-1.0>
 *
 *   [TOOLS]
 *   <tool_name> → <filename>.msb   (max 4 tools)
 *   ...
 *
 *   [GRAVEYARD]
 *   # <fitness> G<generation> <genome>
 *
 * Hard rules enforced:
 *  - Only parses. Never writes. Writing is CreatorBot's exclusive domain.
 *  - Genome hard invariants checked via genome-codec.
 *  - Max 4 tools per Martian (MAX_MS_TOOLS).
 *  - Malformed files throw MsParseError — not silently ignored.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';

import { validateGenome, parseGenome } from './genome-codec.js';
import { MAX_MS_TOOLS }                from '../constants.js';
import { errorMessage }                from '../utils.js';
import type { MartianSpec, MartianStatus, GraveyardEntry } from './ms-types.js';

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

function parseMetadata(lines: string[]): Partial<MartianSpec> {
  const spec: Partial<MartianSpec> = {};
  for (const line of lines) {
    const m = line.match(/^#\s*(\w+):\s*(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    switch (key!.toLowerCase()) {
      case 'description': spec.description = val!.trim();  break;
      case 'generation':  spec.generation  = parseInt(val!, 10); break;
      case 'status':      spec.status      = val!.trim() as MartianStatus; break;
      case 'fitness':     spec.fitness     = parseFloat(val!); break;
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

function extractSection(lines: string[], sectionName: string): string | undefined {
  // Line-based extraction: find [SECTION] marker, skip metadata comment/blank
  // lines, collect content until next [SECTION] or end-of-file.
  const startMarker = `[${sectionName}]`;
  const startLine = lines.indexOf(startMarker);
  if (startLine === -1) return undefined;

  // Collect lines after the marker until next [SECTION] or end
  // Skip lines that are blank or are metadata comments (start with #)
  const sectionLines: string[] = [];
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('[')) break;  // hit next section
    if (line.trim() === '' || line.startsWith('#')) continue;  // skip blank/metadata
    sectionLines.push(line);
  }

  const content = sectionLines.join('\n').trim();
  return content || undefined;
}

function parseTools(
  toolsSection: string,
  filePath?: string,
): { tools: string[]; msbRefs: string[] } {
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

  if (tools.length > MAX_MS_TOOLS) {
    throw new MsParseError(
      `[TOOLS] declares ${tools.length} tools — maximum is ${MAX_MS_TOOLS}`,
      filePath
    );
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

// ---------------------------------------------------------------------------
// Public API — read-only
// ---------------------------------------------------------------------------

/**
 * Parse a single .ms file from disk.
 * Throws MsParseError on any format violation or genome invariant breach.
 *
 * Expected file order:
 *   [GENOME] → metadata comments → [TOOLS] → [GRAVEYARD]
 */
export function loadMsFile(filePath: string): MartianSpec {
  const raw   = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  // --- [GENOME] — must be first meaningful section ---
  const genomeSection = extractSection(lines, 'GENOME');
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

  // --- Header metadata (comment lines) ---
  const commentLines = lines.filter(l => l.startsWith('#'));
  const partialSpec  = parseMetadata(commentLines);

  const id = parseFirstCommentId(lines);
  if (!id) throw new MsParseError('Missing Martian ID comment (# MS_XXXXXXXX)', filePath);

  if (!partialSpec.description) throw new MsParseError('Missing # description', filePath);
  if (partialSpec.generation  == null) throw new MsParseError('Missing # generation', filePath);
  if (!partialSpec.status)     throw new MsParseError('Missing # status', filePath);
  if (partialSpec.fitness      == null) throw new MsParseError('Missing # fitness', filePath);

  // --- [TOOLS] ---
  const toolsSection = extractSection(lines, 'TOOLS');
  if (!toolsSection) throw new MsParseError('Missing [TOOLS] section', filePath);
  const { tools, msbRefs } = parseTools(toolsSection, filePath);
  if (tools.length === 0) throw new MsParseError('[TOOLS] section is empty', filePath);

  // --- [GRAVEYARD] ---
  const graveyard = parseGraveyard(extractSection(lines, 'GRAVEYARD'));

  return {
    id,
    description: partialSpec.description,
    generation:  partialSpec.generation,
    status:      partialSpec.status,
    fitness:     partialSpec.fitness,
    tools,
    msbRefs,
    toolTags:    [...tools],
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
): { specs: MartianSpec[]; errors: { file: string; error: string }[] } {
  const errors: { file: string; error: string }[] = [];

  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.ms'));
  } catch {
    if (options.strict) throw new MsParseError(`Registry directory not found: ${dir}`);
    return { specs: [], errors };
  }

  // Revert to sync reads — loadMsFile does its own readFileSync internally,
  // and this function is called at startup (not hot path). Parallelizing
  // would require re-architecting loadMsFile to accept raw content.
  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      specs.push(loadMsFile(fullPath));
    } catch (err) {
      const msg = errorMessage(err);
      errors.push({ file: fullPath, error: msg });
      if (options.strict) throw err;
    }
  }

  return { specs, errors };
}
