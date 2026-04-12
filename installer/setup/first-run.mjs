#!/usr/bin/env node
/**
 * first-run.mjs
 * AlienClaw first-run configuration wizard.
 * Called from install.sh after the ASCII art animation.
 *
 * Zero external dependencies — plain Node.js ESM.
 *
 * Step 1: Ensure ~/.alienclaw/ directories exist
 * Step 2: Evolution network opt-in
 * Step 3: Write preferences.json
 *
 * (Agent souls and openclaw.json are written by install.sh — not here.)
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as os   from 'node:os';
import * as readline from 'node:readline';

// ── ANSI primitives ──────────────────────────────────────────────────────────
const ESC   = '\x1b';
const RESET = `${ESC}[0m`;
const HIDE  = `${ESC}[?25l`;
const SHOW  = `${ESC}[?25h`;
const CLEAR = `${ESC}[2J`;
const HOME  = `${ESC}[H`;
const BOLD  = `${ESC}[1m`;
const DIM   = `${ESC}[2m`;

const rgb  = (r, g, b, bg = false) => `${ESC}[${bg ? 48 : 38};2;${r};${g};${b}m`;
const at   = (r, c) => `${ESC}[${r};${c}H`;
const eraseLine = `${ESC}[2K`;

// AlienClaw palette
const GREEN     = rgb(0,   255,  90);
const DKGREEN   = rgb(0,   180,  60);
const MENUGREEN = rgb(0,   140,  50);
const CYAN      = rgb(120, 245, 255);
const GOLD      = rgb(255, 200,   0);
const RED       = rgb(255,  60,  60);
const WHITE     = rgb(230, 230, 230);
const GRAY      = rgb(110, 110, 130);

// ── Helpers ─────────────────────────────────────────────────────────────────
const W = () => process.stdout.columns || 80;
const H = () => process.stdout.rows    || 24;

function write(s) { process.stdout.write(s); }
function writeln(s = '') { write(s + '\n'); }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function center(str, width = W()) {
  const visible = str.replace(/\x1b\[[^m]*m/g, '');
  const pad = Math.max(0, Math.floor((width - visible.length) / 2));
  return ' '.repeat(pad) + str;
}

function box(lines, opts = {}) {
  const { color = CYAN, title = '' } = opts;
  const contentWidth = Math.max(...lines.map(l => {
    return l.replace(/\x1b\[[^m]*m/g, '').length;
  }), title.length + 2);
  const w = contentWidth + 4;
  const top    = '╔' + '═'.repeat(w - 2) + '╗';
  const bottom = '╚' + '═'.repeat(w - 2) + '╝';
  const titleBar = title
    ? '╠' + '═'.repeat(Math.floor((w - 2 - title.length - 2) / 2)) +
      ` ${title} ` +
      '═'.repeat(Math.ceil((w - 2 - title.length - 2) / 2)) + '╣'
    : null;
  const result = [];
  result.push(color + top + RESET);
  if (titleBar) result.push(color + titleBar + RESET);
  for (const l of lines) {
    const visible = l.replace(/\x1b\[[^m]*m/g, '');
    const pad = contentWidth - visible.length;
    result.push(color + '║' + RESET + '  ' + l + ' '.repeat(pad) + '  ' + color + '║' + RESET);
  }
  result.push(color + bottom + RESET);
  return result;
}

// ── Paths ─────────────────────────────────────────────────────────────────────
const ALIENCLAW_HOME = process.env['ALIENCLAW_HOME']
  ?? path.join(os.homedir(), '.alienclaw');
const OPENCLAW_HOME  = process.env['OPENCLAW_HOME']
  ?? path.join(os.homedir(), '.openclaw');
const PREFS_FILE     = path.join(ALIENCLAW_HOME, 'preferences.json');

const SUBDIRS = [
  'registry/ms',
  'registry/msb',
  'registry/lineage',
  'registry/telemetry',
  'workspace/output',
];

// ── Directory setup ─────────────────────────────────────────────────────────---
async function setupDirectories(startRow) {
  const dirs = [ALIENCLAW_HOME, ...SUBDIRS.map(d => path.join(ALIENCLAW_HOME, d))];
  let row = startRow;

  write(at(row, 1) + CYAN + BOLD + '  Creating mission directories...' + RESET);
  row += 2;

  for (const dir of dirs) {
    const short = dir.replace(os.homedir(), '~');
    write(at(row, 1) + eraseLine + GRAY + '  › ' + WHITE + short + RESET);
    await sleep(55);
    fs.mkdirSync(dir, { recursive: true });
    write(at(row, 1) + eraseLine + DKGREEN + '  ✔ ' + GREEN + short + RESET);
    row++;
  }

  await sleep(150);
  write(at(row + 1, 1) + GREEN + BOLD + '  All systems nominal.' + RESET);
  return row + 3;
}

// ── Keyboard input ──────────────────────────────────────────────────────────
function enableRaw() {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
}

function disableRaw() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

function drainStdin() {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    let chunk;
    while ((chunk = process.stdin.read()) !== null) { /* discard */ }
  } catch { /* ignore on non-TTY */ }
}

