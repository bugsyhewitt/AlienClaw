/**
 * AlienClaw — OpenClaw Tool Resolver
 *
 * Maps logical tool names (from .ms files) to actual OpenClaw tool functions.
 * This is the ONLY place in AlienClaw that touches OpenClaw's tool layer directly.
 *
 * Employees NEVER call tools directly. They go through:
 *   Employee → MeeseeksExecutor → OpenClawToolResolver → OpenClaw tool fn
 */

import type { ToolFn, ToolResolver } from './meeseeks-executor.js';

// ---------------------------------------------------------------------------
// Shim types for OpenClaw tools
// We import dynamically to avoid hard coupling until OpenClaw is fully built.
// ---------------------------------------------------------------------------

type WebSearchArgs = {
  query: string;
  maxResults?: number;
};

type FileReadArgs = {
  path: string;
  encoding?: string;
};

type FileWriteArgs = {
  path: string;
  content: string;
  encoding?: string;
};

// ---------------------------------------------------------------------------
// Tool wrappers
// ---------------------------------------------------------------------------

/**
 * Wraps OpenClaw's web-search tool.
 * Lazy-imports to avoid circular deps with the OpenClaw build graph.
 */
async function webSearch(args: Record<string, unknown>): Promise<unknown> {
  const { query, maxResults = 10 } = args as WebSearchArgs;
  if (!query || typeof query !== 'string') {
    throw new Error('web_search requires a "query" string argument');
  }

  // Dynamic import of OpenClaw's web-search tool
  // Path assumes we're running from the compiled alienclaw root
  // Dynamic import — cast to unknown so we're not bound to the module's static type.
  // The actual export shape may vary across OpenClaw versions.
  const mod = await import('../../agents/tools/web-search.js').catch(() => {
    throw new Error(
      'web-search tool not available — ensure OpenClaw is built and src/agents/tools/web-search.ts is compiled'
    );
  }) as unknown as Record<string, unknown>;

  // Walk known export names in priority order
  const fn =
    (mod['runWebSearch'] as ToolFn | undefined) ??
    (mod['webSearch']    as ToolFn | undefined) ??
    ((mod['default'] as Record<string, unknown> | undefined)?.['execute'] as ToolFn | undefined) ??
    (mod['default']      as ToolFn | undefined);

  if (typeof fn !== 'function') {
    throw new Error('web-search module did not export a callable function');
  }

  return fn({ query, maxResults });
}

/**
 * Wraps a file-read tool.
 * OpenClaw doesn't ship a dedicated file-read.ts (it uses Node fs directly),
 * so we implement it here with the same safety constraints.
 */
async function fileRead(args: Record<string, unknown>): Promise<unknown> {
  const { path: filePath, encoding = 'utf-8' } = args as FileReadArgs;
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('file_read requires a "path" string argument');
  }

  const fs = await import('node:fs/promises');
  const content = await fs.readFile(filePath, encoding as BufferEncoding);
  return { path: filePath, content, encoding };
}

/**
 * Wraps a file-write tool.
 */
async function fileWrite(args: Record<string, unknown>): Promise<unknown> {
  const { path: filePath, content, encoding = 'utf-8' } = args as FileWriteArgs;
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('file_write requires a "path" string argument');
  }
  if (typeof content !== 'string') {
    throw new Error('file_write requires a "content" string argument');
  }

  const fs = await import('node:fs/promises');
  const nodePath = await import('node:path');

  // Ensure parent directory exists
  await fs.mkdir(nodePath.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, encoding as BufferEncoding);
  return { path: filePath, bytesWritten: Buffer.byteLength(content, encoding as BufferEncoding) };
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

const TOOL_MAP: Record<string, ToolFn> = {
  web_search: webSearch,
  file_read:  fileRead,
  file_write: fileWrite,
};

export class OpenClawToolResolver implements ToolResolver {
  resolve(toolName: string): ToolFn | undefined {
    return TOOL_MAP[toolName];
  }

  /** All tool names this resolver supports */
  supportedTools(): string[] {
    return Object.keys(TOOL_MAP);
  }
}
