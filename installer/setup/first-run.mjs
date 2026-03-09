#!/usr/bin/env node
/**
 * first-run.mjs
 * AlienClaw first-run configuration wizard.
 * Called from installer/animation/abduction.mjs after the animation completes.
 *
 * Zero external dependencies — plain Node.js ESM.
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
const ITAL  = `${ESC}[3m`;

const rgb  = (r, g, b, bg = false) => `${ESC}[${bg ? 48 : 38};2;${r};${g};${b}m`;
const at   = (r, c) => `${ESC}[${r};${c}H`;
const eraseLine = `${ESC}[2K`;

// AlienClaw palette
const GREEN   = rgb(0,   255,  90);
const DKGREEN = rgb(0,   180,  60);
const CYAN    = rgb(120, 245, 255);
const GOLD    = rgb(255, 200,   0);
const RED     = rgb(255,  60,  60);
const WHITE   = rgb(230, 230, 230);
const GRAY    = rgb(110, 110, 130);
const ALIEN   = rgb(80,  255, 120);

// ── Helpers ──────────────────────────────────────────────────────────────────
const W = () => process.stdout.columns || 80;
const H = () => process.stdout.rows    || 24;

function write(s) { process.stdout.write(s); }
function writeln(s = '') { write(s + '\n'); }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function center(str, width = W()) {
  // Strip ANSI before measuring width
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
const CONFIG_FILE    = path.join(ALIENCLAW_HOME, 'alienclaw.json');
const PREFS_FILE     = path.join(ALIENCLAW_HOME, 'preferences.json');

const SUBDIRS = [
  'registry/ms',
  'registry/msb',
  'registry/lineage',
  'registry/telemetry',
  'workspace/output',
];

// ── Directory setup ───────────────────────────────────────────────────────────
async function setupDirectories(startRow) {
  const tasks = [ALIENCLAW_HOME, ...SUBDIRS.map(d => path.join(ALIENCLAW_HOME, d))];
  let row = startRow;

  write(at(row, 1) + CYAN + BOLD + '  Preparing mission directories...' + RESET);
  row += 2;

  for (const dir of tasks) {
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

// ── Keyboard input (raw mode) ─────────────────────────────────────────────────
function enableRaw() {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
}

function disableRaw() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

/**
 * Wait for a single keypress. Returns the raw character(s).
 */
function readKey() {
  return new Promise(resolve => {
    function onData(chunk) {
      process.stdin.off('data', onData);
      resolve(chunk);
    }
    process.stdin.on('data', onData);
  });
}

/**
 * Present a numbered-menu selection. Returns the 0-based index chosen.
 */
async function selectMenu(prompt, options, startRow) {
  enableRaw();

  let selected = 0;
  const n = options.length;

  function render() {
    write(at(startRow, 1) + eraseLine + CYAN + BOLD + `  ${prompt}` + RESET);
    for (let i = 0; i < n; i++) {
      const row = startRow + 2 + i;
      if (i === selected) {
        write(at(row, 1) + eraseLine + GREEN + BOLD + `  ▶  ${options[i]}` + RESET);
      } else {
        write(at(row, 1) + eraseLine + GRAY + `     ${options[i]}` + RESET);
      }
    }
    write(at(startRow + 2 + n + 1, 1) + eraseLine +
      DIM + '  ↑↓ arrows  ·  Enter to confirm' + RESET);
  }

  render();

  while (true) {
    const key = await readKey();

    if (key === '\x1b[A' || key === 'k') {  // up
      selected = (selected - 1 + n) % n;
    } else if (key === '\x1b[B' || key === 'j') {  // down
      selected = (selected + 1) % n;
    } else if (key === '\r' || key === '\n') {
      break;
    } else if (key === '\x03') {  // Ctrl-C
      cleanup();
      process.exit(0);
    } else {
      // Number shortcuts 1–9
      const num = parseInt(key, 10);
      if (!isNaN(num) && num >= 1 && num <= n) {
        selected = num - 1;
        break;
      }
    }
    render();
  }

  disableRaw();
  // Mark chosen
  for (let i = 0; i < n; i++) {
    const row = startRow + 2 + i;
    if (i === selected) {
      write(at(row, 1) + eraseLine + GREEN + BOLD + `  ✔  ${options[i]}` + RESET);
    } else {
      write(at(row, 1) + eraseLine + GRAY + DIM + `     ${options[i]}` + RESET);
    }
  }
  write(at(startRow + 2 + n + 1, 1) + eraseLine);

  return selected;
}

/**
 * Read a line of hidden input (asterisks shown, content not echoed).
 * Returns the string entered.
 */
