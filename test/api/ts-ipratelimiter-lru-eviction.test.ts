import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IpRateLimiter } from '../../src/alienclaw/api/rate-limit.js';

type R = { _readBucket: Map<string, number[]>; _submitBucket: Map<string, number[]> };

function fill(r: R, n: number, ipPrefix = 'synth') {
  const now = Date.now() / 1000;
  for (let i = 0; i < n; i++) r._readBucket.set(`${ipPrefix}${i}`, [now - i * 0.001]);
}

// Snapshot/restore for env vars — overmind flagged PKT-089's env-leak bug, every
// IpRateLimiter test must clean up so test order cannot poison the constructor.
const ENV_KEYS = ['ALIENCLAW_RATE_READ_PER_MIN', 'ALIENCLAW_RATE_SUBMIT_PER_HOUR'] as const;
function snapshotEnv() {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  return saved;
}
function restoreEnv(saved: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe('IpRateLimiter — eviction is LRU (re-author of REJECTED PKT-090, slot 1111)', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = snapshotEnv();
    // Lock down the rate limits so we can deliberately exhaust them below
    // and exercise the deny path explicitly. Without this, tests rely on
    // whatever the env happens to be set to at test time.
    process.env['ALIENCLAW_RATE_READ_PER_MIN']    = '5';
    process.env['ALIENCLAW_RATE_SUBMIT_PER_HOUR'] = '1000000';
  });

  afterEach(() => {
    restoreEnv(savedEnv);
  });

  it('LRU-1: below cap, hammering an existing IP promotes it to MRU (last in iteration order)', () => {
    // Five distinct IPs, then hammer the first one. Under TRUE LRU, the hammered
    // IP moves to the END of iteration order (most-recently-used). Under FIFO
    // (the current origin/main behavior), it stays at index 0 because Map.set()
    // does not reorder an existing key.
    const l = new IpRateLimiter({ readPerMin: 1_000_000, submitPerHour: 1_000_000 });
    const r = l as unknown as R;

    for (let i = 0; i < 5; i++) l.checkRead(`ip${i}`);
    for (let i = 0; i < 200; i++) l.checkRead('ip0');

    const order = [...r._readBucket.keys()];
    expect(order[order.length - 1]).toBe('ip0');
    expect(order[0]).not.toBe('ip0');
  });

  it('LRU-2: at cap, evicting an inactive IP leaves a hammered IP intact (accept path)', () => {
    // Insert 'hammered' FIRST (so under FIFO it is the eviction victim). Then
    // fill with 9_999 synthetic IPs. Then hammer 'hammered' many times (under
    // LRU it should be promoted to MRU; under FIFO it stays at index 0).
    // Then trigger eviction with a new IP. Under LRU, 'hammered' survives.
    // Under FIFO, 'hammered' is the first-inserted and gets evicted.
    const l = new IpRateLimiter({ readPerMin: 1_000_000, submitPerHour: 1_000_000 });
    const r = l as unknown as R;

    l.checkRead('hammered');                          // first-inserted
    fill(r, 9_999, 'synth');                          // 9_999 more entries
    expect(r._readBucket.size).toBe(10_000);

    for (let i = 0; i < 50; i++) l.checkRead('hammered'); // hammer → MRU under LRU
    expect(r._readBucket.has('hammered')).toBe(true);

    // Trigger eviction with a genuinely-new IP.
    l.checkRead('newcomer');
    expect(r._readBucket.size).toBe(10_000);

    // Headline assertion: 'hammered' survives despite being first-inserted.
    // Under FIFO, 'hammered' (index 0) is the eviction victim. Under LRU,
    // 'hammered' was most-recently-touched and survives; one of the synth
    // entries is evicted instead.
    expect(r._readBucket.has('hammered')).toBe(true);
    expect(r._readBucket.has('newcomer')).toBe(true);
  });

  it('LRU-3 (DENY PATH, was Option A miss): at cap, an IP exhausting its budget survives eviction', () => {
    // The IP 'victim' burns its entire 5-read budget. From that point on every
    // checkRead('victim') returns [false, retryAfter] via the DENY PATH at L143
    // of rate-limit.ts (rate-limit.ts:135-144 on origin/main @ c52b98b5).
    //
    // Option A (rejected) ONLY promoted existing IPs on the ACCEPT path, so a
    // deny-path hammering IP stayed at iteration index 0 and was evicted by
    // the next newcomer — exactly the "denial-of-budget" scenario Option A
    // claimed to fix but didn't.
    //
    // The corrected fix (delete-before-set on BOTH paths, unconditionally)
    // must promote 'victim' even on the deny path, so 'victim' survives
    // eviction by a fresh newcomer.
    const l = new IpRateLimiter({ readPerMin: 5, submitPerHour: 1_000_000 });
    const r = l as unknown as R;

    // Burn 'victim's budget.
    for (let i = 0; i < 5; i++) expect(l.checkRead('victim')[0]).toBe(true);
    expect(l.checkRead('victim')[0]).toBe(false);   // budget exhausted → deny path from here

    fill(r, 9_999, 'synth');                         // pad to cap (10_000)
    expect(r._readBucket.size).toBe(10_000);

    // 'victim' is the oldest-inserted key. Hammer via the deny path.
    for (let i = 0; i < 50; i++) expect(l.checkRead('victim')[0]).toBe(false);
    // Under FIFO, 'victim' is still at index 0 because the deny path's
    // bucket.set(ip, ts) doesn't reorder. Under LRU, the deny path must
    // promote it.
    expect([...r._readBucket.keys()][0]).not.toBe('victim');

    // Trigger eviction with a genuinely-new IP.
    l.checkRead('newcomer');
    expect(r._readBucket.size).toBe(10_000);

    // The headline assertion: 'victim' survives.
    // Under FIFO, 'victim' (first-inserted) is dropped. Under LRU, 'victim'
    // was the most-recently-touched IP via the deny path, so it survives.
    expect(r._readBucket.has('victim')).toBe(true);
    expect(r._readBucket.has('newcomer')).toBe(true);
  });

  it('LRU-4 (regression): fresh small workload still allows every read (no false denies)', () => {
    // Sanity check: with the fix, a small workload (5 distinct IPs, each
    // hitting once) still works. This guards against an over-aggressive
    // fix that breaks the happy path.
    const l = new IpRateLimiter({ readPerMin: 1_000_000, submitPerHour: 1_000_000 });
    for (let i = 0; i < 5; i++) {
      const [ok, retryAfter] = l.checkRead(`ip${i}`);
      expect(ok).toBe(true);
      expect(retryAfter).toBe(0);
    }
  });
});
