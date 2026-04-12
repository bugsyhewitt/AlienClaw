#!/usr/bin/env node
/**
 * alienclaw.mjs
 * Standalone AlienClaw entry point for the governance layer.
 * "alienclaw run <goal>" → BossBot governance loop.
 * Everything else passes through to OpenClaw.
 *
 * This is the repo-root convenience copy. The install.sh deploys
 * src-alienclaw/cli/alienclaw.mjs to ~/.alienclaw/ and that is the
 * canonical entry point used at runtime.
 */

import { spawn } from 'node:child_process';
import { env }  from 'node:process';
import { parseCliArgs } from './cli/args.js';
import { runAlienClaw } from './cli/cli.js';

const rawArgv = env.argv ?? [];
const userArgv = (rawArgv[2] ?? '').startsWith('-') ? rawArgv : rawArgv.slice(2);
const cmd = parseCliArgs(userArgv);

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
  const args = env.argv?.slice(2) ?? [];
  const child = spawn(openclaw, args, {
    stdio: 'inherit',
    shell: true,
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}
