/**
 * evolve.ts
 * `alienclaw evolve` — runs local genome evolution by spawning the Python
 * runner (python3 -m alienclaw.evolution run-experiment). The runner is
 * fully in-process Python (bridge included): no server, no network.
 *
 * Populations persist under ALIENCLAW_POPULATIONS_ROOT
 * (default ~/.alienclaw/populations). Python binary override:
 * ALIENCLAW_PYTHON_BIN (default python3).
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvolveCommandArgs } from './args.js';

/** Repo root derived from this module's location (src/alienclaw/cli/), not cwd. */
function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/**
 * Format one runner stdout line for humans.
 *
 * Per-generation rows are JSON (see evolution/__main__.py on_gen):
 *   {"generation":3,"mean_fitness":0.55,"max_fitness":0.87,"distinct_genomes":12,...}
 * become `gen 3/10  max=0.870 mean=0.550 distinct=12`. Anything that is
 * not such a row passes through unchanged.
 */
export function formatGenerationLine(line: string, totalGenerations: number): string {
  try {
    const row = JSON.parse(line) as Record<string, unknown>;
    const gen  = row['generation'];
    const max  = row['max_fitness'];
    const mean = row['mean_fitness'];
    if (typeof gen === 'number' && typeof max === 'number' && typeof mean === 'number') {
      const distinct = typeof row['distinct_genomes'] === 'number'
        ? ` distinct=${row['distinct_genomes']}`
        : '';
      return `gen ${gen}/${totalGenerations}  max=${max.toFixed(3)} mean=${mean.toFixed(3)}${distinct}`;
    }
  } catch {
    // Not JSON — pass through (e.g. Python warnings on stdout).
  }
  return line;
}

/** Build the spawn argv for the Python runner (exported for tests). */
export function buildRunnerArgs(args: EvolveCommandArgs): string[] {
  return [
    '-m', 'alienclaw.evolution', 'run-experiment',
    '--martian-type', args.martianType,
    '--generations', String(args.generations),
    '--population-size', String(args.population),
    ...(args.seed !== undefined ? ['--seed', String(args.seed)] : []),
    ...(args.inputs !== undefined ? ['--inputs', args.inputs] : []),
  ];
}

/** Spawn the runner, stream formatted progress, resolve with its exit code. */
export async function runEvolve(args: EvolveCommandArgs): Promise<number> {
  const pythonBin  = process.env['ALIENCLAW_PYTHON_BIN'] ?? 'python3';
  const pythonPath = [path.join(repoRoot(), 'src'), process.env['PYTHONPATH']]
    .filter(Boolean)
    .join(path.delimiter);

  const child = spawn(pythonBin, buildRunnerArgs(args), {
    shell: false,
    env:   { ...process.env, PYTHONPATH: pythonPath },
    stdio: ['ignore', 'pipe', 'inherit'],  // stderr carries the Final summary
  });

  const rl = createInterface({ input: child.stdout });
  rl.on('line', line => {
    console.log(formatGenerationLine(line, args.generations));
  });

  return await new Promise<number>(resolve => {
    child.on('error', err => {
      console.error(`alienclaw evolve: failed to start ${pythonBin}: ${err.message}`);
      resolve(1);
    });
    child.on('close', code => resolve(code ?? 1));
  });
}
