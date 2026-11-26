/**
 * fixture-sync.test.ts — the staged fixture copy must stay byte-identical to
 * the shared cross-language fixture in the AlienClaw tree
 * (test/fixtures/genome-spec-fixtures.json), which the Python twin also reads.
 *
 * When the package is lifted out of the AlienClaw repo the in-tree source path
 * no longer exists; the byte comparison is then skipped so the package stays
 * self-contained. The staged copy's own sanity check always runs.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** staging/genome-ts/test/fixtures/genome-spec-fixtures.json */
const STAGED_FIXTURE = resolve(here, 'fixtures/genome-spec-fixtures.json');
/** <repo>/test/fixtures/genome-spec-fixtures.json (three levels up: test -> genome-ts -> staging -> repo) */
const IN_TREE_FIXTURE = resolve(here, '../../../test/fixtures/genome-spec-fixtures.json');

const inTreePresent = existsSync(IN_TREE_FIXTURE);

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe('genome fixture sync', () => {
  it('staged fixture exists and parses as a schema 1.0 fixture', () => {
    const staged = JSON.parse(readFileSync(STAGED_FIXTURE, 'utf-8')) as {
      $schema_version: string;
      cases: unknown[];
    };
    expect(staged.$schema_version).toBe('1.0');
    expect(Array.isArray(staged.cases)).toBe(true);
  });

  it.skipIf(!inTreePresent)(
    'staged fixture is byte-identical to the in-tree shared fixture',
    () => {
      const staged = readFileSync(STAGED_FIXTURE);
      const inTree = readFileSync(IN_TREE_FIXTURE);
      expect(staged.length).toBe(inTree.length);
      expect(sha256(staged)).toBe(sha256(inTree));
      expect(staged.equals(inTree)).toBe(true);
    },
  );
});
