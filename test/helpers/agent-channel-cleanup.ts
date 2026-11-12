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
 * accumulated 620 leaked dirs / 180,986 files / 707 MB on the box.
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

// ── Tunables ─────────────────────────────────────────────────────────────────
// Every phase is bounded: a pathological case can never hang the suite.

// Phase 1 — DRAIN. Poll interval; how many consecutive identical observations
// count as "settled" once at least one audit file has actually been seen;
// and the stricter count used while NO file has been seen (see cleanupTmp).
const DRAIN_PROBE_MS      = 5;
const DRAIN_STABLE_PROBES = 3;
const DRAIN_ZERO_PROBES   = 6;
const DRAIN_MAX_ROUNDS    = 600; // 3 s hard bound

// Phase 2 — REMOVE and WATCH. How long to wait before checking that the tree
// STAYED gone, and how many consecutive absent observations are required
// before the cleanup is declared complete.
const WATCH_PROBE_MS    = 10;
const WATCH_QUIET_PROBES = 3;
const WATCH_MAX_ROUNDS  = 120; // 1.2 s hard bound

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Remove a tree, ignoring any error (the pre-PKT-1443 one-shot cleanup). */
export function rmTmp(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Count every FILE under `dir`, recursively.
 *
 * The WHOLE TREE is counted, not just `<dir>/<today>/agent-channel`. The
 * product captures its date stamp when `send()` is called — `dateStamp()` is
 * `date.toISOString().slice(0, 10)`, evaluated synchronously at the top of
 * `_writeAuditFile` — so a write that was queued across a UTC midnight lands
 * under a DIFFERENT date directory than the one a today-only drain would
 * watch. Counting the whole tree makes the drain blind to that rollover, and
 * also decouples it from the audit directory layout.
 */
export function countAuditFiles(dir: string): number {
  let total = 0;
  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        total++;
      }
    }
  };
  walk(dir);
  return total;
}

/**
 * Drain-aware cleanup for a tmpdir that may still have queued audit writes
 * in flight.
 *
 * Phase 1 — DRAIN: wait until the on-disk file count stops changing, so the
 * writes that have already STARTED have landed before the tree is removed.
 *
 * A count of ZERO is ambiguous: the audit directory does not exist until the
 * first queued write runs its `mkdir`, so "zero for a few milliseconds" is
 * indistinguishable from "nothing has landed yet". A zero count therefore has
 * to hold for DRAIN_ZERO_PROBES consecutive probes before the drain will
 * settle on it — strictly longer than the DRAIN_STABLE_PROBES required once
 * an audit file has actually been observed.
 *
 * Phase 2 — REMOVE and WATCH: remove the tree, then confirm it STAYS gone.
 * The absence check runs AFTER the delay, so a write that lands in the gap
 * between the removal and the check is observed; every time the tree
 * reappears it is removed again. The cleanup is declared complete only once
 * the tree has been absent for WATCH_QUIET_PROBES consecutive probes.
 *
 * Phase 2 is the backstop for the case the drain cannot observe: a write that
 * had not yet STARTED when the drain settled. Nothing the drain counts has
 * changed yet, so only the watch can catch it.
 *
 * Both phases are bounded, so a pathological case can never hang the suite.
 */
export async function cleanupTmp(dir: string): Promise<void> {
  // Phase 1 — DRAIN.
  let last = -1;
  let stableRounds = 0;
  let sawFile = false;
  for (let round = 0; round < DRAIN_MAX_ROUNDS; round++) {
    const count = countAuditFiles(dir);
    if (count > 0) sawFile = true;
    if (count === last) {
      stableRounds++;
      // A zero count is ambiguous and needs the stricter probe count.
      const required = sawFile ? DRAIN_STABLE_PROBES : DRAIN_ZERO_PROBES;
      if (stableRounds >= required) break;
    } else {
      stableRounds = 0;
      last = count;
    }
    await sleep(DRAIN_PROBE_MS);
  }

  // Phase 2 — REMOVE and WATCH.
  let quietRounds = 0;
  for (let round = 0; round < WATCH_MAX_ROUNDS; round++) {
    rmTmp(dir);
    // The absence check happens AFTER the delay, never before it: a write
    // that lands in the gap between the removal and the check has to be
    // observable, and a same-tick check could never see it.
    await sleep(WATCH_PROBE_MS);
    if (existsSync(dir)) {
      // A late write resurrected the tree — remove it again and keep watching.
      quietRounds = 0;
      continue;
    }
    quietRounds++;
    if (quietRounds >= WATCH_QUIET_PROBES) return;
  }
  rmTmp(dir);
}
