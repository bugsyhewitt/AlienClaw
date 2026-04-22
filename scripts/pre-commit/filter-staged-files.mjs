#!/usr/bin/env node
// Reads NUL-delimited filenames from stdin, writes back the subset
// appropriate for the given operation (lint|format).
// Usage: printf '%s\0' file1 file2 | node filter-staged-files.mjs <lint|format>

const LINT_EXTS   = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const FORMAT_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json']);

const op = process.argv[2];
if (op !== 'lint' && op !== 'format') {
  process.stderr.write('Usage: filter-staged-files.mjs <lint|format>\n');
  process.exit(1);
}

const exts = op === 'lint' ? LINT_EXTS : FORMAT_EXTS;

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { buffer += chunk; });
process.stdin.on('end', () => {
  const files = buffer.split('\0').filter(Boolean);
  const filtered = files.filter(f => {
    const dot = f.lastIndexOf('.');
    return dot !== -1 && exts.has(f.slice(dot));
  });
  if (filtered.length > 0) process.stdout.write(filtered.join('\0') + '\0');
});
