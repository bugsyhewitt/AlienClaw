/**
 * HermesToolResolver — Hermes host tool resolution.
 *
 * Structural counterpart of msb/openclaw-tool-resolver.ts. LOGICAL_TOOLS is the
 * full logical tool set (src/alienclaw/tools/*.py). Host-agnostic tools resolve
 * through the shared executor registry (getToolAdapter); the only host-bound tool
 * (web_search) dispatches to Hermes' tool layer.
 *
 * web_search dispatch (grounded in hermes-agent v0.15.2): spawns the Hermes venv
 * python (ALIENCLAW_HERMES_PYTHON) and calls
 * `model_tools.handle_function_call('web_search', args)` — validated: it runs
 * headlessly (all session params default None) and returns a JSON string. Hermes
 * surfaces failures as `{"error": "..."}`, which we raise as a tool error. A
 * SUCCESSFUL search requires Hermes to have a web backend configured (a
 * `web.backend` + its key, or the `ddgs` package) — an operator prerequisite, not
 * AlienClaw's concern. See docs/hermes-phase2-spec.md.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolFn, ToolResolver } from '../../msb/martian-executor.js';
import { getToolAdapter } from '../../msb/martian-executor.js';

const execFileAsync = promisify(execFile);

/** The frozen logical tool contract both host resolvers must satisfy exactly. */
export const LOGICAL_TOOLS = [
  'compute',
  'web_search',
  'url_fetch',
  'file_read',
  'file_write',
  'http_get',
  'search_text',
  'extract_json',
] as const;

/** Tools that must be resolved against the host's native tool layer. */
const HOST_BOUND: ReadonlySet<string> = new Set(['web_search']);

// Writes ONLY the handle_function_call result (a JSON string) to stdout; Hermes'
// own diagnostics go to stderr. args arrive as a single JSON argv element.
const DISPATCH_PY =
  'import json,sys;from model_tools import handle_function_call;' +
  "sys.stdout.write(handle_function_call('web_search', json.loads(sys.argv[1])))";

/** Dispatch web_search to Hermes' tool registry via the Hermes venv python. */
const hermesWebSearch: ToolFn = async (input: Record<string, unknown>): Promise<unknown> => {
  const pybin = process.env['ALIENCLAW_HERMES_PYTHON'];
  if (!pybin) {
    throw new Error(
      'web_search: set ALIENCLAW_HERMES_PYTHON to the Hermes venv python ' +
        '(e.g. ~/.local/share/pipx/venvs/hermes-agent/bin/python)',
    );
  }
  const query = input['query'];
  if (typeof query !== 'string' || query.length === 0) {
    throw new Error('web_search: requires a non-empty "query" string');
  }

  let stdout: string;
  try {
    // Non-shell spawn; args passed as literal argv (no shell interpolation of the query).
    ({ stdout } = await execFileAsync(pybin, ['-c', DISPATCH_PY, JSON.stringify(input)], {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (e) {
    throw new Error(`web_search: Hermes dispatch failed: ${(e as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`web_search: Hermes returned non-JSON output: ${stdout.slice(0, 200)}`);
  }
  if (parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)) {
    throw new Error(`web_search: ${String((parsed as Record<string, unknown>)['error'])}`);
  }
  return parsed;
};

export class HermesToolResolver implements ToolResolver {
  resolve(toolName: string): ToolFn | undefined {
    if (toolName === 'web_search') return hermesWebSearch;
    if (HOST_BOUND.has(toolName)) return undefined; // no other host-bound tools yet
    // Host-agnostic tools are shared across hosts — delegate to the executor's
    // adapter registry rather than reimplementing them.
    return getToolAdapter(toolName);
  }

  supportedTools(): string[] {
    return [...LOGICAL_TOOLS];
  }
}
