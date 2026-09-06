import type { Command } from 'commander';

export function registerShowCommand(program: Command): void {
  program
    .command('show')
    .description('Print the top-N genomes of a persisted local population (read-only)')
    .requiredOption('--martian-type <type>', 'Martian type (e.g. compute)')
    .option('--top <n>', 'Number of top entries to show (1–100)', '10')
    .addHelpText('after', `
Examples:
  alienclaw show --martian-type compute
  alienclaw show --martian-type compute --top 5

Reads ALIENCLAW_POPULATIONS_ROOT (default ~/.alienclaw/populations/).
Prints entries sorted by fitness descending: rank, fitness, genome.
`)
    .action(async (opts: { martianType: string; top?: string }) => {
      const { runShow } = await import('./show.js');
      const topN = Math.max(1, Math.min(100, parseInt(opts.top ?? '10', 10)));
      process.exitCode = await runShow({ martianType: opts.martianType, topN });
    });
}