function readKey() {
  return new Promise(resolve => {
    function onData(chunk) {
      process.stdin.off('data', onData);
      resolve(chunk);
    }
    process.stdin.on('data', onData);
  });
}

async function confirm(promptText, labelA, labelB, startRow) {
  const isTTY = process.stdin.isTTY;

  if (!isTTY) {
    // No TTY — skip the interactive prompt and default to opt-out.
    write(at(startRow, 1) + eraseLine + CYAN + BOLD + `  ${promptText}` + RESET);
    write(at(startRow + 2, 1) + eraseLine + GRAY + DIM + '  (no TTY detected — defaulting to: ' + labelB + ')' + RESET);
    write(at(startRow + 3, 1) + eraseLine);
    return false;
  }

  enableRaw();
  let chosen = 0;

  function render() {
    write(at(startRow, 1) + eraseLine + CYAN + BOLD + `  ${promptText}` + RESET);
    const aStyle = chosen === 0 ? GREEN + BOLD : GRAY + DIM;
    const bStyle = chosen === 1 ? RED + BOLD   : GRAY + DIM;
    write(at(startRow + 2, 1) + eraseLine +
      '  ' + aStyle + `[ ${labelA} ]` + RESET +
      '   ' +
      bStyle + `[ ${labelB} ]` + RESET);
    write(at(startRow + 3, 1) + eraseLine +
      DIM + '  ←→ arrows  ·  Enter to confirm' + RESET);
  }

  render();

  while (true) {
    const key = await readKey();
    if (key === '\x1b[D' || key === 'h') { chosen = 0; }
    else if (key === '\x1b[C' || key === 'l') { chosen = 1; }
    else if (key === '\r' || key === '\n') { break; }
    else if (key === '\x03') { cleanup(); process.exit(0); }
    render();
  }

  drainStdin();
  const result = chosen === 0;
  const style  = result ? GREEN + BOLD : GRAY + DIM;
  const picked = result ? labelA : labelB;
  write(at(startRow + 2, 1) + eraseLine + DKGREEN + '  ✔ ' + style + picked + RESET);
  write(at(startRow + 3, 1) + eraseLine);

  return result;
}

// ── Pulsing ONLINE banner ──────────────────────────────────────────────────
const BANNER = [
  '  ╔══════════════════════════════════════════════╗',
  '  ║                                              ║',
  '  ║      👽  A L I E N C L A W   O N L I N E    ║',
  '  ║                                              ║',
  '  ╚══════════════════════════════════════════════╝',
];

async function showOnlineBanner(startRow) {
  const STEPS = 28;
  for (let s = 0; s <= STEPS; s++) {
    const t    = s / STEPS;
    const ease = 1 - Math.pow(1 - t, 2.5);
    const g    = Math.round(ease * 255);
    const b    = Math.round(ease * 90);
    const col  = rgb(0, g, b);
    for (let i = 0; i < BANNER.length; i++) {
      write(at(startRow + i, 1) + col + BOLD + BANNER[i] + RESET);
    }
    await sleep(40);
  }
  const finalCol = rgb(0, 255, 90);
  for (let i = 0; i < BANNER.length; i++) {
    write(at(startRow + i, 1) + finalCol + BOLD + BANNER[i] + RESET);
  }
}

