/**
 * register.run.ts
 * Registers `alienclaw run "<goal>"` with OpenClaw's Commander program.
 * Follows the same pattern as src/cli/program/register.agent.ts.
 */

import type { Command } from 'commander';
import type { VerbosityMode } from '../types.js';

export function registerRunCommand(program: Command): void {
  program
    .command('run <goal>')
    .description('Run the AlienClaw agent hierarchy toward a goal')
    .option('--verbose', 'Enable verbose output (overrides preferences.json)', false)
    .option('--silent',  'Suppress all non-essential output',                 false)
    .addHelpText('after', `
Examples:
  alienclaw run "research quantum computing and write a summary"
  alienclaw run "build a to-do app in Python" --verbose
  alienclaw run "draft a blog post about AI" --silent

Output lands in ~/.alienclaw/workspace/output/
Telemetry written to ~/.alienclaw/registry/telemetry/<date>/
`)
    .action(async (goal: string, opts: { verbose?: boolean; silent?: boolean }) => {
      const verbosity: VerbosityMode =
        opts.verbose ? 'verbose' : opts.silent ? 'silent' : 'normal';

      const { runAlienClaw } = await import('./cli.js');
      await runAlienClaw(goal, verbosity);
    });
}
