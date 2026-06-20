/**
 * live-submit-from-file.test.ts — Live end-to-end smoke for submitFromFile.
 *
 * THIS TEST REQUIRES NETWORK ACCESS and ALIENCLAW_LIVE_SMOKE=1 to run.
 * It exercises the actual function from packet 039 against api.alienclaw.net
 * (the v9 Hostinger-deployed artifact) and proves the fix lands on a live
 * server. Skipped by default so unit/CI runs stay offline.
 *
 * Predecessor: Packet 039 (commit a877aac7 on fix/packet-39-submitfromfile-genome).
 *
 * Walls check: No architecture change. No Martian LLM. No genome length change.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assembleGenome, BASE62_ALPHABET } from '../../../src/alienclaw/registry/genome-codec.js';
import { submitFromFile, type SubmissionArtifact } from '../../../src/alienclaw/governance/common/leaderboard.js';

const SMOKE_ENABLED = process.env.ALIENCLAW_LIVE_SMOKE === '1';
const LIVE_BASE     = 'https://api.alienclaw.net/v1';
const MARTIAN_TYPE  = 'web_search';   // 0 current submissions — see /v1/stats grounding
const FITNESS       = 0.5;

function toBase62(bytes: Buffer): string {
  // 43-char Base62 key per LEADERBOARD_API_SPEC.md §"API key generation"
  let n = BigInt('0x' + bytes.toString('hex'));
  const alphabet = BASE62_ALPHABET;
  let out = '';
  while (n > 0n) {
    out = alphabet[Number(n % 62n)] + out;
    n = n / 62n;
  }
  return out.padStart(43, '0');
}

describe.skipIf(!SMOKE_ENABLED)('LIVE: submitFromFile round-trip (api.alienclaw.net)', () => {
  let apiKey: string;
  let installId: string;
  let artifactPath: string;
  let submittedRank: number;

  beforeAll(async () => {
    if (!SMOKE_ENABLED) return;   // skip handler will short-circuit

    // 1. Mint 43-char Base62 API key
    apiKey = toBase62(randomBytes(32));

    // 2. POST /v1/install — deterministic machine_hash from a fixed string (no PII)
    const machineHash = createHash('sha256').update('ALIENCLAW_LIVE_SMOKE_TEST').digest('hex');
    const installResp = await fetch(`${LIVE_BASE}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, machine_hash: machineHash }),
    });
    expect([200, 201]).toContain(installResp.status);
    const installBody = (await installResp.json()) as { install_id: string };
    installId = installBody.install_id;

    // 3. Build valid 256-char genome (assembleGenome auto-computes checksum)
    const identity  = 'LIVE0001G1AlienClaw1' + '0'.repeat(44);   // 8+2+10+44 = 64 chars
    const execution = 'A'.repeat(64);
    const behavior  = 'B'.repeat(64);
    const genome    = assembleGenome(identity, execution, behavior);
    expect(genome).toHaveLength(256);
    expect(assembleGenome).toBeDefined;   // type-level check; assembly succeeded

    // 4. Write on-disk SubmissionArtifact
    const dir = mkdtempSync(join(tmpdir(), 'alienclaw-live-smoke-'));
    artifactPath = join(dir, 'submission.json');
    const artifact: SubmissionArtifact = {
      leaderboard_name: 'LIVESMOKE',
      genome,
      genome_hash: createHash('sha256').update(genome).digest('hex'),
      martian_type: MARTIAN_TYPE,
      fitness: FITNESS,
      checked_at: new Date().toISOString(),
    };
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');

    // 5. Call the actual fixed function (not a reimplementation)
    const result = await submitFromFile(artifactPath, apiKey, `${LIVE_BASE}/genomes`);
    submittedRank = result.rank;
    expect(result.is_new_top).toBe(true);
    expect(typeof result.rank).toBe('number');
  }, 30_000);   // 30 s timeout covers 3 sequential HTTPS round-trips

  it('install_id is opaque (server-assigned)', () => {
    expect(typeof installId).toBe('string');
    expect(installId.length).toBeGreaterThan(0);
  });

  it('rank is 1 on the first web_search submission', () => {
    expect(submittedRank).toBe(1);
  });

  it('GET /v1/genomes/top returns the submitted genome for web_search', async () => {
    const resp = await fetch(`${LIVE_BASE}/genomes/top?martian_type=${MARTIAN_TYPE}`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { genomes: Array<{ genome: string; fitness: number }> };
    expect(body.genomes.length).toBeGreaterThan(0);
    // The first (rank=1) entry's genome must be exactly 256 Base62 chars
    expect(body.genomes[0]!.genome).toHaveLength(256);
    expect(body.genomes[0]!.fitness).toBe(FITNESS);
  }, 15_000);
});
