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
    `^${sectionName}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z ]+:|(?![\\s\\S]))`,
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
 *
 * Sub-keys (IDENTITY, EXECUTION, BEHAVIOR, CHECKSUM) are themselves ALL-CAPS
 * patterns and would prematurely terminate the extractSection() regex.
 * Instead, find the GENOME SECTIONS header position in raw and search
 * the tail for each sub-key directly.
 *
 * Expected format:
 *   GENOME SECTIONS:
 *   IDENTITY: <description>
 *   EXECUTION: <description>
 *   BEHAVIOR: <description>
 *   CHECKSUM: <description>
 */
function extractGenomeSections(raw: string): GenomeSectionDocs {
  const headerRe = /^GENOME SECTIONS:\s*\n/m;
  const headerMatch = raw.match(headerRe);
  const tail = headerMatch ? raw.slice((headerMatch.index ?? 0) + headerMatch[0].length) : '';
  const get = (key: string): string => {
    const m = tail.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
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

function parseDefault(value: string, type: 'int' | 'float' | 'bool'): number | boolean {
  const v = value.trim().toLowerCase();
  if (type === 'bool') return v === 'true' || v === 'yes' || v === '1';
  if (type === 'float') { const n = parseFloat(value); return isNaN(n) ? 0 : n; }
  const n = parseInt(value, 10); return isNaN(n) ? 0 : n;
}

function extractParameterSchema(raw: string): import('./msb-types.js').ParameterSchemaField[] {
  const block = extractSection(raw, 'PARAMETER_SCHEMA');
  if (!block) return [];
  const fields: import('./msb-types.js').ParameterSchemaField[] = [];
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('|').map(p => p.trim());
    if (parts.length < 6) continue;
    const [name, section, byteOffsetStr, encoding, type, defaultStr] = parts as [string,string,string,string,string,string];
    if (section !== 'EXECUTION' && section !== 'BEHAVIOR') continue;
    if (type !== 'int' && type !== 'float' && type !== 'bool') continue;
    const byteOffset = parseInt(byteOffsetStr, 10);
    if (isNaN(byteOffset)) continue;
    fields.push({ name, section, byteOffset, encoding, type, default: parseDefault(defaultStr, type) });
  }
  return fields;
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
    genomeSections:  extractGenomeSections(raw),
    variables:       extractVariables(raw),
    parameterSchema: extractParameterSchema(raw),
  };
}

export function loadMsbFile(filePath: string): MartianBrain {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`MSB file not found: ${filePath}`);
    }
    throw err;
  }
  return parseMsbContent(raw, filePath);
}

// ---------------------------------------------------------------------------
// MSB cache — one instance per tool name per process
// ---------------------------------------------------------------------------

const MAX_CACHE_SIZE = 64;

const _cache = new Map<string, MartianBrain>();

export function loadMsbCached(
  toolName:  string,
  msbDir:    string,
): MartianBrain {
  const key = `${msbDir}:${toolName}`;
  if (_cache.has(key)) return _cache.get(key)!;
  if (_cache.size >= MAX_CACHE_SIZE) {
    const oldest = _cache.keys().next().value as string;
    _cache.delete(oldest);
  }
  const filePath = path.join(msbDir, `${toolName}.msb`);
  const brain    = loadMsbFile(filePath);
  _cache.set(key, brain);
  return brain;
}

export function clearMsbCache(): void {
  _cache.clear();
}
