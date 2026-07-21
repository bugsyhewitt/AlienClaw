/**
 * Parse a .martian YAML file into a MartianSpec.
 * Mirrors Python src/alienclaw/martians/parser.py
 *
 * The .martian format is a strict subset of YAML — flat top-level mapping
 * with these keys: martian_type (string), description (string),
 * use_cases (list of strings), slots (list of mappings). Each slot mapping has
 * slot_index (int), tool_name (string), inputs_from (null | {fields: {str:str}}).
 *
 * No anchors, no flow-style except the literal `[]` empty list, no multi-line
 * strings. We implement a minimal indentation-based parser instead of pulling
 * in a full YAML dependency.
 */
import type { InputWiring, MartianSpec, SlotDeclaration } from './types.js';
import { errorMessage } from '../utils.js';

export class MartianParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MartianParseError';
  }
}

// ---------------------------------------------------------------------------
// Minimal YAML parser tailored to the .martian format
// ---------------------------------------------------------------------------

type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

interface Line {
  raw:    string;     // original line (trailing newline stripped)
  indent: number;     // count of leading spaces
  text:   string;     // trimmed content (without leading whitespace)
  lineNo: number;     // 1-based for error messages
}

function _tokenizeLines(content: string): Line[] {
  const out: Line[] = [];
  const rawLines = content.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineNo = i + 1;
    // Skip blank lines and pure-comment lines
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    let indent = 0;
    while (indent < raw.length && raw.charCodeAt(indent) === 0x20) indent++;
    if (indent < raw.length && raw.charCodeAt(indent) === 0x09) {
      throw new MartianParseError(`line ${lineNo}: tabs are not allowed for indentation`);
    }
    out.push({ raw, indent, text: raw.slice(indent), lineNo });
  }
  return out;
}

function _stripQuotes(value: string): string {
  const v = value.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last  = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      // Naive unescape of double-quoted strings: handle \" \\ \n \t.
      const inner = v.slice(1, -1);
      if (first === '"') {
        return inner
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t');
      }
      return inner; // single-quoted: take literal
    }
  }
  return v;
}

function _parseScalar(value: string, lineNo: number): YamlValue {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '~' || trimmed === 'null') return null;
  if (trimmed === 'true')  return true;
  if (trimmed === 'false') return false;
  if (trimmed === '[]')    return [];
  if (trimmed === '{}')    return {};
  // Reject obvious flow-style we don't support (used by parse-error fixtures).
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    if (!(trimmed === '[]' || trimmed === '{}')) {
      throw new MartianParseError(
        `YAML error at line ${lineNo}: flow-style sequences/mappings not supported: ${trimmed}`
      );
    }
  }
  // Integer?
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  return _stripQuotes(trimmed);
}

/**
 * Parse a block of lines starting at index `start` whose indent is >= `baseIndent`.
 * Returns the parsed value and the index of the first line NOT consumed.
 */
function _parseBlock(lines: Line[], start: number, baseIndent: number): [YamlValue, number] {
  if (start >= lines.length || lines[start]!.indent < baseIndent) {
    return [null, start];
  }
  const first = lines[start]!;
  // Sequence: lines starting with "- "
  if (first.text.startsWith('- ') || first.text === '-') {
    return _parseSequence(lines, start, baseIndent);
  }
  // Mapping
  return _parseMapping(lines, start, baseIndent);
}

function _parseMapping(lines: Line[], start: number, baseIndent: number): [Record<string, YamlValue>, number] {
  const obj: Record<string, YamlValue> = {};
  let i = start;
  while (i < lines.length) {
    const ln = lines[i]!;
    if (ln.indent < baseIndent) break;
    if (ln.indent > baseIndent) {
      throw new MartianParseError(
        `YAML error at line ${ln.lineNo}: unexpected indent (got ${ln.indent}, expected ${baseIndent})`
      );
    }
    // Sequence item at mapping level — bail out to caller
    if (ln.text.startsWith('- ') || ln.text === '-') break;

    const colonIdx = _findKeyColon(ln.text);
    if (colonIdx < 0) {
      throw new MartianParseError(
        `YAML error at line ${ln.lineNo}: expected 'key: value' mapping entry, got: ${ln.text}`
      );
    }
    const key = _stripQuotes(ln.text.slice(0, colonIdx).trim());
    const rest = ln.text.slice(colonIdx + 1).trim();
    i++;
    if (rest === '') {
      // Nested block follows at deeper indent
      if (i < lines.length && lines[i]!.indent > baseIndent) {
        const [nested, nextI] = _parseBlock(lines, i, lines[i]!.indent);
        obj[key] = nested;
        i = nextI;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = _parseScalar(rest, ln.lineNo);
    }
  }
  return [obj, i];
}

function _parseSequence(lines: Line[], start: number, baseIndent: number): [YamlValue[], number] {
  const arr: YamlValue[] = [];
  let i = start;
  while (i < lines.length) {
    const ln = lines[i]!;
    if (ln.indent < baseIndent) break;
    if (ln.indent > baseIndent) {
      throw new MartianParseError(
        `YAML error at line ${ln.lineNo}: unexpected indent inside sequence`
      );
    }
    if (!ln.text.startsWith('- ') && ln.text !== '-') break;

    const after = ln.text === '-' ? '' : ln.text.slice(2).trim();
    i++;

    if (after === '') {
      // Block-style item: nested mapping/sequence at deeper indent
      if (i < lines.length && lines[i]!.indent > baseIndent) {
        const [nested, nextI] = _parseBlock(lines, i, lines[i]!.indent);
        arr.push(nested);
        i = nextI;
      } else {
        arr.push(null);
      }
    } else if (_findKeyColon(after) >= 0) {
      // Inline mapping start: "- key: value" — synthesize a sub-mapping.
      // The first key/value comes from this line; subsequent keys are
      // continuation lines indented past the dash.
      const synthIndent = ln.indent + 2;
      const synthLines: Line[] = [{
        raw:    ' '.repeat(synthIndent) + after,
        indent: synthIndent,
        text:   after,
        lineNo: ln.lineNo,
      }];
      while (i < lines.length && lines[i]!.indent > baseIndent) {
        synthLines.push(lines[i]!);
        i++;
      }
      const [nested, _consumed] = _parseMapping(synthLines, 0, synthIndent);
      arr.push(nested);
    } else {
      arr.push(_parseScalar(after, ln.lineNo));
    }
  }
  return [arr, i];
}

/**
 * Find the colon that separates key from value, ignoring colons inside
 * quoted strings. Returns -1 if no colon is found.
 */
function _findKeyColon(text: string): number {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && inDouble) { i++; continue; }
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === ':' && !inDouble && !inSingle) {
      // Must be followed by space or end-of-string to be a key colon.
      if (i + 1 === text.length || text[i + 1] === ' ') return i;
    }
  }
  return -1;
}

