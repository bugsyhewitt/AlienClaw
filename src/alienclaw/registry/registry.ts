/**
 * registry.ts
 * Synchronous singleton registry used by Employee at execution time.
 *
 * Wraps loadMsDirectory() for fast sync access — no async needed in the
 * hot path where Employee selects a Meeseeks.
 *
 * Only CreatorBot writes .ms files. This module is strictly read-only.
 */

import { loadMsDirectory } from './ms-loader.js';
import type { MeeseeksSpec } from './ms-types.js';
import { PATHS } from '../constants.js';

class RegistryStore {
  isLoaded = false;

  private store = new Map<string, MeeseeksSpec>();

  /**
   * Synchronously load all .ms files from the given directory.
   * Idempotent — re-calling replaces the store with a fresh load.
   */
  load(dir?: string): void {
    const { specs, errors } = loadMsDirectory(dir ?? PATHS.ms);
    if (errors.length > 0) {
      for (const e of errors) {
        console.warn(`[Registry] Skipping ${e.file}: ${e.error}`);
      }
    }
    this.store.clear();
    for (const spec of specs) {
      this.store.set(spec.id, spec);
    }
    this.isLoaded = true;
  }

  /**
   * Return the highest-fitness active Meeseeks for a given tool tag.
   * Returns undefined if no match — caller escalates to BossBot.
   */
  bestForTool(toolTag: string): MeeseeksSpec | undefined {
    return [...this.store.values()]
      .filter(s => s.status === 'active' && s.toolTags.includes(toolTag))
      .sort((a, b) => b.fitness - a.fitness)[0];
  }

  get(id: string): MeeseeksSpec | undefined {
    return this.store.get(id);
  }

  get size(): number {
    return this.store.size;
  }
}

const _registry = new RegistryStore();

export function getRegistry(): RegistryStore {
  return _registry;
}
