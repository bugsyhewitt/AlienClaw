/**
 * msb-loader.ts
 * Read-only .msb file loader.
 *
 * MSB files are conditioning text — they describe HOW a tool behaves
 * so that Meeseeks can invoke it correctly. No executable logic lives here.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';

import type { MeeseeksBrain, MsbValidationResult } from './msb-types.js';

const REQUIRED_SECTIONS = [
  'TOOL',
  'VERSION',
  'CAPABILITIES',
  'LIMITATIONS',
  'FAILURE MODES',
  'BEST PRACTICES',
  'EXECUTION ORDER',
  'OUTPUT CONTRACT',
] as const;

function extractField(raw: string, fieldName: string): string {
  const re = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const m  = raw.match(re);
  return m ? m[1].trim() : '';
}

function extractSection(raw: string, sectionName: string): string {
  // Matches: SECTION NAME:\n<content until next ALL-CAPS heading or end>
  const re = new RegExp(
    `^${sectionName}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z ]+:|$)`,
    'm'
  );
  const m = raw.match(re);
  return m ? m[1].trim() : '';
}

function extractExecutionOrder(raw: string): string[] {
  const section = extractSection(raw, 'EXECUTION ORDER');
  if (!section) return [];
  return section
    .split('\n')
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
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

export function parseMsbContent(raw: string, sourcePath?: string): MeeseeksBrain {
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
  };
}

export function loadMsbFile(filePath: string): MeeseeksBrain {
  if (!fs.existsSync(filePath)) {
    throw new Error(`MSB file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseMsbContent(raw, filePath);
}

// ---------------------------------------------------------------------------
// MSB cache — one instance per tool name per process
// ---------------------------------------------------------------------------

const _cache = new Map<string, MeeseeksBrain>();

export function loadMsbCached(
  toolName:  string,
  msbDir:    string,
): MeeseeksBrain {
  if (_cache.has(toolName)) return _cache.get(toolName)!;
  const filePath = path.join(msbDir, `${toolName}.msb`);
  const brain    = loadMsbFile(filePath);
  _cache.set(toolName, brain);
  return brain;
}

export function clearMsbCache(): void {
  _cache.clear();
}
