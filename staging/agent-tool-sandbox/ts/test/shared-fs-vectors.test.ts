/**
 * Shared filesystem-jail vectors: every vector's recorded TS verdict.
 *
 * The corpus (../../vectors/fs-vectors.json) is shared with the Python package
 * (python/tests/test_shared_fs_vectors.py runs the same vectors against
 * agent_tool_sandbox.boundary). It RECORDS observed behaviour per language;
 * expected.python must equal expected.ts unless the vector carries a
 * `divergence` note, so parity is enforced by data.
 *
 * Harness (identical to the Python test; change both together). Each vector gets
 * a fresh fs.mkdtemp directory (realpath'd, the {base}), the named layout is
 * built in it, and one operation runs:
 *   op "boundary": assertInsideBoundary(input, root, { denyRoots })
 *   op "read":  readFileJailed(input, root, { denyRoots, maxBytes })
 *   op "write": writeFileJailed(input, data, root, { denyRoots, createParents: true })
 * "deny" = BoundaryError (its code is the reason); "allow" = the operation
 * completed, reported as the base-relative resolved path. Any other error
 * fails. After every write vector nothing outside the root has changed; after a
 * deny, nothing has.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BoundaryError,
  assertInsideBoundary,
  readFileJailed,
  writeFileJailed,
  type BoundaryErrorCode,
} from '../src/fs-jail.js';

type Op = 'boundary' | 'read' | 'write';
type Outcome =
  | { verdict: 'allow'; resolved: string }
  | { verdict: 'deny'; reason: BoundaryErrorCode };

interface LayoutEntry {
  path: string;
  type: 'file' | 'dir' | 'symlink';
  content?: string;
  target?: string;
}

interface FsVector {
  id: string;
  category: string;
  layout: string;
  op: Op;
  root: string;
  deny_roots?: string[];
  input: string;
  expected: { python: Outcome; ts: Outcome };
  divergence?: string;
  rationale: string;
}

const corpus = JSON.parse(
  readFileSync(new URL('../../vectors/fs-vectors.json', import.meta.url), 'utf8'),
) as { schema_version: number; layouts: Record<string, LayoutEntry[]>; vectors: FsVector[] };

const OPS = new Set<Op>(['boundary', 'read', 'write']);
const REASONS = new Set<BoundaryErrorCode>([
  'DOTFILE',
  'TRAVERSAL',
  'DENIED_ROOT',
  'SYMLINK',
  'SYMLINK_IN_PATH',
  'UNINSPECTABLE',
  'INVALID_PATH',
  'NOT_A_FILE',
  'TOO_LARGE',
]);
const ID_RE = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;

function expand(text: string, base: string, root: string): string {
  return text.replaceAll('{root}', root).replaceAll('{base}', base);
}

async function build(layout: LayoutEntry[], base: string, root: string): Promise<void> {
  for (const entry of layout) {
    const p = path.join(base, entry.path);
    await fs.mkdir(path.dirname(p), { recursive: true });
    if (entry.type === 'dir') await fs.mkdir(p, { recursive: true });
    else if (entry.type === 'file') await fs.writeFile(p, entry.content ?? '', 'utf8');
    else if (entry.type === 'symlink') await fs.symlink(expand(entry.target!, base, root), p);
    else throw new Error(`unknown layout type ${String(entry.type)}`);
  }
}

/** Every entry under base, without following symlinks. */
async function snapshot(base: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      const rel = path.relative(base, p);
      if (entry.isSymbolicLink()) out.set(rel, `link:${await fs.readlink(p)}`);
      else if (entry.isDirectory()) {
        out.set(rel, 'dir');
        await walk(p);
      } else out.set(rel, `file:${(await fs.readFile(p)).toString('hex')}`);
    }
  }
  await walk(base);
  return out;
}

function outside(snap: Map<string, string>, rootRel: string): Map<string, string> {
  return new Map(
    [...snap].filter(([k]) => k !== rootRel && !k.startsWith(`${rootRel}/`)),
  );
}

