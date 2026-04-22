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
} else if (cmd.type === 'version') {
  const pkg = await import('./package.json', { assert: { type: 'json' } });
  console.log(`AlienClaw ${pkg.default.version}`);
} else if (cmd.type === 'help') {
  console.log(`AlienClaw — Run the agent hierarchy.

alienclaw run "<goal>" [options]
  Run the AlienClaw agent hierarchy toward a goal.

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
