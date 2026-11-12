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
 * on origin/main @ a04c6dc7 (measured: 462 leaked dirs / 126,739 files /
 * 496 MB accumulated on the box over prior runs).
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
 * cleanup turns R-1443-2 RED (mutation M1, verified in the packet).
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentChannel } from '../../src/alienclaw/comms/agent-channel.js';
// PKT-1443 ships this helper. The gate imports the SHIPPED cleanup so it
// actually gates the shipped code path — a gate that re-implements the fix
// in the test file proves nothing about the fix.
//
// RED state on unfixed origin/main: this module does not exist, so the gate
// file cannot load. M1 below shows the mutation that proves the gate is not
// merely an import check: with the helper present but REVERTED to the
// one-shot cleanup, R-1443-2 fails.
import { cleanupTmp, rmTmp } from '../helpers/agent-channel-cleanup.js';

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
    await new Promise((r) => setTimeout(r, 500));
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
    await new Promise((r) => setTimeout(r, 500));
    expect(existsSync(dir)).toBe(false);
  });

  // R-1443-3: the drain must not report "settled" on an ambiguous zero count.
  // The audit directory does not exist until the first queued write runs its
  // `mkdir`, so a zero count cannot by itself mean "nothing left to write".
  it('R-1443-3: cleanup drains the audit dir instead of trusting a zero count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-channel-pkt1443-'));
    const ch = new AgentChannel(dir);

    queueWrites(ch, 50);

    await cleanupTmp(dir);
    await new Promise((r) => setTimeout(r, 300));
    expect(existsSync(dir)).toBe(false);
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

  // R-1443-5: the suite-wide invariant — after cleanup, NO file survives in
  // the audit directory. This is the user-visible symptom (leaked files).
  it('R-1443-5: cleanup leaves ZERO files behind in the audit directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-channel-pkt1443-'));
    const ch = new AgentChannel(dir);

    queueWrites(ch, 100);

    await cleanupTmp(dir);

    const today = new Date().toISOString().slice(0, 10);
    const auditDir = join(dir, today, 'agent-channel');
    const survivors = existsSync(auditDir) ? readdirSync(auditDir).length : 0;
    rmSync(dir, { recursive: true, force: true });

    expect(survivors).toBe(0);
  });
});
