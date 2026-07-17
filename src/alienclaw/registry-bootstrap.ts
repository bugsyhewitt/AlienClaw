/**
 * registry-bootstrap.ts
 * Wires the Martian registry, MSB store, and tool adapters at startup.
 *
 * Called from hierarchy-bootstrap.ts before the governance loop starts.
 * For async startup contexts (CLI, test harness) that need a fully loaded
 * registry before proceeding.
 *
 * Phase 3 — synchronous variant is also available via:
 *   installSeeds(); getRegistry().load(); wireToolAdapters();
 */

import * as path from 'node:path';

import { MartianRegistry }  from './registry/martian-registry.js';
import { selectHost }        from './wiring/host-select.js';
import { installSeeds }      from './registry/seed-installer.js';
import { PATHS }             from './constants.js';

export interface RegistryRuntime {
  registry: MartianRegistry;
}

/**
 * Async registry bootstrap — suitable for CLI startup.
 * Installs seeds, loads all .ms files, wires tool adapters.
 */
export async function bootstrapRegistry(alienclawHome?: string): Promise<RegistryRuntime> {
  const home = alienclawHome ?? PATHS.home;

  // 1. Install seed .ms / .msb files if not already present
  installSeeds();

  // 2. Load the Martian registry (async directory scan + sync file parsing)
  const registry = new MartianRegistry(path.join(home, 'registry', 'ms'));
  await registry.ensureDir();
  await registry.loadAll();
  console.log(`[RegistryBootstrap] Loaded ${registry.size} Martian from ${path.join(home, 'registry', 'ms')}`);

  // 3. Wire the active host's tool adapters into the executor (ALIENCLAW_HOST, default openclaw)
  selectHost().wireToolAdapters();

  return { registry };
}