// ── Config persistence ────────────────────────────────────────────────────
function savePrefs(prefs) {
  const existing = fs.existsSync(PREFS_FILE)
    ? JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'))
    : {};
  const merged = { ...existing, ...prefs };
  fs.writeFileSync(PREFS_FILE, JSON.stringify(merged, null, 2) + '\n');
}

// ── Cleanup ────────────────────────────────────────────────────────────────
function cleanup() {
  disableRaw();
  write(SHOW + RESET + '\n');
}

process.on('exit',    cleanup);
process.on('SIGINT',  () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

// ── Main ─────────────────────────────────────────────────────────────────────
export async function runFirstRun() {
  const cols = W();
  const rows = H();

  write(HIDE + CLEAR + HOME);

  let row = 2;

  write(at(row, 1) + center(GREEN + BOLD + '━━━   A L I E N C L A W   S E T U P   ━━━' + RESET, cols));
  write(at(row + 1, 1) + center(GRAY + DIM + 'Configure your command center' + RESET, cols));
  row += 4;

  // ── Step 1: Directories ────────────────────────────────────────────────
  write(at(row, 1) + GOLD + BOLD + '  STEP 1 / 2 — Mission Directories' + RESET);
  row += 2;
  row = await setupDirectories(row);
  row += 1;

  // ── Step 2: Evolution Network ───────────────────────────────────────
  write(at(row, 1) + GOLD + BOLD + '  STEP 2 / 2 — Evolution Network' + RESET);
  row += 2;

  const optInLines = [
    GRAY + '  Your Meeseeks learn from every run.' + RESET,
    '',
    WHITE + '  Share anonymous genome fitness data with' + RESET,
    CYAN  + '  alienclaw.gg' + RESET + WHITE + ' in exchange for:' + RESET,
    '',
    GREEN + '    ✦  Full leaderboard access' + RESET,
    GREEN + '    ✦  Community genome upgrades' + RESET,
    GREEN + '    ✦  Cross-swarm intelligence boosts' + RESET,
  ];

  for (const l of optInLines) {
    write(at(row, 1) + l);
    row++;
  }
  row++;

  const evolveOptIn = await confirm(
    'Join the evolution network?',
    'Yes, evolve together',
    'No, stay local',
    row
  );

  row += 5;

  // ── Save ──────────────────────────────────────────────────────────────
  savePrefs({
    evolutionOptIn:   evolveOptIn,
    setupComplete:    true,
    setupCompletedAt: new Date().toISOString(),
  });

  write(at(row, 1) + DKGREEN + '  ✔ Configuration saved to ' + GREEN + ALIENCLAW_HOME + RESET);
  row += 3;

  // ── ONLINE banner ────────────────────────────────────────────────────
  await showOnlineBanner(row);
  row += BANNER.length + 2;

  await sleep(300);

  const legend = [
    GRAY  + '  Evolution : ' + (evolveOptIn ? GREEN + 'enabled' : GRAY + 'local'),
    '',
    GRAY  + DIM + '  Run ' + WHITE + 'alienclaw run "<goal>"' + GRAY + ' to begin your first mission.',
    GRAY  + DIM + '  Run ' + WHITE + 'openclaw --help' + GRAY + '      for OpenClaw commands.' + RESET,
  ];

  for (const l of legend) {
    write(at(row, 1) + l + RESET);
    row++;
  }

  write(at(row + 2, 1) + SHOW + RESET);

  return { evolutionOptIn: evolveOptIn };
}

// Named alias
export { runFirstRun as run };

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') ||
    process.argv[1]?.replace(/\\/g, '/').endsWith('first-run.mjs')) {
  runFirstRun().catch(err => {
    cleanup();
    console.error(err);
    process.exit(1);
  });
}
