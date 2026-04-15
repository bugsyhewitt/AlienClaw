/**
 * registry.ts
 * Synchronous singleton registry used by Employee at execution time.
 *
 * Wraps loadMsDirectory() for fast sync access — no async needed in the
 * hot path where Employee selects a Martian.
 *
 * Only CreatorBot writes .ms files. This module is strictly read-only.
 */

import { loadMsDirectory } from './ms-loader.js';
import type { MartianSpec } from './ms-types.js';
import { PATHS } from '../constants.js';

class RegistryStore {
  private store     = new Map<string, MartianSpec>();
  // toolTag → best active Martian for that tag (O(1) lookup)
  private toolIndex = new Map<string, MartianSpec>();

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
    this.toolIndex.clear();

    for (const spec of specs) {
      this.store.set(spec.id, spec);
      if (spec.status !== 'active') continue;
      for (const tag of spec.toolTags) {
        const existing = this.toolIndex.get(tag);
        if (!existing || spec.fitness > existing.fitness) {
          this.toolIndex.set(tag, spec);
        }
      }
    }
  }

  /**
   * Return the highest-fitness active Martian for a given tool tag.
   * Returns undefined if no match — caller escalates to BossBot.
   */
  bestForTool(toolTag: string): MartianSpec | undefined {
    return this.toolIndex.get(toolTag);
  }

  get(id: string): MartianSpec | undefined {
    return this.store.get(id);
  }

  get size(): number {
    return this.store.size;
  }

  /** All active Martians sorted by fitness descending. */
  list(): MartianSpec[] {
    return [...this.store.values()]
      .filter(s => s.status === 'active')
      .sort((a, b) => b.fitness - a.fitness);
  }
}

const _registry = new RegistryStore();

export function getRegistry(): RegistryStore {
  return _registry;
}
