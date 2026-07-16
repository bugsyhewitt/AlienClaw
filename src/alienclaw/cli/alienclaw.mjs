#!/usr/bin/env node
/**
 * alienclaw.mjs
 * AlienClaw CLI entry — runs via tsx as: node alienclaw.mjs <args>
 *
 * Routes "run <goal>" to BossBot governance loop.
 * Everything else passes through to OpenClaw.
 */

import { spawn } from 'node:child_process';
import { parseCliArgs } from './args.js';
import { runAlienClaw } from './cli.js';

// Pass raw argv to parseCliArgs — it handles interpreter vs direct detection internally.
const rawArgv = process.argv;
const cmd = parseCliArgs(rawArgv);

if (cmd.type === 'run') {
  // ── BossBot governance mode ─────────────────────────────────────────────
  await runAlienClaw(cmd.args.goal, cmd.args.verbosity);
} else if (cmd.type === 'evolve') {
  // ── Local evolution (offline Python runner) ─────────────────────────────
  const { runEvolve } = await import('./evolve.js');
  process.exitCode = await runEvolve(cmd.args);
} else if (cmd.type === 'submit') {
  // ── Explicit leaderboard submission ──────────────────────────────────────
  const { runSubmit } = await import('./submit.js');
  process.exitCode = await runSubmit(cmd.args);
} else if (cmd.type === 'version') {
  const pkg = await import('./package.json', { assert: { type: 'json' } });
  console.log(`AlienClaw ${pkg.default.version}`);
} else if (cmd.type === 'help') {
  console.log(`AlienClaw — Run the agent hierarchy.

alienclaw run "<goal>" [options]
  Run the AlienClaw agent hierarchy toward a goal.

alienclaw evolve --type <martianType> [options]
  Run local genome evolution (offline). Options:
  --generations <n>  Number of generations (default 10)
  --population <n>   Population size (default 32)
  --seed <n>         RNG seed for reproducibility
  --inputs <json>    JSON inputs forwarded to the Martian

alienclaw submit --type <martianType> [options]
  Submit your best local genome to the public leaderboard. Options:
  --name <handle>    Public handle (8 uppercase letters); persisted
  --yes              Skip the confirmation prompt
  --force            Submit even when not beating the public top

Options:
  --verbose   Enable verbose output
  --silent    Suppress all non-essential output
  --help      Show this help
  --version   Show version

alienclaw --help
  Show OpenClaw help (gateway, channels, etc.)
`);
} else {
  // ── Pass through to OpenClaw ─────────────────────────────────────────────
  const openclaw = 'openclaw';
  const args = process.argv.slice(2);
  const child = spawn(openclaw, args, {
    stdio: 'inherit',
    shell: true,
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}
