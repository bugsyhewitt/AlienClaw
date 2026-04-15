/**
 * msb-loader.ts
 * Read-only .msb file loader.
 *
 * MSB files are conditioning text — they describe HOW a tool behaves
 * so that Martian can invoke it correctly. No executable logic lives here.
 *
 * Required sections:
 *   TOOL, VERSION, CAPABILITIES, LIMITATIONS, FAILURE MODES,
 *   BEST PRACTICES, EXECUTION ORDER, OUTPUT CONTRACT,
 *   GENOME SECTIONS, VARIABLES
 *
 * GENOME SECTIONS documents what each of the 4 genome sections means for
 * this specific tool (used by AdvisorBot/CreatorBot for tuning/debugging).
 *
 * VARIABLES documents the execution-context keys available to this tool.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';

import type { MartianBrain, MsbValidationResult, GenomeSectionDocs } from './msb-types.js';

const REQUIRED_SECTIONS = [
  'TOOL',
  'VERSION',
  'CAPABILITIES',
  'LIMITATIONS',
  'FAILURE MODES',
  'BEST PRACTICES',
  'EXECUTION ORDER',
  'OUTPUT CONTRACT',
  'GENOME SECTIONS',
  'VARIABLES',
] as const;

function extractField(raw: string, fieldName: string): string {
  const re = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const m  = raw.match(re);
  return m ? m[1]!.trim() : '';
}

function extractSection(raw: string, sectionName: string): string {
  // Matches: SECTION NAME:\n<content until next ALL-CAPS heading or end>
  const re = new RegExp(
    `^${sectionName}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z ]+:|$)`,
    'm'
  );
  const m = raw.match(re);
  return m ? m[1]!.trim() : '';
}

function extractExecutionOrder(raw: string): string[] {
  const section = extractSection(raw, 'EXECUTION ORDER');
  if (!section) return [];
  return section
    .split('\n')
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Parse GENOME SECTIONS block.
 * Expected format:
 *   GENOME SECTIONS:
 *   IDENTITY: <description>
 *   EXECUTION: <description>
 *   BEHAVIOR: <description>
 *   CHECKSUM: <description>
 */
function extractGenomeSections(raw: string): GenomeSectionDocs {
  const block = extractSection(raw, 'GENOME SECTIONS');
  const get = (key: string): string => {
    const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1]!.trim() : '';
  };
  return {
    identity:  get('IDENTITY'),
    execution: get('EXECUTION'),
    behavior:  get('BEHAVIOR'),
    checksum:  get('CHECKSUM'),
  };
}

/**
 * Parse VARIABLES block.
 * Expected format:
 *   VARIABLES:
 *   <name>: <description>
 *   <name>: <description>
 */
function extractVariables(raw: string): Record<string, string> {
  const block  = extractSection(raw, 'VARIABLES');
  const result: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^(\S+):\s+(.+)$/);
    if (m) result[m[1]!] = m[2]!.trim();
  }
  return result;
}

export function validateMsb(raw: string): MsbValidationResult {
  const errors: string[] = [];
  for (const section of REQUIRED_SECTIONS) {
    const found = raw.includes(`${section}:`);
    if (!found) errors.push(`Missing required section: ${section}`);
  }
  if (!extractField(raw, 'TOOL'))    errors.push('TOOL field is empty');
  if (!extractField(raw, 'VERSION')) errors.push('VERSION field is empty');
  return { valid: errors.length === 0, errors };
}

export function parseMsbContent(raw: string, sourcePath?: string): MartianBrain {
  const validation = validateMsb(raw);
  if (!validation.valid) {
    const loc = sourcePath ? ` (${sourcePath})` : '';
    throw new Error(
      `MSB validation failed${loc}:\n  ${validation.errors.join('\n  ')}`
    );
  }

  return {
    tool:           extractField(raw, 'TOOL'),
    version:        extractField(raw, 'VERSION'),
    capabilities:   extractSection(raw, 'CAPABILITIES'),
    limitations:    extractSection(raw, 'LIMITATIONS'),
    failureModes:   extractSection(raw, 'FAILURE MODES'),
    bestPractices:  extractSection(raw, 'BEST PRACTICES'),
    executionOrder: extractExecutionOrder(raw),
    outputContract: extractSection(raw, 'OUTPUT CONTRACT'),
    genomeSections: extractGenomeSections(raw),
    variables:      extractVariables(raw),
  };
}

export function loadMsbFile(filePath: string): MartianBrain {
  if (!fs.existsSync(filePath)) {
    throw new Error(`MSB file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseMsbContent(raw, filePath);
}

// ---------------------------------------------------------------------------
// MSB cache — one instance per tool name per process
// ---------------------------------------------------------------------------

const _cache = new Map<string, MartianBrain>();

export function loadMsbCached(
  toolName:  string,
  msbDir:    string,
): MartianBrain {
  const key = `${msbDir}:${toolName}`;
  if (_cache.has(key)) return _cache.get(key)!;
  const filePath = path.join(msbDir, `${toolName}.msb`);
  const brain    = loadMsbFile(filePath);
  _cache.set(key, brain);
  return brain;
}

export function clearMsbCache(): void {
  _cache.clear();
}