async function readSecret(prompt, startRow) {
  enableRaw();
  write(at(startRow, 1) + eraseLine + CYAN + BOLD + `  ${prompt}` + RESET);
  write(at(startRow + 1, 1) + eraseLine + GRAY + '  › ' + RESET);

  let value = '';

  function renderInput() {
    write(at(startRow + 1, 1) + eraseLine +
      GRAY + '  › ' + GREEN + '●'.repeat(value.length) +
      (value.length === 0 ? DIM + '(hidden)' + RESET : '') + RESET);
  }

  renderInput();

  while (true) {
    const key = await readKey();

    if (key === '\r' || key === '\n') {
      break;
    } else if (key === '\x03') {  // Ctrl-C
      cleanup();
      process.exit(0);
    } else if (key === '\x7f' || key === '\b') {  // backspace
      value = value.slice(0, -1);
    } else if (key >= ' ' && key.length === 1) {
      value += key;
    }
    renderInput();
  }

  disableRaw();
  write(at(startRow + 1, 1) + eraseLine +
    DKGREEN + '  ✔ ' + GREEN + '●'.repeat(Math.min(value.length, 8)) + DIM + '  (saved)' + RESET);

  return value;
}

/**
 * Yes/No choice with highlighted selection.
 */
async function confirm(promptText, labelA, labelB, startRow) {
  enableRaw();
  let chosen = 0;  // 0 = A (Yes), 1 = B (No)

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

  disableRaw();
  const result = chosen === 0;
  const style  = result ? GREEN + BOLD : GRAY + DIM;
  const picked = result ? labelA : labelB;
  write(at(startRow + 2, 1) + eraseLine + DKGREEN + '  ✔ ' + style + picked + RESET);
  write(at(startRow + 3, 1) + eraseLine);

  return result;
}

// ── Pulsing ONLINE banner ─────────────────────────────────────────────────────
const BANNER = [
  '  ╔══════════════════════════════════════════════╗',
  '  ║                                              ║',
  '  ║      👽  A L I E N C L A W   O N L I N E    ║',
  '  ║                                              ║',
  '  ╚══════════════════════════════════════════════╝',
];

async function showOnlineBanner(startRow) {
  const pulseColors = [
    rgb(0, 80,  30),
    rgb(0, 140, 55),
    rgb(0, 210, 80),
    rgb(0, 255, 90),
    rgb(60, 255, 120),
    rgb(0, 255, 90),
    rgb(0, 210, 80),
    rgb(0, 140, 55),
    rgb(0, 80,  30),
    rgb(0, 140, 55),
    rgb(0, 210, 80),
    rgb(0, 255, 90),
    rgb(60, 255, 120),
    rgb(0, 255, 90),
    rgb(0, 255, 90),  // hold green
    rgb(0, 255, 90),
    rgb(0, 255, 90),
  ];

  for (const col of pulseColors) {
    for (let i = 0; i < BANNER.length; i++) {
      write(at(startRow + i, 1) + col + BOLD + BANNER[i] + RESET);
    }
    await sleep(70);
  }
}

// ── Config persistence ────────────────────────────────────────────────────────
const PROVIDER_ENV_KEYS = {
  'Anthropic':  'ANTHROPIC_API_KEY',
  'MiniMax':    'MINIMAX_API_KEY',
  'OpenAI':     'OPENAI_API_KEY',
  'Ollama':     null,   // local, no key needed
  'Other':      'ALIENCLAW_API_KEY',
};

const PROVIDER_IDS = {
  'Anthropic': 'anthropic',
  'MiniMax':   'minimax',
  'OpenAI':    'openai',
  'Ollama':    'ollama',
  'Other':     'other',
};