const writeData = (id: string): string => `written by fs vector ${id}\n`;

async function run(vec: FsVector, base: string): Promise<Outcome> {
  const root = path.join(base, vec.root);
  const denyRoots = (vec.deny_roots ?? []).map((d) => path.join(base, d));
  const input = expand(vec.input, base, root);
  try {
    let resolved: string;
    if (vec.op === 'boundary') {
      resolved = await assertInsideBoundary(input, root, { denyRoots });
    } else if (vec.op === 'read') {
      const data = await readFileJailed(input, root, { denyRoots, maxBytes: 1 << 20 });
      resolved = await assertInsideBoundary(input, root, { denyRoots });
      expect(data.equals(await fs.readFile(resolved))).toBe(true);
    } else if (vec.op === 'write') {
      resolved = await writeFileJailed(input, writeData(vec.id), root, {
        denyRoots,
        createParents: true,
      });
    } else {
      throw new Error(`unknown op ${String(vec.op)}`);
    }
    return { verdict: 'allow', resolved: path.relative(base, resolved) };
  } catch (err) {
    if (err instanceof BoundaryError) return { verdict: 'deny', reason: err.code };
    throw err;
  }
}

// ── corpus shape ─────────────────────────────────────────────────────────────

describe('fs vector corpus', () => {
  it('is loaded', () => {
    expect(corpus.schema_version).toBe(1);
    expect(corpus.vectors.length).toBeGreaterThanOrEqual(100);
  });

  it('has unique, well-formed ids', () => {
    const ids = corpus.vectors.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(ID_RE);
  });

  it('has well-formed vectors', () => {
    for (const vec of corpus.vectors) {
      expect(corpus.layouts[vec.layout], vec.id).toBeDefined();
      expect(OPS.has(vec.op), vec.id).toBe(true);
      expect(typeof vec.input, vec.id).toBe('string');
      expect(vec.rationale, vec.id).toBeTruthy();
      for (const side of ['python', 'ts'] as const) {
        const exp = vec.expected[side];
        if (exp.verdict === 'deny') {
          expect(Object.keys(exp).sort(), vec.id).toEqual(['reason', 'verdict']);
          expect(REASONS.has(exp.reason), vec.id).toBe(true);
        } else {
          expect(exp.verdict, vec.id).toBe('allow');
          expect(Object.keys(exp).sort(), vec.id).toEqual(['resolved', 'verdict']);
        }
      }
    }
  });

  it('declares every python != ts difference, and only real ones', () => {
    for (const vec of corpus.vectors) {
      const same = JSON.stringify(vec.expected.python) === JSON.stringify(vec.expected.ts);
      if (vec.divergence !== undefined) {
        expect(vec.divergence.trim(), vec.id).not.toBe('');
        expect(same, vec.id).toBe(false);
      } else {
        expect(same, vec.id).toBe(true);
      }
    }
  });

  it('has no layout entry named .env*', () => {
    for (const layout of Object.values(corpus.layouts)) {
      for (const entry of layout) {
        expect(entry.path.split('/').some((part) => part.startsWith('.env'))).toBe(false);
      }
    }
  });
});

// ── the vectors ──────────────────────────────────────────────────────────────

describe.skipIf(process.platform === 'win32')('shared fs vectors', () => {
  it.each(corpus.vectors.map((v) => [v.id, v] as const))('%s', async (_id, vec) => {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fs-vectors-')));
    try {
      const root = path.join(base, vec.root);
      await build(corpus.layouts[vec.layout]!, base, root);
      const before = await snapshot(base);

      const observed = await run(vec, base);
      expect(observed).toEqual(vec.expected.ts);

      const after = await snapshot(base);
      if (vec.op === 'write') {
        expect(outside(after, vec.root)).toEqual(outside(before, vec.root));
        if (observed.verdict === 'allow') {
          expect(await fs.readFile(path.join(base, observed.resolved), 'utf8')).toBe(
            writeData(vec.id),
          );
        }
      }
      if (observed.verdict === 'deny') expect(after).toEqual(before);
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});
