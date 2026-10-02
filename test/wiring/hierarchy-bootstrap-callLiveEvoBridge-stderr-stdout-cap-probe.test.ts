/**
 * test/wiring/hierarchy-bootstrap-callLiveEvoBridge-stderr-stdout-cap-probe.test.ts
 *
 * PKT-1123 — callLiveEvoBridge stdout/stderr cap (corrective re-author of REJECTED PKT-992)
 *
 * Defect: src/alienclaw/wiring/hierarchy-bootstrap.ts:339-340 declare
 *   let stdout    = '';   // UNBOUNDED
 *   let stderrBuf = '';   // UNBOUNDED
 * and the 'data' handlers at L353-354 unconditionally append:
 *   child.stdout.on('data', (chunk: Buffer) => { stdout    += chunk.toString('utf8'); });
 *   child.stderr.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString('utf8'); });
 *
 * A misconfigured Python logger (or any future bridge script that emits gigabytes
 * before close) OOMs the Node adapter before the 'close' handler can run. This is
 * the SAME class of defect as PKT-938 (real-summon-adapter.ts stderr cap, PR #556)
 * and PKT-1122 (real-summon-adapter.ts stdout cap, slot 1122 filed this morning).
 *
 * Fix shape (mirror PKT-938/1122):
 *   1. Add module-level constants STDOUT_MAX_BYTES (256 KiB) and STDERR_TAIL_BYTES (4 KiB).
 *   2. In the 'data' handlers, head-trim stderrBuf to STDERR_TAIL_BYTES once it exceeds
 *      2*STDERR_TAIL_BYTES (mirrors PKT-938 stderr cap at real-summon-adapter.ts).
 *   3. In the 'data' handlers, head-trim stdout to STDOUT_MAX_BYTES once it exceeds
 *      2*STDOUT_MAX_BYTES (mirrors PKT-1122 stdout cap).
 *
 * This is a SOURCE-FILE AUDIT (same probe shape as PKT-1122's File-A and PKT-992's
 * rejected probe). The stdout/stderr buffers are closure-local; observing them from
 * outside requires injecting a custom spawn() and tracking buffer growth, which would
 * couple the probe to the buffer-cap implementation rather than the cap existence.
 * The source-file audit is the simplest deterministic signal that the cap is present.
 *
 * RED→GREEN semantics:
 *   R-001: expect(src).toMatch(STDOUT_MAX_BYTES constant) — RED on HEAD (absent), GREEN after fix.
 *   R-002: expect(src).toMatch(stdout.length > STDOUT_MAX_BYTES) — RED on HEAD (no guard), GREEN after fix.
 *   R-003: expect(src).toMatch(stderrBuf.length > STDERR_TAIL_BYTES * 2) — RED on HEAD (no guard), GREEN after fix.
 *   R-004: regression — PKT-938 stderr cap at real-summon-adapter.ts is still applied.
 *
 * 4 tests / 1 describe block.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(
  process.cwd(),
  'src/alienclaw/wiring/hierarchy-bootstrap.ts',
);
const ADAPTER_PATH = resolve(
  process.cwd(),
  'src/alienclaw/governance/common/real-summon-adapter.ts',
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, 'utf-8');
}

function readAdapter(): string {
  return readFileSync(ADAPTER_PATH, 'utf-8');
}

// Slice ~8000 chars after the callLiveEvoBridge signature so we don't anchor
// on absolute line numbers (which drift across commits) while keeping the
// matches scoped to the function. The function is the only spawn+stdout/stderr
// `data` site in this file (verified at HEAD e5ec8fb2).
function sliceCallLiveEvoBridge(src: string): string {
  const sigIdx = src.indexOf('function callLiveEvoBridge');
  if (sigIdx < 0) throw new Error('callLiveEvoBridge signature not found in source');
  return src.slice(sigIdx, sigIdx + 8000);
}

describe('PKT-1123 callLiveEvoBridge stdout/stderr cap (sister to PKT-938/PKT-1122)', () => {
  const src     = readSource();
  const fnSlice = sliceCallLiveEvoBridge(src);

  it('R-001 RED on HEAD: STDOUT_MAX_BYTES constant is ABSENT from hierarchy-bootstrap.ts (defect)', () => {
    // Before fix: no module-level STDOUT_MAX_BYTES bound on the callLiveEvoBridge
    // stdout accumulator. After fix: `const STDOUT_MAX_BYTES = 256 * 1024` at module top.
    // RED on HEAD (asserting the constant exists FAILS because it doesn't).
    expect(src).toMatch(/const\s+STDOUT_MAX_BYTES\s*=/);
  });

  it('R-002 RED on HEAD: callLiveEvoBridge stdout \'data\' handler has NO length guard (defect)', () => {
    // Before fix: `child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); })`
    // After fix: same handler wrapped in a block with `if (stdout.length > STDOUT_MAX_BYTES * 2)`.
    expect(fnSlice).toMatch(/stdout\.length\s*>\s*STDOUT_MAX_BYTES/);
  });

  it('R-003 RED on HEAD: callLiveEvoBridge stderr \'data\' handler has NO length guard (defect)', () => {
    // Before fix: pure concat. After fix: `if (stderrBuf.length > STDERR_TAIL_BYTES * 2)`.
    // Mirrors PKT-938 stderr cap pattern at real-summon-adapter.ts.
    expect(fnSlice).toMatch(/stderrBuf\.length\s*>\s*STDERR_TAIL_BYTES\s*\*\s*2/);
  });

  it('R-004 CONTROL: real-summon-adapter.ts STDERR_TAIL_BYTES cap is still applied (PKT-938 regression-protected)', () => {
    // Defense-in-depth control: PKT-938 (PR #556) added the stderr cap to
    // real-summon-adapter.ts. If that file regresses, this packet's callLiveEvoBridge
    // fix can't be defended as "consistent with the established pattern". GREEN
    // on HEAD because PKT-938 already shipped (regression-protected).
    const adapterSrc = readAdapter();
    expect(adapterSrc).toMatch(/STDERR_TAIL_BYTES\s*=\s*\d+/);
    expect(adapterSrc).toMatch(/stderrBuf\.length\s*>\s*STDERR_TAIL_BYTES\s*\*\s*2/);
  });
});
