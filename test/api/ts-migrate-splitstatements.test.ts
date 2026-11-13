import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { splitStatements, runMigrations } from '../../src/alienclaw/api/migrate.js';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');
const VALID_KEYWORD =
  /^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|SET|BEGIN|COMMIT|ROLLBACK|TRUNCATE|GRANT|REVOKE|REPLACE)$/i;

function offendersFor(sql: string): string[] {
  const out: string[] = [];
  const stmts = splitStatements(sql);
  for (let i = 0; i < stmts.length; i++) {
    const first = (stmts[i].split('\n').find(l => l.trim() && !l.trim().startsWith('--')) ?? '').trim();
    if (!first) continue;
    if (!VALID_KEYWORD.test(first.split(/\s+/)[0])) out.push(`stmt[${i}]: ${first.slice(0, 80)}`);
  }
  return out;
}

/**
 * A minimal PoolConnection stand-in that RECORDS every statement the runner
 * hands to the server. It exercises the REAL `runMigrations` product path —
 * not a local copy of the splitting logic.
 */
function recordingPool(): { pool: never; emitted: string[] } {
  const emitted: string[] = [];
  const conn = {
    query: async (sql: unknown): Promise<never> => {
      const text = String(sql);
      emitted.push(text);
      // Bootstrap + bookkeeping queries are irrelevant to the assertions.
      if (/GET_LOCK|RELEASE_LOCK|schema_migrations/i.test(text)) {
        return [[{ ok: 1 }], []] as never;
      }
      return [[], []] as never;
    },
    release: () => { /* no-op */ },
  };
  const pool = { getConnection: async () => conn } as never;
  return { pool, emitted };
}

describe('PKT-1441 migrate.ts splitStatements — comment-aware splitting', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

  it('R-1441-1: repo ships the migration files under test', () => {
    expect(files).toContain('003_graph_evolution.sql');
    expect(files).toContain('004_verified_fitness.sql');
  });

  for (const f of files) {
    it(`R-1441-2 ${f}: every produced statement starts with a valid SQL keyword`, () => {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      expect(offendersFor(sql), `splitStatements produced invalid SQL in ${f}`).toEqual([]);
    });
  }

  it('R-1441-3: a `;` inside a -- line comment does not create a statement boundary', () => {
    const sql = [
      '-- a leading comment; with a semicolon',
      'CREATE TABLE t (id INT);',
      '-- trailing comment; also semicolon',
    ].join('\n');
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^CREATE TABLE t \(id INT\)$/);
  });

  it('R-1441-4: a `;` inside a /* block */ comment does not create a statement boundary', () => {
    const sql = '/* block comment with ; inside */\nCREATE TABLE t (id INT);';
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^CREATE TABLE t \(id INT\)$/);
  });

  it('R-1441-5: real statements are still split on their own semicolons', () => {
    const sql = 'CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);\n';
    expect(splitStatements(sql)).toEqual(['CREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)']);
  });

  it('R-1441-6: 003 + 004 are the files the defect actually affected', () => {
    const bad = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql')).sort()
      .filter(f => splitStatements(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
        .some(s => /^(re_graph_violation|migrations run|this targets)/.test(s)));
    expect(bad).toEqual([]);
  });

  // ── Product-level gate: drive the REAL runMigrations, not a local helper ──
  // This is the arm that PKT-1170's own gate required and that PKT-1170 FAILED
  // to ship: the block-comment regex it shipped (`/\*[\s\S]*?\*\//g`, no leading
  // `\/`) leaves the opening `/` glued to the next statement. Against the real
  // runner that yields the garbage statement "/\nCREATE TABLE baz (id INT)".
  it('R-1441-7: runMigrations emits a CLEAN statement for a block-commented migration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alienclaw-mig-'));
    writeFileSync(
      join(dir, '900_blk.sql'),
      '/* block comment with ; inside */\nCREATE TABLE baz (id INT);\n',
    );
    const { pool, emitted } = recordingPool();
    const prev = process.env['ALIENCLAW_RUN_MIGRATIONS'];
    process.env['ALIENCLAW_RUN_MIGRATIONS'] = '1';
    try {
      await runMigrations(pool, dir);
    } finally {
      if (prev === undefined) delete process.env['ALIENCLAW_RUN_MIGRATIONS'];
      else process.env['ALIENCLAW_RUN_MIGRATIONS'] = prev;
    }
    const ddl = emitted.filter(s => /CREATE TABLE baz/.test(s));
    expect(ddl).toHaveLength(1);
    // Anchored: the statement must START with CREATE — a stray leading "/"
    // (the PKT-1170 shipped-regex bug) fails this assertion.
    expect(ddl[0]).toMatch(/^CREATE TABLE baz \(id INT\)$/);
  });

  it('R-1441-8: runMigrations emits a CLEAN statement for a line-commented migration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alienclaw-mig-'));
    writeFileSync(
      join(dir, '901_line.sql'),
      '-- FK order: a → b; c standalone.\nCREATE TABLE qux (id INT);\n',
    );
    const { pool, emitted } = recordingPool();
    const prev = process.env['ALIENCLAW_RUN_MIGRATIONS'];
    process.env['ALIENCLAW_RUN_MIGRATIONS'] = '1';
    try {
      await runMigrations(pool, dir);
    } finally {
      if (prev === undefined) delete process.env['ALIENCLAW_RUN_MIGRATIONS'];
      else process.env['ALIENCLAW_RUN_MIGRATIONS'] = prev;
    }
    const ddl = emitted.filter(s => /CREATE TABLE qux/.test(s));
    expect(ddl).toHaveLength(1);
    expect(ddl[0]).toMatch(/^CREATE TABLE qux \(id INT\)$/);
  });
});
