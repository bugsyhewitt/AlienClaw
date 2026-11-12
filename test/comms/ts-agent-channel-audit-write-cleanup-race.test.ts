/**
 * ts-agent-channel-audit-write-cleanup-race.test.ts — PKT-1443
 *
 * Regression gate for the tmpdir-resurrection leak in the AgentChannel test
 * suite.
 *
 * THE DEFECT
 * ----------
 * `AgentChannel.send()` dispatches its audit write fire-and-forget:
 *
 *     void this._writeAuditFile(record);
 *     // src/alienclaw/comms/agent-channel.ts:92
 *
 * and `_writeAuditFile` does:
 *
 *     await mkdir(dir, { recursive: true });
 *     await writeFile(join(dir, filename), JSON.stringify(msg, null, 2), 'utf-8');
 *
 * Both run on the libuv threadpool. A write that is still QUEUED when the
 * test's cleanup removes the tmpdir therefore lands AFTER the removal, and its
 * `mkdir(..., { recursive: true })` RECREATES the just-deleted directory
 * together with the audit file it was about to write.
 *
 * The test suite reported PASS while leaking 31 tmpdirs / 9,050 files per run
 * on origin/main @ a04c6dc7 (measured: 620 leaked dirs / 180,986 files /
 * 707 MB accumulated on the box over prior runs).
 *
 * WHAT THIS GATE DOES
 * -------------------
 * It drives the REAL `AgentChannel` — the write path is NOT re-implemented
 * here — and asserts the INVARIANT that the fix establishes:
 *
 *     "after the suite's cleanup runs, the tmpdir is GONE and does not come
 *      back — for every tmpdir the suite created."
 *
 * The gate imports `cleanupTmp` from the helper PKT-1443 ships
 * (`test/helpers/agent-channel-cleanup.ts`). Importing the SHIPPED helper is
 * what makes this a gate rather than a restatement: R-1443-1 drives the real
 * channel and proves the resurrection is real, and R-1443-2 requires the
 * SHIPPED cleanup to prevent it. Reverting the helper to the one-shot
 * cleanup turns R-1443-2 and R-1443-3 RED (mutation M1, verified in the
 * packet).
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentChannel } from '../../src/alienclaw/comms/agent-channel.js';
// PKT-1443 ships this helper. The gate imports the SHIPPED cleanup so it
// actually gates the shipped code path — a gate that re-implements the fix
// in the test file proves nothing about the fix.
//
// RED state on unfixed origin/main: this module does not exist, so the gate
// file cannot load. M1 shows the mutation that proves the gate is not merely
// an import check: with the helper present but REVERTED to the one-shot
// cleanup, R-1443-2 and R-1443-3 fail.
import { cleanupTmp, rmTmp, countAuditFiles } from '../helpers/agent-channel-cleanup.js';

/** How long to let a straggler write come back before re-asserting absence. */
const STRAGGLER_WINDOW_MS = 500;

/** Upper bound for the bounded wait used by the mechanism pin. */
const RESURRECTION_WAIT_MS = 5_000;

/** Queue `count` audit writes that will still be in flight when we clean up. */
function queueWrites(ch: AgentChannel, count: number): void {
  for (let i = 0; i < count; i++) {
    ch.send({
      from: 'BossBot',
      to: 'AdvisorBot',
      kind: 'request',
      ts: 1700000000000 + i,
      content: `m-${i}`,
    });
  }
}

/**
 * Count every file under `dir`, independently of the helper under test.
 *
 * This is an OBSERVER, not a re-implementation of the fix. The fix removes
 * the tree; the gate has to be able to tell that it did not. Counting with
 * the helper's own `countAuditFiles` would let a broken counter make the
 * assertion vacuously true — so this uses a different primitive (the
 * recursive `readdirSync` option) rather than the helper's walker.
 */
function countFilesOnDisk(dir: string): number {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(
      (entry) => entry.isFile(),
    ).length;
  } catch {
    return 0;
  }
}

