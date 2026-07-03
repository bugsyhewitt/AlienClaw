/**
 * submit.ts
 * `alienclaw submit` — submit the operator's best local genome for a
 * martian type to the public leaderboard (api.alienclaw.net).
 *
 * Explicit, confirmed, file-mediated: leaderboardCheck() writes a local
 * artifact only when the operator's best beats the public top (or
 * --force writes it directly), and submitFromFile() POSTs that artifact
 * only after confirmation. Nothing here runs in the background.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import {
  leaderboardCheck,
  submitFromFile,
  validateLeaderboardName,
} from '../governance/common/leaderboard.js';
import { readOperatorBest } from '../governance/common/sync/local-population.js';
import { ensureApiKey, machineHash } from '../governance/common/sync/credentials.js';
import { NetworkAPIClient } from '../governance/common/sync/client.js';
import type { SubmitCommandArgs } from './args.js';

const DEFAULT_API_URL = 'https://api.alienclaw.net';

function home(): string {
  return process.env['ALIENCLAW_HOME'] ?? join(homedir(), '.alienclaw');
}

/** Mirrors the Python layer's populations_root() (evolution/storage.py). */
function populationsRoot(): string {
  return process.env['ALIENCLAW_POPULATIONS_ROOT'] ?? join(home(), 'populations');
}

/**
 * Resolve the operator's public board handle:
 * --name flag > ALIENCLAW_LEADERBOARD_NAME env > preferences.leaderboardName.
 * A valid flag-supplied name is persisted to preferences for next time.
 * (Config is imported lazily — its singleton binds paths at import time.)
 */
async function resolveName(flagName: string | undefined): Promise<string | null> {
  const candidate = flagName ?? process.env['ALIENCLAW_LEADERBOARD_NAME'];
  if (candidate) {
    if (!validateLeaderboardName(candidate)) return null;
    if (flagName) {
      const { alienClawConfig } = await import('../config/alienclaw-config.js');
      alienClawConfig.savePreferences({ leaderboardName: flagName });
    }
    return candidate;
  }
  const { alienClawConfig } = await import('../config/alienclaw-config.js');
  const fromPrefs = alienClawConfig.preferences.leaderboardName;
  return fromPrefs && validateLeaderboardName(fromPrefs) ? fromPrefs : null;
}

export async function runSubmit(args: SubmitCommandArgs): Promise<number> {
  const apiUrl = (process.env['ALIENCLAW_API_URL'] ?? DEFAULT_API_URL).replace(/\/$/, '');

  const name = await resolveName(args.name);
  if (!name) {
    console.error('alienclaw submit: no valid leaderboard name (must match ^[A-Z]{8}$).');
    console.error('Pass --name ABCDEFGH, or set ALIENCLAW_LEADERBOARD_NAME.');
    return 1;
  }

  const best = readOperatorBest(populationsRoot(), args.martianType);
  if (!best) {
    console.error(
      `alienclaw submit: no local population for '${args.martianType}' under ${populationsRoot()}.`,
    );
    console.error(`Run: alienclaw evolve --type ${args.martianType}`);
    return 1;
  }

  const apiKey = ensureApiKey();
  const client = new NetworkAPIClient(apiUrl, apiKey);
  const install = await client.install(machineHash());
  if (!install.ok) {
    console.error(
      `alienclaw submit: install registration failed (${install.status}): ${install.error.code}`,
    );
    return 1;
  }

  const submissionsDir = join(home(), 'workspace', 'submissions');
  mkdirSync(submissionsDir, { recursive: true });
  const artifactPath = join(submissionsDir, `${args.martianType}.json`);
  rmSync(artifactPath, { force: true }); // never submit a stale artifact

  if (args.force) {
    // Same artifact shape leaderboardCheck writes — bypasses the
    // beats-the-top gate (fitness ties, refreshing an existing row).
    writeFileSync(artifactPath, JSON.stringify({
      leaderboard_name: name,
      genome:           best.genome,
      genome_hash:      best.genomeHash,
      martian_type:     best.martianType,
      fitness:          best.fitness,
      checked_at:       new Date().toISOString(),
    }, null, 2), 'utf8');
  } else {
    await leaderboardCheck(best, {
      leaderboardUrl:     `${apiUrl}/v1/genomes/top`,
      leaderboardName:    name,
      submissionFilePath: artifactPath,
    });
    if (!existsSync(artifactPath)) {
      console.error(
        `alienclaw submit: your best ${args.martianType} fitness (${best.fitness.toFixed(3)}) does not beat the current public top.`,
      );
      console.error('Use --force to submit anyway (e.g. for fitness ties).');
      return 1;
    }
  }

  console.log(`Submitting to ${apiUrl}/v1/genomes:`);
  console.log(`  type=${best.martianType} fitness=${best.fitness.toFixed(3)} name=${name}`);
  if (!args.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('Proceed? [y/N] ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Aborted.');
      return 1;
    }
  }

  try {
    const res = await submitFromFile(artifactPath, apiKey, `${apiUrl}/v1/genomes`);
    console.log(`Submitted: rank ${res.rank}${res.is_new_top ? ' — new top!' : ''}`);
    console.log(
      `Public board: ${apiUrl}/v1/genomes/top?martian_type=${encodeURIComponent(best.martianType)}&n=10`,
    );
    return 0;
  } catch (err) {
    console.error(`alienclaw submit: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
