/**
 * ms-loader-strict-metadata.test.ts — PKT-774 reproduction
 *
 * Verifies that ms-loader.ts::parseMetadata REJECTS malformed metadata values
 * that parseInt/parseFloat silently coerce. Mirror of PKT-674 test suite
 * (test/msb/msb-loader-strict-int-regex.test.ts) for the .ms METADATA parser.
 *
 * Owner: tester-alienclaw (Xephyr :23) — built off PKT-769 (REJECTED 2026-08-19).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MsParseError, loadMsFile } from '../../src/alienclaw/registry/ms-loader.js';
import { assembleGenome } from '../../src/alienclaw/registry/genome-codec.js';

function makeGenome(): string {
  // 64-char padded identity, all-A execution, all-B behavior
  const id = 'ABCD'.padEnd(64, 'X');
  const exec = 'A'.repeat(64);
  const beh = 'B'.repeat(64);
  return assembleGenome(id, exec, beh);
}

const VALID_GENOME = makeGenome();

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'msloader-strict-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function buildContent(genome: string, meta: { generation: string; status: string; fitness: string }): string {
  return [
    '# MS_TEST0001',
    '# description: strict-parser probe',
    `# generation: ${meta.generation}`,
    `# status: ${meta.status}`,
    `# fitness: ${meta.fitness}`,
    '',
    '[GENOME]',
    genome,
    '',
    '[TOOLS]',
    'web_search → web_search.msb',
    '',
  ].join('\n');
}

describe('PKT-774: ms-loader strict metadata coercion guards', () => {
  describe('generation: silently-coerced values from parseInt() must throw', () => {
    const cases: [string, string][] = [
      ['5abc',  'trailing letters'],
      ['1e2',   'exponent notation'],
      ['+5',    'leading plus'],
      ['5.7',   'fractional'],
    ];
    for (const [val, label] of cases) {
      it(`rejects generation: ${val} (${label})`, () => {
        const path = join(tmpDir, 'test.ms');
        writeFileSync(path, buildContent(VALID_GENOME, {
          generation: val, status: 'active', fitness: '0.5',
        }));
        expect(() => loadMsFile(path)).toThrow(MsParseError);
      });
    }

    it('STILL accepts sanitised "5 " (trailing whitespace is fine)', () => {
      const path = join(tmpDir, 'test.ms');
      writeFileSync(path, buildContent(VALID_GENOME, {
        generation: '5 ', status: 'active', fitness: '0.5',
      }));
      const spec = loadMsFile(path);
      expect(spec.generation).toBe(5);
    });
  });

  describe('fitness: silently-coerced values from parseFloat() must throw', () => {
    it('rejects fitness: 0.5abc (trailing letters)', () => {
      const path = join(tmpDir, 'test.ms');
      writeFileSync(path, buildContent(VALID_GENOME, {
        generation: '5', status: 'active', fitness: '0.5abc',
      }));
      expect(() => loadMsFile(path)).toThrow(MsParseError);
    });
  });
});
