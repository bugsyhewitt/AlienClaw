/**
 * Cross-language genome spec compliance test (TypeScript side).
 *
 * Loads the same shared fixture as test/genome/test_fixtures.py and validates
 * every case against the canonical TypeScript genome codec at
 * src/alienclaw/registry/genome-codec.ts.
 *
 * This test and the Python test_fixtures.py consume the identical JSON file.
 * CI fails the build if either side disagrees with the fixture. Divergence
 * between the two implementations becomes structurally impossible to ship.
 *
 * Fixture kinds handled here:
 *   checksum          — computeChecksum(input) == expected
 *   assemble          — assembleGenome(identity, execution, behavior) == expected_genome
 *   parse             — parseGenome(genome) matches expected sections
 *   round_trip        — parseGenome() → sections → assembleGenome() == original
 *   validate          — validateGenome(genome).valid == expected_pass
 *   mutate_invariant  — validateGenome(python_output).valid (TS validates Python's output)
 *   crossover_invariant — same: validates Python's crossover output with TS validator
 *
 * Note: mutate_invariant and crossover_invariant test invariants, not exact
 * outputs — Python's random.Random and JavaScript's Math.random are not
 * compatible, so cross-language determinism of the operators is not tested.
 * The invariant tests confirm that Python-produced outputs satisfy the TS
 * validator, providing one-way cross-language compliance for the operators.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeChecksum,
  parseGenome,
  validateGenome,
  assembleGenome,
} from '../../src/alienclaw/registry/genome-codec.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

interface FixtureCase {
  name:                    string;
  kind:                    string;
  input?:                  string | Record<string, string>;
  expected?:               string | Record<string, unknown>;
  expected_genome?:        string;
  expected_pass?:          boolean;
  expected_error_contains?: string;
  python_output?:          string;
  python_section_sources?: string[];
  seed?:                   number;
  rate?:                   number;
  expected_invariants?:    Record<string, boolean>;
}

interface Fixture {
  $schema_version: string;
  cases:           FixtureCase[];
}

const fixturePath = resolve(__dirname, '../fixtures/genome-spec-fixtures.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

const SECTION_LENGTH = 64;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('genome spec compliance — cross-language fixture', () => {

  it('fixture has minimum 50 cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(50);
  });

  it('fixture schema version is 1.0', () => {
    expect(fixture.$schema_version).toBe('1.0');
  });

  for (const c of fixture.cases) {
    it(c.name, () => {

      switch (c.kind) {

        case 'checksum': {
          const input = c.input as string;
          const actual = computeChecksum(input);
          expect(actual).toBe(c.expected as string);
          break;
        }

        case 'assemble': {
          const { identity, execution, behavior } = c.input as Record<string, string>;
          const actual = assembleGenome(identity, execution, behavior);
          expect(actual).toBe(c.expected_genome);
          break;
        }

        case 'parse': {
          const genome  = c.input as string;
          const parsed  = parseGenome(genome);
          const exp     = c.expected as Record<string, string>;
          expect(parsed.identity).toBe(exp['identity']);
          expect(parsed.execution).toBe(exp['execution']);
          expect(parsed.behavior).toBe(exp['behavior']);
          expect(parsed.checksum).toBe(exp['checksum']);
          if (exp['checksum_valid']) {
            expect(validateGenome(genome).valid).toBe(true);
          }
          break;
        }

        case 'round_trip': {
          const genome  = c.input as string;
          const parsed  = parseGenome(genome);
          const rebuilt = assembleGenome(parsed.identity, parsed.execution, parsed.behavior);
          // assembleGenome recomputes checksum — rebuilt should equal original
          expect(rebuilt).toBe(genome);
          break;
        }

        case 'validate': {
          const result  = validateGenome(c.input as string);
          expect(result.valid).toBe(c.expected_pass);
          if (!c.expected_pass && c.expected_error_contains) {
            const needle  = c.expected_error_contains.toLowerCase();
            const errText = result.errors.join(' ').toLowerCase();
            expect(errText).toContain(needle);
          }
          break;
        }

        case 'mutate_invariant':
        case 'crossover_invariant': {
          // TypeScript validates the Python-produced output using the TS validator.
          // This is one-way compliance: Python output must satisfy the TS validator.
          const pyOutput = c.python_output as string;
          const inv      = c.expected_invariants ?? {};

          if (inv['valid_genome']) {
            const result = validateGenome(pyOutput);
            expect(result.valid).withContext(
              `${c.name}: Python output should be valid per TS validator. errors=${result.errors}`
            ).toBe(true);
          }
          if (inv['length_256']) {
            expect(pyOutput.length).toBe(256);
          }
          if (inv['id_tag_unchanged'] && c.kind === 'mutate_invariant') {
            const original = c.input as string;
            expect(pyOutput.slice(0, 8)).toBe(original.slice(0, 8));
          }
          if (inv['sections_from_parents'] && c.kind === 'crossover_invariant') {
            const { parent_a, parent_b } = c.input as Record<string, string>;
            for (let i = 0; i < 3; i++) {
              const section   = pyOutput.slice(i * SECTION_LENGTH, (i + 1) * SECTION_LENGTH);
              const paSection = parent_a.slice(i * SECTION_LENGTH, (i + 1) * SECTION_LENGTH);
              const pbSection = parent_b.slice(i * SECTION_LENGTH, (i + 1) * SECTION_LENGTH);
              const fromEither = section === paSection || section === pbSection;
              expect(fromEither).withContext(
                `${c.name}: section ${i} not from either parent`
              ).toBe(true);
            }
          }
          break;
        }

        default:
          throw new Error(`Unknown fixture kind '${c.kind}' in case '${c.name}'`);
      }
    });
  }
});