function saveConfig(cfg) {
  const existing = fs.existsSync(CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    : {};
  const merged = { ...existing, ...cfg };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n');
}

function savePrefs(prefs) {
  const existing = fs.existsSync(PREFS_FILE)
    ? JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'))
    : {};
  const merged = { ...existing, ...prefs };
  fs.writeFileSync(PREFS_FILE, JSON.stringify(merged, null, 2) + '\n');
}

function appendEnvFile(key, value) {
  // Write / update ~/.alienclaw/.env (not the repo .env)
  const envPath = path.join(ALIENCLAW_HOME, '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  // Remove existing line for this key if present
  content = content.split('\n').filter(l => !l.startsWith(`${key}=`)).join('\n');
  if (content && !content.endsWith('\n')) content += '\n';
  content += `${key}=${value}\n`;
  fs.writeFileSync(envPath, content, { mode: 0o600 });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanup() {
  disableRaw();
  write(SHOW + RESET + '\n');
}

process.on('exit',    cleanup);
process.on('SIGINT',  () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

// ── Main ──────────────────────────────────────────────────────────────────────
export async function runFirstRun() {
  const cols = W();
  const rows = H();

  // Clear and set up a clean surface
  write(HIDE + CLEAR + HOME);

  let row = 2;

  // Header
  write(at(row, 1) + center(CYAN + BOLD + '━━━  ALIENCLAW MISSION SETUP  ━━━' + RESET, cols));
  write(at(row + 1, 1) + center(GRAY + DIM + 'Configure your command center' + RESET, cols));
  row += 4;

  // ── Step 1: Directory setup ───────────────────────────────────────────────
  write(at(row, 1) + GOLD + BOLD + '  STEP 1 / 4 — Mission Directories' + RESET);
  row += 2;
  row = await setupDirectories(row);
  row += 1;

  // ── Step 2: Provider selection ────────────────────────────────────────────
  write(at(row, 1) + GOLD + BOLD + '  STEP 2 / 4 — AI Provider' + RESET);
  row += 2;

  const PROVIDERS = ['Anthropic', 'MiniMax', 'OpenAI', 'Ollama', 'Other'];
  const providerIdx = await selectMenu('Choose your LLM provider:', PROVIDERS, row);
  const providerLabel = PROVIDERS[providerIdx];
  const providerEnvKey = PROVIDER_ENV_KEYS[providerLabel];

  row += 2 + PROVIDERS.length + 3;

  // ── Step 2b: API key (skip for Ollama) ───────────────────────────────────
  let apiKey = null;
  if (providerEnvKey) {
    // Check if already set in environment
    if (process.env[providerEnvKey]) {
      write(at(row, 1) + eraseLine + DKGREEN + '  ✔ ' + GREEN +
        `${providerEnvKey} already set in environment.` + RESET);
      apiKey = process.env[providerEnvKey];
      row += 2;
    } else {
      apiKey = await readSecret(`${providerLabel} API key  (${providerEnvKey}):`, row);
      row += 3;
      if (apiKey) {
        appendEnvFile(providerEnvKey, apiKey);
      }
    }
  } else {
    write(at(row, 1) + eraseLine + GRAY + '  › Ollama runs locally — no API key needed.' + RESET);
    row += 2;
  }

  // ── Step 3: Verbosity preference ─────────────────────────────────────────
  write(at(row, 1) + GOLD + BOLD + '  STEP 3 / 4 — Verbosity' + RESET);
  row += 2;

  const VERBOSITY = ['Quiet  — summary only', 'Normal — standard output', 'Verbose — full agent stream'];
  const verbIdx = await selectMenu('How much output do you want?', VERBOSITY, row);
  const verbosityMap = ['quiet', 'normal', 'verbose'];

  row += 2 + VERBOSITY.length + 3;

  // ── Step 4: Evolution opt-in ──────────────────────────────────────────────
  write(at(row, 1) + GOLD + BOLD + '  STEP 4 / 4 — Evolution Network' + RESET);
  row += 2;

  const optInLines = [
    GRAY + 'Your Meeseeks learn from every run.' + RESET,
    '',
    WHITE + 'Share anonymous genome fitness data with' + RESET,
    CYAN + 'alienclaw.gg' + RESET + WHITE + ' in exchange for:' + RESET,
    '',
    GREEN + '  ✦' + RESET + '  Full leaderboard access',
    GREEN + '  ✦' + RESET + '  Community genome upgrades',
    GREEN + '  ✦' + RESET + '  Cross-swarm intelligence boosts',
  ];

  for (const l of optInLines) {
    write(at(row, 1) + '  ' + l);
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

  // ── Save config ───────────────────────────────────────────────────────────
  saveConfig({
    provider:  PROVIDER_IDS[providerLabel],
    verbosity: verbosityMap[verbIdx],
  });
  savePrefs({
    evolutionOptIn:   evolveOptIn,
    setupComplete:    true,
    setupCompletedAt: new Date().toISOString(),
  });

  write(at(row, 1) + DKGREEN + '  ✔ Configuration saved to ' + GREEN + ALIENCLAW_HOME + RESET);
  row += 3;

  // ── ONLINE banner ─────────────────────────────────────────────────────────
  await showOnlineBanner(row);
  row += BANNER.length + 2;

  await sleep(300);

  // Sub-legend
  const legend = [
    GRAY + '  Provider  : ' + GREEN + providerLabel,
    GRAY + '  Verbosity : ' + GREEN + verbosityMap[verbIdx],
    GRAY + '  Evolution : ' + (evolveOptIn ? GREEN + 'enabled' : GRAY + 'local'),
    '',
    GRAY + DIM + '  Run ' + WHITE + 'alienclaw run "<goal>"' + GRAY + ' to begin your first mission.',
    GRAY + DIM + '  Run ' + WHITE + 'alienclaw --help' + GRAY + '       for all commands.' + RESET,
  ];

  for (const l of legend) {
    write(at(row, 1) + l + RESET);
    row++;
  }

  // Position cursor below everything and restore
  write(at(row + 2, 1) + SHOW + RESET);

  return {
    provider:      PROVIDER_IDS[providerLabel],
    apiKey,
    verbosity:     verbosityMap[verbIdx],
    evolutionOptIn: evolveOptIn,
  };
}

// Named alias so abduction.mjs can: const { run } = await import('../setup/first-run.mjs')
export { runFirstRun as run };

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') ||
    process.argv[1]?.replace(/\\/g, '/').endsWith('first-run.mjs')) {
  runFirstRun().catch(err => {
    cleanup();
    console.error(err);
    process.exit(1);
  });
}