function _parseYaml(content: string): YamlValue {
  const lines = _tokenizeLines(content);
  if (lines.length === 0) return null;
  const baseIndent = lines[0]!.indent;
  const [value, end] = _parseBlock(lines, 0, baseIndent);
  if (end < lines.length) {
    throw new MartianParseError(
      `YAML error at line ${lines[end]!.lineNo}: unexpected content after document end`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// MartianSpec construction
// ---------------------------------------------------------------------------

function _isPlainObject(v: unknown): v is Record<string, YamlValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseMartian(content: string, sourcePath = '<string>'): MartianSpec {
  let raw: YamlValue;
  try {
    raw = _parseYaml(content);
  } catch (exc) {
    if (exc instanceof MartianParseError) {
      throw new MartianParseError(`YAML error in ${sourcePath}: ${exc.message}`);
    }
    throw new MartianParseError(`YAML error in ${sourcePath}: ${errorMessage(exc)}`);
  }

  if (!_isPlainObject(raw)) {
    throw new MartianParseError(`${sourcePath}: top-level must be a YAML mapping`);
  }

  for (const req of ['martian_type', 'slots'] as const) {
    if (!(req in raw)) {
      throw new MartianParseError(`${sourcePath}: missing required field '${req}'`);
    }
  }

  const martianType = String(raw['martian_type']);
  const description = raw['description'] !== undefined && raw['description'] !== null
    ? String(raw['description'])
    : '';
  const useCasesRaw = raw['use_cases'];
  const useCases: string[] = Array.isArray(useCasesRaw)
    ? useCasesRaw.map(u => String(u))
    : [];

  const rawSlots = raw['slots'];
  if (!Array.isArray(rawSlots) || rawSlots.length === 0) {
    throw new MartianParseError(`${sourcePath}: 'slots' must be a non-empty list`);
  }

  const slots: SlotDeclaration[] = [];
  for (let i = 0; i < rawSlots.length; i++) {
    const slotRaw = rawSlots[i];
    if (!_isPlainObject(slotRaw)) {
      throw new MartianParseError(`${sourcePath}: slot ${i} must be a mapping`);
    }
    for (const req of ['slot_index', 'tool_name'] as const) {
      if (!(req in slotRaw)) {
        throw new MartianParseError(`${sourcePath}: slot ${i} missing '${req}'`);
      }
    }
    const slotIndex = typeof slotRaw['slot_index'] === 'number'
      ? slotRaw['slot_index']
      : parseInt(String(slotRaw['slot_index']), 10);
    const toolName  = String(slotRaw['tool_name']);

    const rawInputs = slotRaw['inputs_from'] ?? null;
    let inputsFrom: InputWiring | null;
    if (rawInputs === null || rawInputs === undefined) {
      inputsFrom = null;
    } else if (_isPlainObject(rawInputs) && 'fields' in rawInputs) {
      const rawFields = rawInputs['fields'];
      const fields: Record<string, string> = {};
      if (_isPlainObject(rawFields)) {
        for (const [k, v] of Object.entries(rawFields)) {
          fields[String(k)] = String(v);
        }
      }
      inputsFrom = { fields };
    } else {
      throw new MartianParseError(
        `${sourcePath}: slot ${i} inputs_from must be null or have 'fields' mapping`
      );
    }

    slots.push({ slotIndex, toolName, inputsFrom });
  }

  return { martianType, slots, description, useCases };
}
