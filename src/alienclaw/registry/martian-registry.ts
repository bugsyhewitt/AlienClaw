/**
 * AlienClaw — Martian Registry
 *
 * Loads all .ms files from ~/.alienclaw/registry/ms/.
 * Read-only to all callers except CreatorBot (which writes via fs directly).
 *
 * Provides:
 *  - loadAll()              — load/reload everything from disk
 *  - get(id)                — fetch a single MartianSpec by ID
 *  - findByToolTag(tag)     — query by tool name
 *  - list()                 — all active Martian sorted by fitness desc
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import { errorMessage } from '../utils.js';
import { ALIENCLAW_HOME, PATHS }   from '../constants.js';
import { loadMsFile, MsParseError } from './ms-loader.js';
import type { MartianSpec }         from './ms-types.js';

export class RegistryError extends Error {
  constructor(message: string) {
    super(`[MartianRegistry] ${message}`);
    this.name = 'RegistryError';
  }
}

export class MartianRegistry {
  private readonly registryDir: string;
  private store  = new Map<string, MartianSpec>();
  private loaded = false;

  constructor(registryDir?: string) {
    this.registryDir = registryDir ?? PATHS.ms;
  }

  // ---------------------------------------------------------------------------
  // Loader
  // ---------------------------------------------------------------------------

  /**
   * Scan registryDir for *.ms files and load them all.
   * Errors on individual files are logged but don't abort the batch.
   * Throws RegistryError if the directory itself can't be read.
   */
  async loadAll(): Promise<void> {
    let entries: string[];
    try {
      const dirents = await fs.readdir(this.registryDir, { withFileTypes: true });
      entries = dirents
        .filter(d => d.isFile() && d.name.endsWith('.ms'))
        .map(d => d.name);
    } catch (err) {
      throw new RegistryError(
        `Cannot read registry dir ${this.registryDir}: ${errorMessage(err)}`
      );
    }

    this.store.clear();

    for (const name of entries) {
      const filePath = path.join(this.registryDir, name);
      try {
        const spec = loadMsFile(filePath);   // sync — MsParseError on bad files
        if (spec.status === 'graveyard') {
          // Graveyard entries stay on disk but are not loaded into active registry
          continue;
        }
        this.store.set(spec.id, spec);
      } catch (err) {
        if (err instanceof MsParseError) {
          console.error(`[MartianRegistry] Parse error in ${name}: ${err.message}`);
        } else {
          console.error(`[MartianRegistry] Failed to load ${name}:`, err);
        }
        // Continue loading the rest
      }
    }

    this.loaded = true;
  }

  // ---------------------------------------------------------------------------
  // Read-only accessors
  // ---------------------------------------------------------------------------

  get(id: string): MartianSpec | undefined {
    this.assertLoaded();
    return this.store.get(id);
  }

  /**
   * Find all active Martian that declare a given tool name.
   * Results sorted by fitness descending.
   */
  findByToolTag(toolName: string): MartianSpec[] {
    this.assertLoaded();
    return [...this.store.values()]
      .filter(ms => ms.status === 'active' && ms.toolTags.includes(toolName))
      .sort((a, b) => b.fitness - a.fitness);
  }

  /**
   * All active Martian, sorted by fitness descending.
   */
  list(): MartianSpec[] {
    this.assertLoaded();
    return [...this.store.values()]
      .filter(ms => ms.status === 'active')
      .sort((a, b) => b.fitness - a.fitness);
  }

  get size(): number {
    return this.store.size;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new RegistryError('Registry not loaded — call loadAll() first');
    }
  }

  /** Ensure the registry directory exists (creates it if not). */
  async ensureDir(): Promise<void> {
    await fs.mkdir(this.registryDir, { recursive: true });
  }
}
