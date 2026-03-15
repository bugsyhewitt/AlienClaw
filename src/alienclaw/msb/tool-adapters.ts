/**
 * tool-adapters.ts
 * Registers OpenClaw tool functions as Meeseeks tool adapters.
 *
 * Call wireToolAdapters() once during bootstrap AFTER registry.load().
 *
 * Each adapter:
 *   1. Accepts a flat Record<string,unknown> from the Meeseeks executor
 *   2. Delegates to the correct OpenClaw tool implementation
 *   3. Returns output matching the .msb OUTPUT CONTRACT
 *
 * File paths are scoped to ALIENCLAW_HOME/workspace/ for safety.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as os   from 'node:os';

import { registerToolAdapter } from './meeseeks-executor.js';
import type { ToolFn }         from './meeseeks-executor.js';

const HOME       = process.env['ALIENCLAW_HOME'] ?? path.join(os.homedir(), '.alienclaw');
const WORKSPACE  = path.join(HOME, 'workspace');
const OUTPUT_DIR = path.join(WORKSPACE, 'output');

// ---------------------------------------------------------------------------
// Path safety guard
// ---------------------------------------------------------------------------

function assertInsideBoundary(filePath: string, boundary: string): string {
  const resolved = path.resolve(boundary, filePath);
  const sep      = path.sep;
  if (!resolved.startsWith(boundary + sep) && resolved !== boundary) {
    throw new Error(
      `Path traversal rejected: "${filePath}" resolves outside boundary "${boundary}"`
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// web_search
// Dynamic import of OpenClaw tool so this module compiles without hard dep.
// ---------------------------------------------------------------------------

const webSearchAdapter: ToolFn = async (input) => {
  const query = String(
    input['query'] ?? input['task'] ?? ''
  ).trim().slice(0, 500);

  if (!query) throw new Error('web_search: query is empty');

  try {
    // OpenClaw tool — path relative to compiled output
    const mod = await import('../../agents/tools/web-search.js') as Record<string, unknown>;
    const fn  = (mod['webSearch'] ?? mod['default']) as ((arg: unknown) => Promise<unknown>) | undefined;
    if (typeof fn === 'function') {
      const results = await fn({ query });
      return { query, results };
    }
  } catch {
    // Tool unavailable in this environment — return typed stub
  }

  return {
    query,
    results: [],
    _stub: true,
    _note: 'web_search adapter not wired to OpenClaw tool. Register during wiring.',
  };
};

// ---------------------------------------------------------------------------
// url_fetch
// ---------------------------------------------------------------------------

const urlFetchAdapter: ToolFn = async (input) => {
  const url = String(input['url'] ?? '');
  if (!url.startsWith('https://')) {
    throw new Error(`url_fetch: URL must use https, got "${url}"`);
  }

  try {
    const mod = await import('../../agents/tools/web-fetch.js') as Record<string, unknown>;
    const fn  = (mod['webFetch'] ?? mod['default']) as ((arg: unknown) => Promise<unknown>) | undefined;
    if (typeof fn === 'function') {
      const content = await fn({ url });
      return { url, statusCode: 200, content: String(content ?? ''), contentType: 'text/html' };
    }
  } catch {
    // stub
  }

  return { url, statusCode: 0, content: '', _stub: true };
};

// ---------------------------------------------------------------------------
// file_read
// ---------------------------------------------------------------------------

const fileReadAdapter: ToolFn = async (input) => {
  const rawPath  = String(input['path'] ?? input['task'] ?? '');
  const resolved = assertInsideBoundary(rawPath, WORKSPACE);

  if (!fs.existsSync(resolved)) {
    throw new Error(`file_read: not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  const MAX  = 10 * 1024 * 1024;
  if (stat.size > MAX) {
    throw new Error(`file_read: file too large (${stat.size} bytes, limit ${MAX})`);
  }

  const contents = fs.readFileSync(resolved, 'utf-8');
  return { path: rawPath, contents, sizeBytes: stat.size };
};

// ---------------------------------------------------------------------------
// file_write
// ---------------------------------------------------------------------------

const fileWriteAdapter: ToolFn = async (input) => {
  const rawPath = String(input['path'] ?? '');
  const content = typeof input['content'] === 'string'
    ? input['content']
    : JSON.stringify(input['content'] ?? '');

  const resolved = assertInsideBoundary(rawPath, OUTPUT_DIR);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const existed   = fs.existsSync(resolved);
  fs.writeFileSync(resolved, content, 'utf-8');
  const sizeBytes = Buffer.byteLength(content, 'utf-8');

  return { path: rawPath, sizeBytes, created: !existed };
};

// ---------------------------------------------------------------------------
// Wire all adapters — call once from hierarchy-bootstrap.ts
// ---------------------------------------------------------------------------

let _wired = false;

export function wireToolAdapters(): void {
  if (_wired) return;
  registerToolAdapter('web_search', webSearchAdapter);
  registerToolAdapter('url_fetch',  urlFetchAdapter);
  registerToolAdapter('file_read',  fileReadAdapter);
  registerToolAdapter('file_write', fileWriteAdapter);
  _wired = true;
}
