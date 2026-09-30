/**
 * _verify_1144.test.ts — PKT-1144 — RED File-A scaffold.
 *
 * Defect (live at origin/main 3a1479bf):
 *
 *   D1: src/alienclaw/cli/register.leaderboard.ts:24 — Commander wrapper
 *       for `alienclaw leaderboard --top <n>` coerces opts.top with the
 *       bare shape:
 *
 *         const topN = Math.max(1, Math.min(100, parseInt(opts.top ?? '10', 10)));
 *
 *       parseInt('abc', 10) === NaN; Math.max/min on NaN return NaN;
 *       topN === NaN slips through as the page size. The URL is then
 *       constructed as `&n=${NaN}` (cli/leaderboard.ts:13). Server-side
 *       `clampTopN(NaN)` recovers to DEFAULT_TOP_N=10, so the operator
 *       gets 10 results — but the local topN never had the
 *       Number.isSafeInteger guard that the standalone `parseCliArgs`
 *       path (args.ts:181) provides.
 *
 *   D2: src/alienclaw/cli/register.show.ts:19 — same shape, sister file.
 *       `arr.slice(0, NaN) === []` → operator sees empty output for
 *       `alienclaw show --martian-type <T> --top abc`.
 *
 *   Live probe (this cycle, in-Node):
 *
 *     $ node -e 'const t = Math.max(1, Math.min(100, parseInt("abc", 10))); console.log(t, Number.isFinite(t));'
 *     NaN false
 *
 *     $ node -e 'const t = Math.max(1, Math.min(100, parseInt("", 10))); console.log(t, Number.isFinite(t));'
 *     NaN false
 *
 *     $ node -e 'const t = Math.max(1, Math.min(100, parseInt("1e500", 10))); console.log(t, Number.isFinite(t));'
 *     1 true   ← silent coerce (parseInt reads "1", ignores rest)
 *
 *   Sister pattern to PKT-589/617/654/696/1141/1142 (parseInt coercion
 *   family). Distinct because this is the Commander wrapper path, NOT
 *   the standalone parseCliArgs path (which is hardened via
 *   Number.isSafeInteger at args.ts:181). Same defense is needed here.
 *
 *   Sister file register.evolve.ts has 8 unguarded `Number(opts.xxx)`
 *   coercions (lines 41-50) that flow into runEvolve without validation.
 *   Those are partly defended by Python argparse's `type=int` rejecting
 *   NaN/Infinity strings (verified live), but `0` and `-5` slip through
 *   (Python argparse accepts them). That broader defect is OUT OF SCOPE
 *   for PKT-1144 — tracked separately as a sister finding in the packet
 *   body.
 *
 *   Tests R-1144-A through R-1144-E.
 */
import { describe, it, expect } from 'vitest';
import { resolveTopN } from '../../src/alienclaw/cli/register.leaderboard.js';

describe('register.leaderboard.ts + register.show.ts — topN NaN slip-through (PKT-1144)', () => {
  it('R-1144-A: --top "abc" does NOT produce NaN topN (falls back to default)', () => {
    const topN = resolveTopN('abc');
    expect(Number.isFinite(topN)).toBe(true);
    expect(topN).not.toBeNaN();
    expect(topN).toBe(10);
  });

  it('R-1144-B: --top "" does NOT produce NaN topN (falls back to default)', () => {
    const topN = resolveTopN('');
    expect(Number.isFinite(topN)).toBe(true);
    expect(topN).not.toBeNaN();
    expect(topN).toBe(10);
  });

  it('R-1144-C: --top "NaN" does NOT produce NaN topN (falls back to default)', () => {
    const topN = resolveTopN('NaN');
    expect(Number.isFinite(topN)).toBe(true);
    expect(topN).toBe(10);
  });

  it('R-1144-D: --top "1e500" does NOT silently coerce to 1 (parseInt prefix bug)', () => {
    // parseInt reads "1", ignores "e500" — operator typed "1e500" expecting
    // either rejection or 1e500. Neither happens: topN === 1 silently.
    // The fix should reject "1e500" entirely (Number("1e500") === Infinity,
    // !Number.isFinite), not silently coerce.
    const topN = resolveTopN('1e500');
    expect(topN).not.toBe(1);
    expect(topN).toBe(10);
  });

  it('R-1144-E: --top "999" (over-range) falls back to default, not silently accepted', () => {
    // The fix uses Number() (not parseInt) so out-of-range falls back to
    // default (10) per the Number.isInteger(args.topN) && 1..100 guard.
    const topN = resolveTopN('999');
    expect(topN).toBe(10);
  });

  it('R-1144-F: --top "10" (valid in-range) is preserved', () => {
    expect(resolveTopN('10')).toBe(10);
    expect(resolveTopN('1')).toBe(1);
    expect(resolveTopN('100')).toBe(100);
  });

  it('R-1144-G: --top "5.7" (non-integer) falls back to default (not silently truncated to 5)', () => {
    const topN = resolveTopN('5.7');
    expect(topN).not.toBe(5);
    expect(topN).toBe(10);
  });

  it('R-1144-H: --top "5abc" (trailing garbage) falls back to default (not silently truncated to 5)', () => {
    const topN = resolveTopN('5abc');
    expect(topN).not.toBe(5);
    expect(topN).toBe(10);
  });
});
