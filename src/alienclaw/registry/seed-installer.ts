/**
 * seed-installer.ts
 * Installs seed Martian (.ms) and MSB substrate (.msb) files into
 * ~/.alienclaw/registry/ on first run.
 *
 * Called from hierarchy-bootstrap.ts before loading the registry.
 *
 * .ms files: assembled programmatically here using assembleGenome() so
 *   genome checksums are always correct regardless of where the code runs.
 *
 * .msb files: copied verbatim from seed/msb/ (pure conditioning text).
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as url  from 'node:url';
import { assembleGenome } from './genome-codec.js';
import { PATHS } from '../constants.js';

const REGISTRY_MS  = PATHS.ms;
const REGISTRY_MSB = PATHS.msb;

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function getSeedDir(sub: 'msb'): string | undefined {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'seed', sub),
    path.join(__dirname, '..', '..', '..', '..', 'seed', sub),
    path.join(__dirname, '..', '..', 'seed', sub),
  ];
  for (const c of candidates) {
    try {
      fs.readdirSync(c);
      return c;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;  // try next candidate
      throw err;  // surface permission errors immediately
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Seed genome section bodies (sections 0–2, each exactly 64 Base62 chars).
// Section 3 (checksum) is computed by assembleGenome() — never hardcoded.
//
// Section 0 IDENTITY layout:
//   [0-7]   short ID tag
//   [8-9]   generation marker "G1"
//   [10-19] origin namespace "AlienClaw1"
//   [20-63] tool family label + zero padding
//
// Section 1 EXECUTION layout:
//   [0]     retry attempts encoding: char code - 48 → '3' = 4 attempts
//   [1]     backoff encoding: (charCode-48) % 10 * 500ms → 'R' = 2000ms
//   [2-63]  flow label + performance label + zero padding
//
// Section 2 BEHAVIOR layout:
//   [0]     'E' = EscalateStd (failForward=false), 'F' = failForward=true
//   [1-63]  escalation label + output contract label + zero padding
// ---------------------------------------------------------------------------

export function pad64(s: string): string {
  if (s.length > 64) throw new Error(`Seed section "${s.slice(0,20)}…" is ${s.length} chars (max 64)`);
  return s + '0'.repeat(64 - s.length);
}

interface SeedSpec {
  id:          string;
  description: string;
  generation:  number;
  status:      'active';
  fitness:     number;
  tools:       { name: string; msb: string }[];
  identity:    string;   // 64-char body (padded)
  execution:   string;   // 64-char body (padded)
  behavior:    string;   // 64-char body (padded)
}

const SEED_SPECS: SeedSpec[] = [
  {
    id:          'MS_WEB00001',
    description: 'Web research Martian — executes web_search tool',
    generation:  1,
    status:      'active',
    fitness:     0.00,
    tools:       [{ name: 'web_search', msb: 'web_search.msb' }],
    identity:    pad64('WEB00001G1AlienClaw1WebSearchFamily'),
    execution:   pad64('3RSequentialPerfBalanced'),
    behavior:    pad64('EscalateStdOutputJSONArray'),
  },
  {
    id:          'MS_FREAD0001',
    description: 'File read Martian — executes file_read tool',
    generation:  1,
    status:      'active',
    fitness:     0.00,
    tools:       [{ name: 'file_read', msb: 'file_read.msb' }],
    identity:    pad64('FREAD001G1AlienClaw1FileReadFamily0'),
    execution:   pad64('2RSequentialPerfFast'),
    behavior:    pad64('EscalateStdOutputFileContent'),
  },
  {
    id:          'MS_FWRITE001',
    description: 'File write Martian — executes file_write tool',
    generation:  1,
    status:      'active',
    fitness:     0.00,
    tools:       [{ name: 'file_write', msb: 'file_write.msb' }],
    identity:    pad64('FWRITE01G1AlienClaw1FileWriteFamily'),
    execution:   pad64('2RSequentialPerfSafe'),
    behavior:    pad64('EscalateStdOutputWriteConfirm'),
  },
];

function buildMsContent(spec: SeedSpec): string {
  const genome = assembleGenome(spec.identity, spec.execution, spec.behavior);

  const toolLines = spec.tools
    .map(t => `${t.name.padEnd(16)}→ ${t.msb}`)
    .join('\n');

  return [
    `[GENOME]`,
    genome,
    ``,
    `# ${spec.id}`,
    `# description: ${spec.description}`,
    `# generation: ${spec.generation}`,
    `# status: ${spec.status}`,
    `# fitness: ${spec.fitness.toFixed(2)}`,
    ``,
    `[TOOLS]`,
    toolLines,
    ``,
    `[GRAVEYARD]`,
    `# Top performing historical genomes. Restored by CreatorBot only.`,
    `# format: <fitness_score> G<generation> <genome>`,
    ``,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// MSB install — verbatim copy from seed/msb/
// ---------------------------------------------------------------------------

function installMsbSeeds(overwrite: boolean): void {
  const seedDir = getSeedDir('msb');
  if (!seedDir) {
    console.log('[SeedInstaller] No seed/msb directory found — skipping');
    return;
  }

  const files = fs.readdirSync(seedDir).filter(f => f.endsWith('.msb'));
  if (files.length === 0) {
    console.log('[SeedInstaller] seed/msb/ is empty — skipping');
    return;
  }

  for (const file of files) {
    const src    = path.join(seedDir, file);
    const target = path.join(REGISTRY_MSB, file);
    try {
      fs.copyFileSync(src, target);
      console.log(`[SeedInstaller] Installed msb/${file}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (overwrite) {
        fs.copyFileSync(src, target);
        console.log(`[SeedInstaller] Overwrote msb/${file}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MS install — assembled from SeedSpec[] with fresh checksum
// ---------------------------------------------------------------------------

function installMsSeeds(overwrite: boolean): void {
  for (const spec of SEED_SPECS) {
    const target = path.join(REGISTRY_MS, `${spec.id}.ms`);
    const content = buildMsContent(spec);  // build once
    try {
      fs.writeFileSync(target, content, 'utf-8');
      console.log(`[SeedInstaller] Installed ms/${spec.id}.ms (genome assembled fresh)`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (overwrite) {
        fs.writeFileSync(target, content, 'utf-8');  // reuse content
        console.log(`[SeedInstaller] Overwrote ms/${spec.id}.ms`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function installSeeds(options: { overwrite?: boolean } = {}): void {
  const overwrite = options.overwrite ?? true;

  fs.mkdirSync(REGISTRY_MS,  { recursive: true });
  fs.mkdirSync(REGISTRY_MSB, { recursive: true });

  installMsSeeds(overwrite);
  installMsbSeeds(overwrite);
}
