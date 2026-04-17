/**
 * cli.ts
 * AlienClaw CLI action — thin shell around bootstrap() + GovernanceLoop.
 * Called by register.run.ts (Commander) or directly from args.ts (standalone).
 *
 * Does NOT own arg parsing. Does NOT own Commander registration.
 * Owns: lifecycle, signal handling, verbosity injection.
 */

import process from 'node:process';
import { bootstrap }        from '../wiring/hierarchy-bootstrap.js';
import { alienClawConfig }  from '../config/alienclaw-config.js';
import type { VerbosityMode } from '../types.js';

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Run the AlienClaw agent hierarchy toward a goal.
 *
 * @param goal      The natural-language goal string from the user.
 * @param verbosity Verbosity override — applied before bootstrap() reads prefs.
 */
export async function runAlienClaw(
  goal:      string,
  verbosity: VerbosityMode = 'normal',
): Promise<void> {
  if (!goal.trim()) {
    process.stderr.write('[alienclaw] run: goal cannot be empty.\n');
    process.exitCode = 1;
    return;
  }

  // Apply verbosity override before bootstrap() constructs UserChannel
  alienClawConfig.preferences.verbosity = verbosity;

  const { loop, userChannel } = bootstrap();

  // ── Signal handling ─────────────────────────────────────────────────────────
  const shutdown = (signal: string): void => {
    userChannel.required(`\nCaught ${signal} — stopping gracefully.`);
    loop.stop();
  };

  process.once('SIGINT',  () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // ── Run ─────────────────────────────────────────────────────────────────────
  loop.submitGoal(goal);
  await loop.start();
}