describe('AgentChannel — audit write vs. tmpdir cleanup race (PKT-1443)', () => {
  // R-1443-1 (mechanism pin): the OLD one-shot cleanup DOES let a queued
  // write resurrect the tree. If this stops being true the defect is gone and
  // the gate must be revisited rather than silently passing.
  it('R-1443-1: a queued audit write RESURRECTS the tmpdir after a one-shot removal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-channel-pkt1443-'));
    const ch = new AgentChannel(dir);

    queueWrites(ch, 200);

    // The pre-PKT-1443 cleanup: remove immediately, no drain.
    rmTmp(dir);
    expect(existsSync(dir)).toBe(false); // removed...

    // ...but the queued write's `mkdir(..., { recursive: true })` brings it back.
    // Wait for the resurrection rather than guessing how long it takes: a
    // fixed sleep here would be a wall-clock guess that turns into a false
    // RED on a saturated CI runner.
    const deadline = Date.now() + RESURRECTION_WAIT_MS;
    while (!existsSync(dir) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const resurrected = existsSync(dir);
    rmSync(dir, { recursive: true, force: true }); // clean up the race residue

    // Assert the mechanism, unconditionally — no `if (resurrected)` tautology.
    expect(resurrected).toBe(true);
  });

  // R-1443-2 (THE GATE): the PKT-1443 cleanup leaves nothing behind, and
  // nothing comes back afterwards. This is the assertion that fails if the
  // fix is reverted to the one-shot cleanup.
  it('R-1443-2: the PKT-1443 cleanup leaves NO resurrected tmpdir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-channel-pkt1443-'));
    const ch = new AgentChannel(dir);

    queueWrites(ch, 200);

    await cleanupTmp(dir);
    expect(existsSync(dir)).toBe(false);

    // Give any straggler a chance to resurrect it, then re-assert.
    await new Promise((r) => setTimeout(r, STRAGGLER_WINDOW_MS));
    expect(existsSync(dir)).toBe(false);
  });

  // R-1443-3: the user-visible symptom — no file may survive in the tmpdir.
  // The count is taken AFTER a straggler window: read immediately after
  // `cleanupTmp` resolves, no queued write could have landed yet, so the
  // count would always be zero and the assertion could never fail.
  it('R-1443-3: the PKT-1443 cleanup leaves ZERO surviving files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-channel-pkt1443-'));
    const ch = new AgentChannel(dir);

    queueWrites(ch, 100);

    await cleanupTmp(dir);

    // Let the queued writes land — with a one-shot cleanup they resurrect the
    // tree; with the drain-aware cleanup there is nothing left to land.
    await new Promise((r) => setTimeout(r, STRAGGLER_WINDOW_MS));
    const survivors = countFilesOnDisk(dir);
    rmSync(dir, { recursive: true, force: true });

    expect(survivors).toBe(0);
  });

  // R-1443-4: a tmpdir that NEVER receives a write must also be removable.
  // The inline `new AgentChannel(makeTmpDir())` sites in the suite leak
  // unconditionally on origin/main because no describe block owns them.
  it('R-1443-4: cleanup handles a tmpdir that never received a write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-channel-pkt1443-'));
    const ch = new AgentChannel(dir);
    void ch; // no sends — nothing queued
    await cleanupTmp(dir);
    expect(existsSync(dir)).toBe(false);
  });

  // R-1443-5: the drain must observe the WHOLE tmpdir tree, not only
  // `<dir>/<today>/agent-channel`. The product captures its date stamp when
  // `send()` is called, so a write queued across a UTC midnight lands under a
  // DIFFERENT date directory. A drain that watches only today's directory
  // reports zero there and settles while that write is still pending.
  it('R-1443-5: the drain observes files in EVERY date directory, not just today', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-channel-pkt1443-'));
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const staleDir = join(dir, yesterday, 'agent-channel');
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'crossed-midnight.json'), '{}');

    const observed = countAuditFiles(dir);
    rmSync(dir, { recursive: true, force: true });

    expect(observed).toBe(1);
  });
});
