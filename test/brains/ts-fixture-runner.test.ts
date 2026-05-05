/**
 * Cross-language brain registry compliance test (TypeScript side).
 *
 * Loads the same shared fixture as test/brains/test_fixtures.py and validates
 * every case against the canonical TypeScript msb-loader at
 * src/alienclaw/msb/msb-loader.ts.
 *
 * This test and the Python test_fixtures.py consume the identical JSON file.
 * CI fails if either side disagrees with the fixture.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMsbContent, validateMsb } from '../../src/alienclaw/msb/msb-loader.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

interface FixtureCase {
  name:                    string;
  kind:                    string;
  input_file?:             string;
  input_content?:          string;
  seed_dir?:               string;
  expected_pass?:          boolean;
  expected_error_contains?: string;
  expected?:               Record<string, unknown>;
}

interface Fixture {
  $schema_version: string;
  cases:           FixtureCase[];
}

const fixturePath = resolve(__dirname, '../fixtures/brain-registry-fixtures.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

// ---------------------------------------------------------------------------
// Helper: load .msb file content
// ---------------------------------------------------------------------------

function loadContent(c: FixtureCase): string {
  if (c.input_file) {
    return readFileSync(resolve(__dirname, '../..', c.input_file), 'utf-8');
  }
  return c.input_content ?? '';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('brain registry spec compliance — cross-language fixture', () => {

  it('fixture has minimum 30 cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(30);
  });

  it('fixture schema version is 1.0', () => {
    expect(fixture.$schema_version).toBe('1.0');
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const exp = c.expected ?? {};

      if (c.kind === 'parse' || c.kind === 'parse_inline') {
        const content = loadContent(c);
        const spec    = parseMsbContent(content);

        if ('tool' in exp)
          expect(spec.tool).toBe(exp['tool']);
        if ('version' in exp)
          expect(spec.version).toBe(exp['version']);

        if ('capabilities_first_line' in exp)
          expect(spec.capabilities.split('\n')[0]).toBe(exp['capabilities_first_line']);
        if ('capabilities_line_count' in exp)
          expect(spec.capabilities.split('\n').length).toBe(exp['capabilities_line_count']);
        if ('capabilities_line_1' in exp)
          expect(spec.capabilities.split('\n')[0]).toBe(exp['capabilities_line_1']);
        if ('capabilities_nonempty' in exp)
          expect(Boolean(spec.capabilities)).toBe(exp['capabilities_nonempty']);
        if ('limitations_nonempty' in exp)
          expect(Boolean(spec.limitations)).toBe(exp['limitations_nonempty']);
        if ('failure_modes_nonempty' in exp)
          expect(Boolean(spec.failureModes)).toBe(exp['failure_modes_nonempty']);
        if ('best_practices_nonempty' in exp)
          expect(Boolean(spec.bestPractices)).toBe(exp['best_practices_nonempty']);

        if ('execution_order_count' in exp)
          expect(spec.executionOrder.length).toBe(exp['execution_order_count']);
        if ('execution_order_first' in exp)
          expect(spec.executionOrder[0] ?? '').toBe(exp['execution_order_first']);
        if ('execution_order_last' in exp)
          expect(spec.executionOrder[spec.executionOrder.length - 1] ?? '').toBe(
            exp['execution_order_last']
          );
        if ('output_contract_nonempty' in exp)
          expect(Boolean(spec.outputContract)).toBe(exp['output_contract_nonempty']);

        if ('genome_identity_contains' in exp)
          expect(spec.genomeSections.identity).toContain(String(exp['genome_identity_contains']));
        if ('genome_identity_nonempty' in exp)
          expect(Boolean(spec.genomeSections.identity)).toBe(exp['genome_identity_nonempty']);
        if ('genome_execution_nonempty' in exp)
          expect(Boolean(spec.genomeSections.execution)).toBe(exp['genome_execution_nonempty']);
        if ('genome_behavior_nonempty' in exp)
          expect(Boolean(spec.genomeSections.behavior)).toBe(exp['genome_behavior_nonempty']);
        if ('genome_checksum_nonempty' in exp)
          expect(Boolean(spec.genomeSections.checksum)).toBe(exp['genome_checksum_nonempty']);

        if ('variables_keys' in exp) {
          const expectedKeys = exp['variables_keys'] as string[];
          expect(Object.keys(spec.variables)).toEqual(expectedKeys);
        }
        if ('variables_count' in exp)
          expect(Object.keys(spec.variables).length).toBe(exp['variables_count']);

      } else if (c.kind === 'validate') {
        const content = loadContent(c);
        const result  = validateMsb(content);
        expect(result.valid).toBe(c.expected_pass);
        if (!c.expected_pass && c.expected_error_contains) {
          const errText = result.errors.join(' ');
          expect(errText).toContain(c.expected_error_contains);
        }

      } else if (c.kind === 'catalog') {
        // TypeScript side: load each brain file individually (no full registry class yet)
        // Validate catalog expectations using parseMsbContent per-file
        const { readdirSync } = require('node:fs');
        const { join }        = require('node:path');
        const dir = resolve(__dirname, '../..', c.seed_dir ?? 'seed/msb/');
        const files = readdirSync(dir)
          .filter((f: string) => f.endsWith('.msb'))
          .sort();
        const brains = files.map((f: string) =>
          parseMsbContent(readFileSync(join(dir, f), 'utf-8'), f)
        );

        if ('brain_count' in exp)
          expect(brains.length).toBe(exp['brain_count']);
        if ('tool_names' in exp) {
          const sortedNames = [...brains.map(b => b.tool)].sort();
          expect(sortedNames).toEqual(exp['tool_names']);
        }
        if ('versions' in exp) {
          const versions = Object.fromEntries(brains.map(b => [b.tool, b.version]));
          expect(versions).toEqual(exp['versions']);
        }
        if ('tool_names_in_load_order' in exp) {
          expect(brains.map(b => b.tool)).toEqual(exp['tool_names_in_load_order']);
        }

      } else {
        throw new Error(`Unknown fixture kind '${c.kind}' in case '${c.name}'`);
      }
    });
  }
});
