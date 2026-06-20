import * as readline from 'readline';
import type { UserPreferences, TaskEnvelope } from '../types.js';

export class UserChannel {
  private rl: readline.Interface | null = null;

  constructor(private prefs: UserPreferences) {}

  // ── Output ─────────────────────────────────────────────────────────────────

  /** Emits in normal + verbose modes. Status updates, phase transitions. */
  status(msg: string): void {
    if (this.prefs.verbosity !== 'silent') {
      console.log(`[AlienClaw] ${msg}`);
    }
  }

  /** Always emits. Results, sign-off requests, Strike 3 alerts. */
  required(msg: string): void {
    console.log(`[AlienClaw] ${msg}`);
  }

  /** Emits only in verbose mode. */
  verbose(msg: string): void {
    if (this.prefs.verbosity === 'verbose') {
      console.log(`[AlienClaw:verbose] ${msg}`);
    }
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  /** Always prompts. Awaits user response from stdin. */
  async prompt(msg: string): Promise<string> {
    this.required(msg);
    return this.readLine('> ');
  }

  /**
   * Strike 3 surface. Summary mode by default; full log on request.
   * Returns raw user response string.
   */
  async strikeAlert(task: TaskEnvelope, fullLog: boolean): Promise<string> {
    const attempts = task.attempts
      .map((a, i) => `  ${i + 1}. [${a.subagentId}] ${a.failureReason}`)
      .join('\n');

    const header = `Task "${task.description}" has failed ${task.strikeCount} time(s).`;
    const body   = fullLog
      ? `Attempts:\n${attempts}\n\nFull task state:\n${JSON.stringify(task, null, 2)}`
      : `Attempts:\n${attempts}`;

    const footer = 'How to proceed? Enter instructions, budget:<N> to extend retries, or "abandon".';

    this.required(`\n${header}\n${body}\n\n${footer}`);
    return this.readLine('> ');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  close(): void {
    this.rl?.close();
    this.rl = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private readLine(promptStr: string): Promise<string> {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
      });
    }
    return new Promise(resolve => {
      this.rl!.question(promptStr, answer => {
        resolve(answer);
      });
    });
  }
}
