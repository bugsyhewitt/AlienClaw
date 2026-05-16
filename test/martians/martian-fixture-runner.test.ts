/**
 * Cross-language Martian registry compliance test (TypeScript side).
 *
 * Consumes the same fixture as test/martians/test_fixtures.py
 * (test/fixtures/martian-registry-fixtures.json) and validates the
 * canonical TypeScript implementations at src/alienclaw/martians/.
 *
 * Fixture kinds handled here:
 *   tool_id              — TOOL_ID_TABLE[tool_name] === expected_id
 *   parse_martian_file   — parseMartian(file) yields expected fields
 *   parse_martian_error  — parseMartian throws containing expected_error
 *   registry_count       — MartianRegistry.load(...).all().length === expected_count
 *   registry_has         — MartianRegistry.load(...).has(martian_type) === expected
 *   validate_error       — validateMartian on parsed inline YAML reports the error
 *
 * Cases of unknown kinds are skipped (not failed) so that the Python suite can
 * own kinds the TS side hasn't implemented yet without breaking the build.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_ID_TABLE } from '../../src/alienclaw/martians/types.js';
import { parseMartian } from '../../src/alienclaw/martians/parser.js';
import { validateMartian } from '../../src/alienclaw/martians/validator.js';
import { MartianRegistry } from '../../src/alienclaw/martians/registry.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '../..');

interface FixtureCase {
  name:            string;
  kind:            string;
  input_file?:     string;
  content?:        string;
  spec_yaml?:      string;
  tool_name?:      string;
  martian_type?:   string;
  expected_id?:    number;
  expected_count?: number;
  expected_error?: string;
  expected?:       boolean | Record<string, unknown>;
}

interface Fixture {
  $schema_version: string;
  cases:           FixtureCase[];
}

const fixturePath = resolve(__dirname, '../fixtures/martian-registry-fixtures.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tool names from seed/msb/ — used to satisfy validator's brain-registry check. */
function loadKnownToolNames(): Set<string> {
  const msbDir = resolve(REPO_ROOT, 'seed/msb');
  const names  = new Set<string>();
  for (const f of readdirSync(msbDir)) {
    if (f.endsWith('.msb')) names.add(f.replace(/\.msb$/, ''));
  }
  return names;
}

let _registryCache: MartianRegistry | null = null;
function getRegistry(): MartianRegistry {
  if (_registryCache) return _registryCache;
  _registryCache = MartianRegistry.load(
    resolve(REPO_ROOT, 'seed/martians'),
    loadKnownToolNames(),
  );
  return _registryCache;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('martian registry spec compliance — cross-language fixture', () => {
  it('fixture has minimum 16 cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(16);
  });

  it('fixture schema version is 1.0', () => {
    expect(fixture.$schema_version).toBe('1.0');
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const exp = (typeof c.expected === 'object' && c.expected !== null)
        ? c.expected as Record<string, unknown>
        : {};

      if (c.kind === 'tool_id') {
        const id = TOOL_ID_TABLE[c.tool_name!];
        expect(id).toBe(c.expected_id);

      } else if (c.kind === 'parse_martian_file') {
        const content = readFileSync(resolve(REPO_ROOT, c.input_file!), 'utf-8');
        const spec    = parseMartian(content, c.input_file);
        if ('martian_type' in exp) expect(spec.martianType).toBe(exp['martian_type']);
        if ('slot_count'   in exp) expect(spec.slots.length).toBe(exp['slot_count']);
        if ('slot_0_tool'  in exp) expect(spec.slots[0]?.toolName).toBe(exp['slot_0_tool']);
        if ('slot_1_tool'  in exp) expect(spec.slots[1]?.toolName).toBe(exp['slot_1_tool']);

      } else if (c.kind === 'parse_martian_error') {
        let err: Error | null = null;
        try { parseMartian(c.content ?? '', '<inline>'); }
        catch (e) { err = e as Error; }
        expect(err, `expected parseMartian to throw for ${c.name}`).not.toBeNull();
        if (c.expected_error) {
          expect(err!.message.toLowerCase()).toContain(c.expected_error.toLowerCase());
        }

      } else if (c.kind === 'registry_count') {
        expect(getRegistry().all().length).toBe(c.expected_count);

      } else if (c.kind === 'registry_has') {
        expect(getRegistry().has(c.martian_type!)).toBe(c.expected);

      } else if (c.kind === 'validate_error') {
        const spec = parseMartian(c.spec_yaml ?? '', '<inline>');
        const result = validateMartian(spec, loadKnownToolNames());
        expect(result.valid).toBe(false);
        if (c.expected_error) {
          const blob = result.errors.join(' ');
          expect(blob).toContain(c.expected_error);
        }

      } else {
        // Unknown kind — skipped to allow Python-only fixture kinds.
      }
    });
  }
});
