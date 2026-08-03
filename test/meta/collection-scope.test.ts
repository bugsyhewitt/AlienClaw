import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// PKT-537: assert vitest.config.ts exclude list covers MEMORY/ and scratch trees,
// so the ship gate measures the same file set as CI.

const configText = readFileSync(resolve(__dirname, '../../vitest.config.ts'), 'utf8');

describe('vitest.config.ts collection scope', () => {
  it('exclude list contains MEMORY/**', () => {
    expect(configText).toContain("'MEMORY/**'");
  });

  it('exclude list contains a glob that matches test/scratch/', () => {
    const scratchCovered =
      configText.includes("'test/scratch/**'") ||
      configText.includes("'**/scratch/**'");
    expect(scratchCovered).toBe(true);
  });

  it('.salvaged suffix is not matched by the default vitest include glob', () => {
    // Default include: **/*.{test,spec}.?(c|m)[jt]s?(x)
    // A .salvaged file ends in ".salvaged", not ".ts", so it does NOT match.
    const salvaged = 'some/path/boss-bot-stub-concerns.test.ts.salvaged';
    const defaultInclude = /\.(test|spec)\.(c|m)?(j|t)sx?$/;
    expect(defaultInclude.test(salvaged)).toBe(false);
  });
});
