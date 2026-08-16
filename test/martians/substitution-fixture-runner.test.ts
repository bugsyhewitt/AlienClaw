/**
 * Cross-language substitution parity fixture runner (TypeScript side).
 *
 * Consumes the same fixture as test/martians/test_substitution_fixtures.py
 * (test/fixtures/martian-substitution-fixtures.json) and validates the
 * TypeScript substitute() implementation.
 *
 * Fixture kinds handled:
 *   substitute       — substitute(template, slot_outputs, campaign_inputs) === expected
 *   substitute_error — substitute(...) throws with message matching expected_error
 *
 * Unknown kinds are skipped (not failed) to allow Python-only kinds.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { substitute } from '../../src/alienclaw/martians/substitution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SubstFixtureCase {
  name: string;
  kind: string;
  template: string;
  slot_outputs: Record<string, unknown>[];
  campaign_inputs: Record<string, unknown>;
  expected?: string;
  expected_ts?: string;  // overrides expected when JS JSON.stringify differs from Python json.dumps
  expected_error?: string;
}

interface SubstFixture {
  $schema_version: string;
  cases: SubstFixtureCase[];
}

const fixturePath = resolve(__dirname, '../fixtures/martian-substitution-fixtures.json');
const fixture: SubstFixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

describe('substitution parity — cross-language fixture (TS side)', () => {
  it('fixture has minimum 20 cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      if (c.kind === 'substitute') {
        const result = substitute(c.template, c.slot_outputs, c.campaign_inputs);
        expect(result).toBe(c.expected_ts ?? c.expected);
      } else if (c.kind === 'substitute_error') {
        expect(() => substitute(c.template, c.slot_outputs, c.campaign_inputs))
          .toThrow(c.expected_error);
      }
      // Unknown kinds: skip silently.
    });
  }
});
