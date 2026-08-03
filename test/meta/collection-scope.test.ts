import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// PKT-537: assert vitest.config.ts exclude list covers MEMORY/ and scratch trees,
// so the ship gate measures the same file set as CI.

const configText = readFileSync(resolve(__dirname, '../../vitest.config.ts'), 'utf8');

// Parse the exclude array out of the raw config text by running the module.
// We import it dynamically so the test stays in-process.
const vitestConfig = await import('../../vitest.config.ts').then(m => m.default);
const excludes: string[] = vitestConfig.test?.exclude ?? [];

describe('vitest.config.ts collection scope', () => {
  it('exclude list contains MEMORY/**', () => {
    expect(excludes).toContain('MEMORY/**');
  });

  it('exclude list contains a glob that matches test/scratch/', () => {
    const scratchCovered = excludes.some(
      g => g === 'test/scratch/**' || g === '**/scratch/**',
    );
    expect(scratchCovered).toBe(true);
  });

  it('.salvaged suffix is not matched by the default vitest include glob', () => {
    // Default include: **/*.{test,spec}.?(c|m)[jt]s?(x)
    // A .salvaged file ends in e.g. ".test.ts.salvaged" — the extension is ".salvaged",
    // not ".ts", so it does NOT match the include glob.
    const salvaged = 'some/path/boss-bot-stub-concerns.test.ts.salvaged';
    const defaultInclude = /\.(test|spec)\.(c|m)?(j|t)sx?$/;
    expect(defaultInclude.test(salvaged)).toBe(false);
  });
});
