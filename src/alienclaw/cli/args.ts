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

export type CliCommand =
  | { type: 'run';     args: RunCommandArgs }
  | { type: 'version' }
  | { type: 'help' }
  | { type: 'unknown'; raw: string[] };

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse `process.argv`-style array into a typed CliCommand.
 * Strips the leading `node` and script-path entries (argv.slice(2)).
 *
 * Supported:
 *   alienclaw run "<goal>" [--verbose | --silent]
 *   alienclaw --version | -V
 *   alienclaw --help    | -h
 */
export function parseCliArgs(argv: string[]): CliCommand {
  const raw = argv.slice(2);

  if (raw.includes('--version') || raw.includes('-V')) {
    return { type: 'version' };
  }
  if (raw.includes('--help') || raw.includes('-h')) {
    return { type: 'help' };
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
