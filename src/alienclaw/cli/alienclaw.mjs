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
} else if (cmd.type === 'leaderboard') {
  // ── Public leaderboard read (no credentials required) ─────────────────────
  const { runLeaderboard } = await import('./leaderboard.js');
  process.exitCode = await runLeaderboard(cmd.args);
} else if (cmd.type === 'status') {
  // ── Live-fitness status summary ──────────────────────────────────────────
  const { runStatus } = await import('./status.js');
  process.exitCode = await runStatus();
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

alienclaw leaderboard --martian-type <type> [--top <n>]
  Show the public top-N for a martian type (read-only, no credentials needed).
  --top <n>  Number of entries to show (1–100, default 10)

alienclaw status
  Print live-fitness trends per martian_type (observation count + max fitness).
  Reads ~/.alienclaw/online_fitness.jsonl and live-fitness-summary.json.

Options:
  --verbose   Enable verbose output
  --silent    Suppress all non-essential output
  --help      Show this help
  --version   Show version

alienclaw --help
  Show OpenClaw help (gateway, channels, etc.)
`);
} else {
  // ── Pass through to the active host framework ────────────────────────────
  // ALIENCLAW_HOST selects the host binary (default 'openclaw'); 'hermes'
  // routes passthrough to the Hermes CLI instead.
  const host = (process.env.ALIENCLAW_HOST || '').trim().toLowerCase() || 'openclaw';
  if (host !== 'openclaw' && host !== 'hermes') {
    console.error(`alienclaw: ALIENCLAW_HOST must be 'openclaw' or 'hermes' (got '${host}')`);
    process.exit(2);
  }
  const hostBin = host === 'hermes' ? 'hermes' : 'openclaw';
  const args = process.argv.slice(2);
  const child = spawn(hostBin, args, {
    stdio: 'inherit',
    shell: false, // Direct exec; args are NOT shell-interpreted. PKT-660.
                  // hostBin is validated against 'openclaw'|'hermes' (L65-68);
                  // no shell features needed. Avoids Node DEP0190 (argv injection).
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}
