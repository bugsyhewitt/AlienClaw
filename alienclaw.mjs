#!/usr/bin/env node
/**
 * alienclaw.mjs — v0.1
 *
 * AlienClaw is a configuration layer for OpenClaw. There is no independent
 * CLI. All commands forward to the installed `openclaw` binary, which has
 * been pre-configured by install.sh to use BossBot as the default agent.
 *
 * If a user types `alienclaw run "<goal>"`, we rewrite it to
 * `openclaw run "<goal>"` (OpenClaw will dispatch to BossBot automatically).
 */

import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

// Graceful --version / --help shortcuts so users don't see openclaw's banner
// in the common case.
if (args[0] === '--version' || args[0] === '-v') {
  const fs = await import('node:fs/promises');
  const pkgUrl = new URL('./package.json', import.meta.url);
  const pkg = JSON.parse(await fs.readFile(pkgUrl, 'utf8'));
  console.log(`AlienClaw ${pkg.version}`);
  process.exit(0);
}

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`AlienClaw — three wired OpenClaw agents.

Usage: alienclaw <openclaw-command> [args...]

AlienClaw is a configuration layer over OpenClaw. The three agents
(BossBot, AdvisorBot, CreatorBot) are regular OpenClaw agents under
~/.openclaw/agents/. BossBot is the default.

Common commands (all forwarded to openclaw):
  alienclaw chat                 Start a chat with BossBot
  alienclaw agents list          List all agents
  alienclaw tui                  Launch the OpenClaw TUI

For full OpenClaw help: openclaw --help
`);
  process.exit(0);
}

// Default: pass through to openclaw.
const child = spawn('openclaw', args, {
  stdio: 'inherit',
  shell: false,
});

child.on('error', (err) => {
  console.error(`alienclaw: failed to exec openclaw: ${err.message}`);
  console.error(`Is openclaw installed? Try: npm install -g openclaw`);
  process.exit(127);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
