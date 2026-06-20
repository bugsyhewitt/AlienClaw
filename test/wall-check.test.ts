/**
 * Machine-checkable wall-check vitest.
 *
 * Enforces the canonical-3-layer architecture rules from AGENTS.md as a vitest.
 * Previously, AGENTS.md "VERIFICATION CHECKLIST" item 6 was a manual pre-merge
 * grep; this test makes it a CI guard that fails the build if any banned term
 * re-enters src/ (or other scoped directories) outside the documented allowlist.
 *
 * Scoped to high-confidence wall terms that currently have ZERO hits in scanned
 * file types (.ts/.tsx/.js/.mjs/.cjs/.py/.sh) on origin/main (verified at
 * authoring-wake 2026-06-19T11:15Z via §G-1..§G-5 of packet 049). The lowercase
 * term "specialist" is NOT in the banned set because it has legitimate surface
 * in origin/main (specialist.soul.md, specialistId field); enforcing it as
 * banned would force this packet to depend on PRs #24 + #25 (the
 * specialist.soul.md → subagent.soul.md + Employee→Subagent renames), which is
 * a stacked PR — explicitly avoided.
 *
 * The scanner only reads .ts/.tsx/.js/.mjs/.cjs/.py/.sh files. .md files
 * (including specialist.soul.md) are NOT scanned, so no allowlist entry is
 * needed for the capital-S "Specialist" hits in specialist.soul.md (those hits
 * live in a .md file the scanner doesn't read — see G-3, G-11).
 *
 * Run: ./node_modules/.bin/vitest run test/wall-check.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-safe __dirname derivation (this project is "type": "module")
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
// File lives at test/wall-check.test.ts — one level below repo root
const REPO_ROOT  = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Banned term set
// ---------------------------------------------------------------------------

interface BannedRule {
  id: string;
  pattern: RegExp;
  description: string;
}

const BANNED_RULES: BannedRule[] = [
  {
    id: 'meeseeks-any-case',
    pattern: /\bmeeseeks\b/i,
    description: 'Banned term: "meeseeks" (replaced by "Martian" per AGENTS.md wall)',
  },
  {
    id: 'five-layer-any-case',
    pattern: /\b(5|five|fifth)[\s-]layer\b/i,
    description: 'Banned term: 5-layer / five-layer / fifth-layer architecture (replaced by 3-layer)',
  },
  {
    id: 'specialist-capitalized',
    // Word-boundary on both sides; matches Specialist, Specialists, SpecialistRole, etc.
    // The 'S' must be capital — lowercase 'specialist' has legitimate surface in
    // origin/main (specialist.soul.md, specialistId) and is not in the banned set.
    pattern: /\bSpecialist\w*\b/,
    description: 'Banned term: capital-S "Specialist" / "Specialists" / "SpecialistRole" (use "Subagent")',
  },
];

// ---------------------------------------------------------------------------
// Directories to scan (per R-001)
// ---------------------------------------------------------------------------

const SCAN_ROOTS = ['src', 'test', 'scripts', 'git-hooks'] as const;

// ---------------------------------------------------------------------------
// Allowlist — files where a banned term is intentional and documented.
// Mechanism preserved (R-008) for future rule extensions. Empty on origin/main
// at authoring (verified §G-3: no Specialist hit in any scanned file type).
// ---------------------------------------------------------------------------

interface AllowlistEntry {
  file: string;       // path relative to REPO_ROOT
  ruleId: string;     // BANNED_RULES[].id this entry applies to
  reason: string;     // human-readable explanation
}

const ALLOWLIST: AllowlistEntry[] = [];

// ---------------------------------------------------------------------------
// File scanner
// ---------------------------------------------------------------------------

interface Violation {
  file: string;
  line: number;
  ruleId: string;
  description: string;
  match: string;
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'coverage') {
      continue;
    }
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (st.isFile()) {
      // Only scan text-ish source files (not binary, not generated)
      if (/\.(ts|tsx|js|mjs|cjs|py|sh)$/.test(name)) {
        acc.push(full);
      }
    }
  }
  return acc;
}

function scanFile(absPath: string): Violation[] {
  const rel = absPath.slice(REPO_ROOT.length + 1);
  // Self-skip — this file is the wall-check itself; its content is meta, not source.
  if (rel === 'test/wall-check.test.ts') return [];

  const allowed = ALLOWLIST
    .filter((a) => a.file === rel)
    .map((a) => a.ruleId);

  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n');
  const out: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (const rule of BANNED_RULES) {
      if (allowed.includes(rule.id)) continue;
      const m = lines[i].match(rule.pattern);
      if (m) {
        out.push({
          file: rel,
          line: i + 1,
          ruleId: rule.id,
          description: rule.description,
          match: m[0],
        });
      }
    }
  }
  return out;
}

function scanAll(): Violation[] {
  const all: Violation[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    for (const file of walk(abs)) {
      all.push(...scanFile(file));
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wall-check: canonical 3-layer architecture enforcement', () => {
  it('R-001: file scanner runs without throwing', () => {
    const violations = scanAll();
    expect(Array.isArray(violations)).toBe(true);
  });

  it('R-002: no banned term appears in src/ outside allowlist', () => {
    const violations = scanAll().filter((v) => v.file.startsWith('src/'));
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  [${v.ruleId}]  ${v.match}`)
        .join('\n');
      throw new Error(
        `Banned wall terms found in src/ (${violations.length} hit${violations.length === 1 ? '' : 's'}):\n${msg}`,
      );
    }
  });

  it('R-003: no banned term appears in test/ outside allowlist', () => {
    const violations = scanAll().filter((v) => v.file.startsWith('test/'));
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  [${v.ruleId}]  ${v.match}`)
        .join('\n');
      throw new Error(
        `Banned wall terms found in test/ (${violations.length} hit${violations.length === 1 ? '' : 's'}):\n${msg}`,
      );
    }
  });

  it('R-004: no banned term appears in scripts/ outside allowlist', () => {
    const violations = scanAll().filter((v) => v.file.startsWith('scripts/'));
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  [${v.ruleId}]  ${v.match}`)
        .join('\n');
      throw new Error(
        `Banned wall terms found in scripts/ (${violations.length} hit${violations.length === 1 ? '' : 's'}):\n${msg}`,
      );
    }
  });

  it('R-005: no banned term appears in git-hooks/ outside allowlist', () => {
    const violations = scanAll().filter((v) => v.file.startsWith('git-hooks/'));
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  [${v.ruleId}]  ${v.match}`)
        .join('\n');
      throw new Error(
        `Banned wall terms found in git-hooks/ (${violations.length} hit${violations.length === 1 ? '' : 's'}):\n${msg}`,
      );
    }
  });

  it('R-006: BANNED_RULES is non-empty and every rule has a unique id', () => {
    expect(BANNED_RULES.length).toBeGreaterThan(0);
    const ids = BANNED_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
