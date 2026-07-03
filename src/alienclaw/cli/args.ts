/**
 * args.ts
 * Plain-Node argument parser for the AlienClaw CLI — zero external dependencies.
 * Used directly by cli.ts and independently testable.
 */

import type { VerbosityMode } from '../types.js';

// ── Result types ─────────────────────────────────────────────────────────────

export interface RunCommandArgs {
  goal:      string;
  verbosity: VerbosityMode;
}

export interface EvolveCommandArgs {
  martianType: string;
  generations: number;
  population:  number;
  seed?:       number;
  inputs?:     string;
}

export type CliCommand =
  | { type: 'run';     args: RunCommandArgs }
  | { type: 'evolve';  args: EvolveCommandArgs }
  | { type: 'version' }
  | { type: 'help' }
  | { type: 'unknown'; raw: string[] };

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse `process.argv`-style array into a typed CliCommand.
 * Handles both interpreter-prefixed calls (node/tsx/bun script.js) and direct calls.
 *
 * Supported:
 *   alienclaw run "<goal>" [--verbose | --silent]
 *   alienclaw --version | -V
 *   alienclaw --help    | -h
 */
export function parseCliArgs(argv: string[]): CliCommand {
  // Strip the [interpreter, script] prefix of process.argv-style input.
  // argv[0] is usually a full path (/usr/bin/node), so compare its basename —
  // the literal comparison used previously never matched real invocations and
  // sent every command down the OpenClaw passthrough.
  const interpreter = (argv[0] ?? '').split('/').pop() ?? '';
  const raw = (interpreter === 'node' || interpreter === 'tsx' || interpreter === 'bun')
    ? argv.slice(2)
    : argv;

  if (raw.includes('--version') || raw.includes('-V')) {
    return { type: 'version' };
  }
  if (raw.includes('--help') || raw.includes('-h')) {
    return { type: 'help' };
  }

  // `evolve` takes value flags, so it walks the raw token stream — the
  // boolean-flag filter below would misread `--type compute` as a positional.
  if (raw[0] === 'evolve') {
    const args: EvolveCommandArgs = { martianType: '', generations: 10, population: 32 };
    for (let i = 1; i < raw.length; i++) {
      const token = raw[i]!;
      const value = raw[i + 1];
      switch (token) {
        case '--type':        args.martianType = value ?? ''; i++; break;
        case '--generations': args.generations = Number(value); i++; break;
        case '--population':  args.population  = Number(value); i++; break;
        case '--seed':        args.seed        = Number(value); i++; break;
        case '--inputs':      args.inputs      = value; i++; break;
        default:
          return { type: 'unknown', raw };
      }
    }
    const numbersOk =
      Number.isFinite(args.generations) && args.generations >= 1 &&
      Number.isFinite(args.population)  && args.population  >= 1 &&
      (args.seed === undefined || Number.isFinite(args.seed));
    if (!args.martianType || !numbersOk) {
      return { type: 'unknown', raw };
    }
    return { type: 'evolve', args };
  }

  const flags       = raw.filter(a => a.startsWith('-'));
  const positionals = raw.filter(a => !a.startsWith('-'));

  const verbose   = flags.includes('--verbose');
  const silent    = flags.includes('--silent');
  const verbosity: VerbosityMode =
    verbose ? 'verbose' : silent ? 'silent' : 'normal';

  if (positionals[0] === 'run') {
    const goal = positionals.slice(1).join(' ').trim();
    if (!goal) {
      return { type: 'unknown', raw };
    }
    return { type: 'run', args: { goal, verbosity } };
  }

  return { type: 'unknown', raw };
}
