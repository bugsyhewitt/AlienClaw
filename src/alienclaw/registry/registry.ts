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
  private store = new Map<string, MartianSpec>();

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
  }

  /**
   * Return the highest-fitness active Martian for a given tool tag.
   * Returns undefined if no match — caller escalates to BossBot.
   */
  bestForTool(toolTag: string): MartianSpec | undefined {
    let best: MartianSpec | undefined;
    for (const s of this.store.values()) {
      if (s.status !== 'active') continue;
      if (!s.toolTags.includes(toolTag)) continue;
      if (!best || s.fitness > best.fitness) best = s;
    }
    return best;
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
