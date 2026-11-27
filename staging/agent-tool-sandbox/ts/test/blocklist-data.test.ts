/**
 * The generated block list matches policy/blocklist.v1.json, and hardened-fetch.ts
 * decides only from it.
 *
 * policy/gen-ts.mjs renders src/blocklist-data.ts from the JSON. These tests render
 * it again in memory and compare bytes, so they fail when the JSON was edited
 * without re-running the generator, or when the generated module was edited by
 * hand. They skip when policy/ is not next to the package (the package lifted on
 * its own).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as data from '../src/blocklist-data.js';

const GENERATOR = fileURLToPath(new URL('../../policy/gen-ts.mjs', import.meta.url));
const SOURCE = fileURLToPath(new URL('../../policy/blocklist.v1.json', import.meta.url));
const GENERATED = fileURLToPath(new URL('../src/blocklist-data.ts', import.meta.url));
const GUARD = fileURLToPath(new URL('../src/hardened-fetch.ts', import.meta.url));

interface Generator {
  render(text: string): string;
  load(text: string): { profile: string };
  resolve(doc: unknown, lang: 'python' | 'ts'): Record<string, unknown>;
}

const generator = async (): Promise<Generator> =>
  (await import(pathToFileURL(GENERATOR).href)) as Generator;

describe.skipIf(!existsSync(GENERATOR) || !existsSync(SOURCE))('generated block list', () => {
  it('matches policy/blocklist.v1.json byte for byte (else run node policy/gen-ts.mjs)', async () => {
    const { render } = await generator();
    expect(readFileSync(GENERATED, 'utf8')).toBe(render(readFileSync(SOURCE, 'utf8')));
  });

  it('says GENERATED — do not edit, for the ts column', () => {
    expect(readFileSync(GENERATED, 'utf8').split('\n')[0]).toBe('// GENERATED — do not edit.');
    expect(data.COLUMN).toBe('ts');
  });

  it('strictest-wins gives both languages the same rules', async () => {
    const { load, resolve } = await generator();
    const doc = JSON.parse(readFileSync(SOURCE, 'utf8')) as Record<string, unknown>;
    doc.profile = 'strictest-wins';
    const loaded = load(JSON.stringify(doc));
    const { off: _offPy, ...py } = resolve(loaded, 'python');
    const { off: _offTs, ...ts } = resolve(loaded, 'ts');
    expect(py).toEqual(ts);
  });
});

describe('hardened-fetch.ts reads its ranges from the generated table', () => {
  it('has no range or name literal of its own left', () => {
    const src = readFileSync(GUARD, 'utf8');
    for (const literal of ["'localhost'", '0x2002', '0xff9b', '0xfec0', '0xfe80', '0xfc00', '0xff00', '=== 127', '=== 169']) {
      expect(src.includes(literal), literal).toBe(false);
    }
  });
});
