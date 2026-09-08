/**
 * Unit tests for the health handler's build-info and version readers.
 *
 * These tests use fixtures written to tmp dirs — no real repo-root files are
 * touched and no database is required. The readers are exported functions so
 * they can be driven directly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readBuildInfo, readVersion } from '../../src/alienclaw/api/handlers/health.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'aclaw-health-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length) {
    try { rmSync(tmpDirs.pop()!, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── readBuildInfo ─────────────────────────────────────────────────────────────

describe('readBuildInfo', () => {
  it('parses a valid build-info.json fixture', () => {
    const dir = makeTmp();
    const p   = join(dir, 'build-info.json');
    writeFileSync(p, JSON.stringify({ sha: 'abc123', builtAt: '2026-09-08T21:00:00Z' }), 'utf8');

    const info = readBuildInfo(p);
    expect(info.sha).toBe('abc123');
    expect(info.builtAt).toBe('2026-09-08T21:00:00Z');
  });

  it('returns {} when the file does not exist', () => {
    const info = readBuildInfo('/nonexistent/path/build-info.json');
    expect(info).toEqual({});
  });

  it('returns {} when the file contains invalid JSON', () => {
    const dir = makeTmp();
    const p   = join(dir, 'build-info.json');
    writeFileSync(p, 'not json', 'utf8');

    const info = readBuildInfo(p);
    expect(info).toEqual({});
  });

  it('returns partial fields when only sha is present', () => {
    const dir = makeTmp();
    const p   = join(dir, 'build-info.json');
    writeFileSync(p, JSON.stringify({ sha: 'deadbeef' }), 'utf8');

    const info = readBuildInfo(p);
    expect(info.sha).toBe('deadbeef');
    expect(info.builtAt).toBeUndefined();
  });

  it('health fallback: sha defaults to "unknown" when build-info missing', () => {
    const info = readBuildInfo('/nonexistent/build-info.json');
    const sha = info.sha ?? 'unknown';
    expect(sha).toBe('unknown');
  });
});

// ── readVersion ───────────────────────────────────────────────────────────────

describe('readVersion', () => {
  it('reads version from a fixture package.json', () => {
    const dir = makeTmp();
    const p   = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ name: 'alienclaw', version: '2026.4.10' }), 'utf8');

    expect(readVersion(p)).toBe('2026.4.10');
  });

  it('returns "unknown" when the file does not exist', () => {
    expect(readVersion('/nonexistent/package.json')).toBe('unknown');
  });

  it('returns "unknown" when package.json has no version field', () => {
    const dir = makeTmp();
    const p   = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ name: 'alienclaw' }), 'utf8');

    expect(readVersion(p)).toBe('unknown');
  });

  it('returns "unknown" when the file is malformed JSON', () => {
    const dir = makeTmp();
    const p   = join(dir, 'package.json');
    writeFileSync(p, 'oops', 'utf8');

    expect(readVersion(p)).toBe('unknown');
  });

  it('the real repo package.json version matches the expected pattern', () => {
    // This exercises the auto-discovery path (no override) — it should find
    // the real package.json relative to the module's location.
    const version = readVersion();
    // Pattern: YYYY.M.P (calendar version, e.g. 2026.4.10)
    expect(version).toMatch(/^\d{4}\.\d+\.\d+$/);
  });
});
