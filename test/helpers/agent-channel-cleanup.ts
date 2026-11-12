/**
 * agent-channel-cleanup.ts — settle-aware tmpdir cleanup for fire-and-forget
 * audit writes (PKT-1443).
 *
 * WHY THIS EXISTS
 * ---------------
 * `AgentChannel.send()` dispatches its audit write fire-and-forget:
 *
 *     void this._writeAuditFile(record);
 *     // src/alienclaw/comms/agent-channel.ts:92
 *
 * `_writeAuditFile` then does:
 *
 *     await mkdir(dir, { recursive: true });
 *     await writeFile(join(dir, filename), JSON.stringify(msg, null, 2), 'utf-8');
 *
 * Both calls run on the libuv threadpool (default 4 threads). A write that is
 * still QUEUED when the tmpdir is removed therefore lands AFTER the removal,
 * and its `mkdir(..., { recursive: true })` RECREATES the just-deleted
 * directory — together with the audit file it was about to write.
 *
 * The tmpdir is resurrected and leaks into /tmp for the lifetime of the box.
 *
 * Measured on origin/main @ a04c6dc7: ONE run of test/comms/agent-channel.test.ts
 * (47/47 PASS) leaked 31 tmpdirs holding 9,050 files. Prior runs had
 * accumulated 462 leaked dirs / 126,739 files / 496 MB on the box.
 *
 * WHY A DRAIN, NOT A SLEEP
 * -------------------------
 * The obvious alternative — `await new Promise(r => setTimeout(r, 200))` —
 * is a wall-clock guess, not a synchronization primitive. Its adequacy
 * depends on threadpool contention, which depends on how many sibling test
 * files are running in parallel. The cleanup below instead waits on the
 * OBSERVABLE state (the on-disk file count stops changing), so it waits
 * exactly as long as the writes take and no longer.
 */
import { readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Remove a tree, ignoring any error (the pre-PKT-1443 one-shot cleanup). */
export function rmTmp(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Drain-aware cleanup for a tmpdir that may still have queued audit writes
 * in flight.
 *
 * Phase 1 — DRAIN: wait until the on-disk file count stops changing, so every
 * queued write has landed. A count of 0 is ambiguous (the audit directory does
 * not exist until the first queued write runs its `mkdir`), so we require the
 * count to be unchanged across several consecutive probes before declaring
 * the writes settled.
 *
 * Phase 2 — REMOVE, and remove again if a late write resurrected the tree.
 * The loop exits only once the directory is stably gone.
 *
 * Both phases are bounded, so a pathological case can never hang the suite.
 */
export async function cleanupTmp(dir: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const auditDir = join(dir, today, 'agent-channel');
  const countFiles = (): number => {
    try {
      return existsSync(auditDir) ? readdirSync(auditDir).length : 0;
    } catch {
      return 0;
    }
  };

  // Phase 1 — DRAIN.
  let last = -1;
  let stableRounds = 0;
  for (let round = 0; round < 600; round++) {
    const c = countFiles();
    if (c === last) {
      stableRounds++;
      // Three consecutive identical observations => no write landed between them.
      if (stableRounds >= 3) break;
    } else {
      stableRounds = 0;
      last = c;
    }
    await new Promise((r) => setTimeout(r, 5));
  }

  // Phase 2 — REMOVE (and re-remove if a late write resurrected the tree).
  for (let round = 0; round < 40; round++) {
    rmTmp(dir);
    if (!existsSync(dir)) return; // clean and stable — done
    await new Promise((r) => setTimeout(r, 25));
  }
  rmTmp(dir);
}
