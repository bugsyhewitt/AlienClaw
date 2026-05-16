/**
 * MartianRegistry — loads and indexes all .martian files.
 * Mirrors Python src/alienclaw/martians/registry.py
 */
import * as fs   from 'node:fs';
import * as path from 'node:path';
import type { MartianSpec } from './types.js';
import { parseMartian } from './parser.js';
import { validateMartian } from './validator.js';

export class MartianRegistry {
  private readonly byType:  Map<string, MartianSpec>;
  private readonly ordered: MartianSpec[];

  private constructor(specs: MartianSpec[]) {
    this.byType  = new Map();
    this.ordered = [];
    for (const spec of specs) {
      this.byType.set(spec.martianType, spec);
      this.ordered.push(spec);
    }
    // Aliases: single-slot Martians named "<tool>_alone" → also register as "<tool>".
    for (const spec of specs) {
      const ALONE = '_alone';
      if (spec.martianType.endsWith(ALONE) && spec.slots.length === 1) {
        const bare = spec.martianType.slice(0, -ALONE.length);
        if (!this.byType.has(bare)) {
          this.byType.set(bare, spec);
        }
      }
    }
  }

  get(martianType: string): MartianSpec {
    const spec = this.byType.get(martianType);
    if (!spec) {
      const available = [...this.byType.keys()].sort();
      throw new Error(`Unknown martian_type '${martianType}'. Available: ${JSON.stringify(available)}`);
    }
    return spec;
  }

  has(martianType: string): boolean {
    return this.byType.has(martianType);
  }

  /** Returns the primary Martian types (not aliases) in load order. */
  all(): MartianSpec[] {
    return [...this.ordered];
  }

  /**
   * Load all *.martian files from `martiansDir`. Hard-fails on any parse
   * or validation error.
   */
  static load(martiansDir: string, knownToolNames: Set<string>): MartianRegistry {
    if (!fs.existsSync(martiansDir) || !fs.statSync(martiansDir).isDirectory()) {
      throw new Error(`Martians directory not found: ${martiansDir}`);
    }
    const files = fs.readdirSync(martiansDir)
      .filter(f => f.endsWith('.martian'))
      .sort();

    const specs: MartianSpec[] = [];
    const seen  = new Set<string>();

    for (const file of files) {
      const fullPath = path.join(martiansDir, file);
      const content  = fs.readFileSync(fullPath, 'utf-8');
      const spec     = parseMartian(content, fullPath);

      if (seen.has(spec.martianType)) {
        throw new Error(`Duplicate martian_type '${spec.martianType}' in ${fullPath}.`);
      }
      seen.add(spec.martianType);

      const result = validateMartian(spec, knownToolNames);
      if (!result.valid) {
        throw new Error(`Invalid .martian file ${fullPath}: ${result.errors.join('; ')}`);
      }
      specs.push(spec);
    }
    return new MartianRegistry(specs);
  }
}
