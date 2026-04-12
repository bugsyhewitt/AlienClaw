/**
 * seed-installer.ts
 * Copies seed .ms and .msb files into ~/.alienclaw/registry/ on first run.
 * Called from hierarchy-bootstrap.ts before loading the registry.
 *
 * This does NOT write genomes — it only copies pre-authored seed files
 * that were created by CreatorBot (conceptually) as the genesis generation.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as url  from 'node:url';
import * as os   from 'node:os';

const HOME = process.env['ALIENCLAW_HOME'] ?? path.join(os.homedir(), '.alienclaw');
const REGISTRY_MS  = path.join(HOME, 'registry', 'ms');
const REGISTRY_MSB = path.join(HOME, 'registry', 'msb');

// Seed files live alongside the built output in dist/seed/
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function getSeedDir(sub: 'ms' | 'msb'): string | undefined {
  // Walk up from src/alienclaw/registry/ to repo root, then into seed/
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'seed', sub),            // from dist/
    path.join(__dirname, '..', '..', '..', '..', 'seed', sub),      // extra level
    path.join(__dirname, '..', '..', 'seed', sub),                   // from src/alienclaw/
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;   // no seed dir — graceful, caller skips
}

export function installSeeds(options: { overwrite?: boolean } = {}): void {
  const overwrite = options.overwrite ?? true;

  fs.mkdirSync(REGISTRY_MS,  { recursive: true });
  fs.mkdirSync(REGISTRY_MSB, { recursive: true });

  for (const [sub, dest] of [['ms', REGISTRY_MS], ['msb', REGISTRY_MSB]] as const) {
    const seedDir = getSeedDir(sub);
    if (!seedDir) {
      console.log(`[SeedInstaller] No seed/${sub} directory found — skipping (Genesis Meeseeks will be created by CreatorBot)`);
      continue;
    }
    const ext     = `.${sub}`;
    const files   = fs.readdirSync(seedDir).filter(f => f.endsWith(ext));

    if (files.length === 0) {
      console.log(`[SeedInstaller] seed/${sub}/ is empty — skipping`);
      continue;
    }

    for (const file of files) {
      const src     = path.join(seedDir, file);
      const target  = path.join(dest, file);
      if (!fs.existsSync(target) || overwrite) {
        fs.copyFileSync(src, target);
        console.log(`[SeedInstaller] Installed ${sub}/${file}`);
      }
    }
  }
}
