/**
 * tool-adapters.ts
 * Registers OpenClaw tool functions as Martian tool adapters.
 *
 * Call wireToolAdapters() once during bootstrap AFTER registry.load().
 *
 * Each adapter:
 *   1. Accepts a flat Record<string,unknown> from the Martian executor
 *   2. Delegates to the correct OpenClaw tool implementation
 *   3. Returns output matching the .msb OUTPUT CONTRACT
 *
 * File paths are scoped to ALIENCLAW_HOME/workspace/ for safety.
 */

import * as fsPromises  from 'node:fs/promises';
import * as path from 'node:path';

import { registerToolAdapter } from './martian-executor.js';
import type { ToolFn }         from './martian-executor.js';
import { PATHS }               from '../constants.js';

const OUTPUT_DIR = PATHS.output;

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

let _webSearchFn: ((arg: unknown) => Promise<unknown>) | undefined;

const webSearchAdapter: ToolFn = async (input) => {
  const query = String(
    input['query'] ?? input['task'] ?? ''
  ).trim().slice(0, 500);

  if (!query) throw new Error('web_search: query is empty');

  // Resolve and cache the OpenClaw tool fn on first call
  if (!_webSearchFn) {
    try {
      const mod = await import('../../agents/tools/web-search.js') as Record<string, unknown>;
      _webSearchFn = (mod['webSearch'] ?? mod['default']) as ((arg: unknown) => Promise<unknown>) | undefined;
    } catch {
      // Tool unavailable — leave _webSearchFn undefined
    }
  }

  if (typeof _webSearchFn === 'function') {
    const results = await _webSearchFn({ query });
    return { query, results };
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

let _webFetchFn: ((arg: unknown) => Promise<unknown>) | undefined;

const urlFetchAdapter: ToolFn = async (input) => {
  const url = String(input['url'] ?? '');
  if (!url.startsWith('https://')) {
    throw new Error(`url_fetch: URL must use https, got "${url}"`);
  }

  if (!_webFetchFn) {
    try {
      const mod = await import('../../agents/tools/web-fetch.js') as Record<string, unknown>;
      _webFetchFn = (mod['webFetch'] ?? mod['default']) as ((arg: unknown) => Promise<unknown>) | undefined;
    } catch {
      // Tool unavailable
    }
  }

  if (typeof _webFetchFn === 'function') {
    const content = await _webFetchFn({ url });
    return { url, statusCode: 200, content: String(content ?? ''), contentType: 'text/html' };
  }

  return { url, statusCode: 0, content: '', _stub: true };
};

// ---------------------------------------------------------------------------
// file_read
// ---------------------------------------------------------------------------

const fileReadAdapter: ToolFn = async (input) => {
  const rawPath  = String(input['path'] ?? input['task'] ?? '');
  const resolved = assertInsideBoundary(rawPath, PATHS.workspace);

  let contents: string;
  try {
    contents = await fsPromises.readFile(resolved, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`file_read: not found: ${resolved}`);
    }
    throw err;
  }

  const MAX = 10 * 1024 * 1024;
  const sizeBytes = Buffer.byteLength(contents, 'utf-8');
  if (sizeBytes > MAX) {
    throw new Error(`file_read: file too large (${sizeBytes} bytes, limit ${MAX})`);
  }

  return { path: rawPath, contents, sizeBytes };
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
  await fsPromises.mkdir(path.dirname(resolved), { recursive: true });

  let created = false;
  try {
    await fsPromises.writeFile(resolved, content, 'utf-8');
    created = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    await fsPromises.writeFile(resolved, content, 'utf-8');
  }

  const sizeBytes = Buffer.byteLength(content, 'utf-8');
  return { path: rawPath, sizeBytes, created };
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
