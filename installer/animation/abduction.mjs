#!/usr/bin/env node
/**
 * installer/animation/abduction.mjs
 * AlienClaw — alien abduction cinematic installer sequence.
 * Requirements: Node ≥ 18 · truecolor terminal · ≥ 80×24
 * Zero external deps.
 */

// ── Terminal primitives ───────────────────────────────────────────────────────
const W   = process.stdout.columns || 80;
const H   = process.stdout.rows    || 24;
const E   = '\x1b[';
const out = s => process.stdout.write(s);
const at  = (r, c) => E + `${Math.round(r)};${Math.round(c)}H`;
const rgb = (r, g, b) => E + `38;2;${r};${g};${b}m`;
const RST = E + '0m';
const BLD = E + '1m';
const HC  = E + '?25l';   // hide cursor
const SC  = E + '?25h';   // show cursor
const CLR = E + '2J';

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const lerp   = (a, b, t) => a + (b - a) * t;
const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn  = t => t * t * t;
const easeInOut = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;

// ── Cleanup ───────────────────────────────────────────────────────────────────
let _done = false;
function cleanup(code = 0) {
  if (_done) return; _done = true;
  out(SC + RST + at(H, 1) + '\n');
  process.exit(code);
}
process.on('SIGINT',  () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));

if (W < 80 || H < 24) {
  process.stderr.write(`\n  Terminal too small (${W}×${H}). Need ≥ 80×24.\n\n`);
  process.exit(1);
}

// ── Layout ────────────────────────────────────────────────────────────────────
const SKY_H   = Math.max(10, H - 8);   // rows 1..SKY_H = night sky
const GR1     = SKY_H + 1;             // sparse grass tips
const GR2     = GR1 + 1;              // medium blades
const GR3     = GR1 + 2;              // dense blades
const GR4     = GR1 + 3;              // solid ground
const MID     = Math.floor(W / 2);

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  alienGreen: (v=1) => rgb(0, Math.round(255*v), Math.round(136*v)),
  cyan:       ()    => rgb(0, 255, 255),
  gold:       (v=1) => rgb(Math.round(255*v), Math.round(215*v), 0),
  red:        (v=1) => rgb(Math.round(255*v), Math.round(51*v), Math.round(51*v)),
  sky:        ()    => rgb(5, 4, 18),
};

// ── Ship art (AlienClaw original — wider saucer design) ───────────────────────
const SHIP = [
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡴⠛⠉⠙⠲⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡴⠊⠀⠀⢀⡠⠄⠀⠀⠑⠢⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡴⠒⠋⠁⠀⠀⢀⡔⠊⠁⠀⠀⠈⠑⢢⡀⠀⠉⠒⠶⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⠴⠋⠁⠀⠀⠀⠀⠀⢠⡞⠀⠀⠀⢀⡄⠀⠀⠀⢻⣄⠀⠀⠀⠀⠈⠙⠦⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⣠⡴⠞⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⣠⡟⠀⠀⠀⠀⠿⣿⠀⠀⠀⠀⢻⣄⠀⠀⠀⠀⠀⠀⠈⠙⠲⢦⣄⠀⠀⠀⠀⠀⠀',
  '⢀⣤⠶⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣼⠋⠀⠀⢀⡀⠀⠈⠉⠀⠀⢀⡄⠀⠙⣷⡀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠙⠶⣤⡀⠀⠀',
  '⠈⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣴⠿⢷⣤⡀⠀⠀⠈⠑⠒⠒⠊⠀⠀⠁⢀⣤⡿⠷⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠁⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⣶⡿⠛⠉⠀⠀⠀⠉⠛⢿⣶⣤⣤⣤⣤⣤⣶⡿⠛⠋⠉⠀⠀⠀⠉⠛⠻⢷⣤⣄⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⣶⣿⡇⠀⠈⠉⠁⠀⠈⠉⠀⠀⢸⣿⣶⣤⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⠁⢸⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇⠈⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠷⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⠾⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
];
const SH = SHIP.length;   // 12 rows
const SW = 48;             // 48 cols

// Ship color gradient (cyan top → teal → green bottom)
const SHIP_COL = [
  rgb(140,245,255), rgb(120,238,255), rgb(100,228,255),
  rgb(75, 215,250), rgb(50, 205,240), rgb(20, 210,215),
  rgb(0,  210,185), rgb(0,  200,160), rgb(0,  195,140),
  rgb(0,  215,120), rgb(0,  240,100), rgb(0,  255,90),
];

function shipStr(glow = 0) {
  let s = '';
  for (let i = 0; i < SH; i++) {
    const base = SHIP_COL[i];
    // glow brightens last row (thrusters)
    const col = i === SH-1 && glow > 0
      ? rgb(Math.round(glow*180), 255, Math.round(glow*60))
      : base;
    s += at(0, 0) + col + SHIP[i] + RST; // placeholder — caller sets row/col
  }
  return s;
}

function drawShip(sr, sc, glow = 0) {
  let s = '';
  for (let i = 0; i < SH; i++) {
    const r = sr + i;
    if (r < 1 || r > H - 1) continue;
    const col = i === SH-1 && glow > 0
      ? rgb(Math.round(glow*255), Math.round(255-glow*60), Math.round(glow*80))
      : SHIP_COL[i];
    s += at(r, sc) + col + SHIP[i] + RST;
  }
  out(s);
}

function eraseShip(sr, sc) {
  let s = '';
  const blank = ' '.repeat(SW);
  for (let i = 0; i < SH; i++) {
    const r = sr + i;
    if (r < 1 || r > H - 1) continue;
    s += at(r, sc) + blank;
  }
  out(s);
}

// ── Stars ─────────────────────────────────────────────────────────────────────
const STAR_CH = ['·','·','·','✦','✧','⋆','˚','*','·','✦'];
const STARS = (() => {
  let seed = 0xABCD1234;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xFFFFFFFF; };
  return Array.from({ length: 48 }, () => ({
    r: Math.floor(rng() * (SKY_H - 1)) + 1,
    c: Math.floor(rng() * (W - 2)) + 2,
    ch: STAR_CH[Math.floor(rng() * STAR_CH.length)],
    ph: rng() * Math.PI * 2,
    sp: 0.4 + rng() * 1.4,
  }));
})();

function drawStars(frame, count = STARS.length) {
  let s = '';
  for (let i = 0; i < Math.min(count, STARS.length); i++) {
    const st = STARS[i];
    const t  = frame * 0.06 * st.sp + st.ph;
    const bri = (Math.sin(t) + 1) / 2;
    const v  = Math.round(80 + bri * 175);
    const b  = Math.round(130 + bri * 125);
    s += at(st.r, st.c) + rgb(v, v, b) + st.ch + RST;
  }
  out(s);
}

// ── Grass ─────────────────────────────────────────────────────────────────────
// Four rows: tips → medium → dense → solid ground
const GRASS_UNITS = [
  { pat: '⠀⡀⢀⠀⠀⡀⢸⠀⡀⠀⢀⡀⠀⡀⠀', col: rgb(0,165,55)  },
  { pat: '⣸⣿⡇⢿⣿⡆⣿⡇⢸⣿⡇',     col: rgb(0,135,40)  },
  { pat: '⣿⣿⣿',                 col: rgb(0,108,30)  },
  { pat: '▓',                    col: rgb(0, 78,20)  },
];

function grassLine(idx) {
  const { pat, col } = GRASS_UNITS[idx];
  let s = '';
  while (s.length < W) s += pat;
  return col + s.slice(0, W) + RST;
}

const G_LINES = [0,1,2,3].map(grassLine);

function drawGrass() {
  out(at(GR1,1)+G_LINES[0] + at(GR2,1)+G_LINES[1] +
      at(GR3,1)+G_LINES[2] + at(GR4,1)+G_LINES[3]);
}

function eraseGrassCols(col, width) {
  // restore grass in a column band (ship beam area)
  const patches = [
    [GR1, G_LINES[0]], [GR2, G_LINES[1]],
    [GR3, G_LINES[2]], [GR4, G_LINES[3]],
  ];
  let s = '';
  for (const [r, gl] of patches) {
    // Slice the pre-computed grass string for the range [col, col+width)
    // gl is a string with ANSI escapes, so we can't slice naively.
    // Instead just redraw from col with a window of the pattern.
    const { pat, col: gc } = GRASS_UNITS[patches.indexOf([r,gl])];
    // Just write spaces then redraw will pick it up next frame.
    s += at(r, col) + ' '.repeat(width);
  }
  out(s);
}

// ── Beam ──────────────────────────────────────────────────────────────────────
function beamCol(frame, rowOff = 0) {
  const t = frame * 0.14 + rowOff * 0.08;
  const p = (Math.sin(t) + 1) / 2;
  // Gold (#FFD700) ↔ AlienGreen (#00FF88)
  return rgb(
    Math.round(255 * (1 - p * 0.88)),
    Math.round(190 + Math.round(p * 65)),
    Math.round(p * 136)
  );
}

function drawBeam(topR, botR, cCol, frame, erase = false) {
  const rows = botR - topR + 1;
  let s = '';
  for (let i = 0; i < rows; i++) {
    const r = topR + i;
    if (r < 1 || r > H - 1) continue;
    const prog  = rows <= 1 ? 0 : i / (rows - 1);
    const halfW = Math.min(10, Math.floor(prog * 11));
    const w     = halfW * 2 + 1;
    const lc    = cCol - halfW;
    if (erase) {
      s += at(r, lc) + ' '.repeat(w);
      continue;
    }
    const col  = beamCol(frame, i);
    // Alternate fill character for shimmer effect
    const fill = (frame + i) % 3 === 0 ? '⠿' : '⣿';
    const line = w === 1 ? '⡇' : '⡇' + fill.repeat(w - 2) + '⢸';
    s += at(r, lc) + col + line + RST;
  }
  out(s);
}

// ── Emoji helpers (2 cols wide) ───────────────────────────────────────────────
const drawEm  = (r, c, em) => { if (r>=1&&r<=H&&c>=1&&c<=W-1) out(at(r,c)+em); };
const eraseEm = (r, c)     => { if (r>=1&&r<=H&&c>=1&&c<=W-1) out(at(r,c)+'  '); };

// ── Frame timing ──────────────────────────────────────────────────────────────
const TICK = 60; // ms per frame

// ── Main animation ────────────────────────────────────────────────────────────
async function run() {
  out(HC + CLR + at(1,1));
  drawGrass();

  // Computed positions
  const shipCol   = Math.floor((W - SW) / 2) + 1;
  const shipRow   = Math.max(2, GR1 - SH - 2);   // hovered: bottom just above grass
  const beamCtr   = shipCol + Math.floor(SW / 2) - 1;
  const beamTop   = shipRow + SH;
  const beamBot   = GR1 - 1;

  let frame = 0;
  // ── Phase 1: Stars appear + twinkle (2s) ──────────────────────────────────
  for (let f = 0; f < 33; f++) {
    drawStars(frame, Math.floor((f / 32) * STARS.length));
    frame++; await sleep(TICK);
  }
  // Extra twinkle settle
  for (let f = 0; f < 17; f++) {
    drawStars(frame, STARS.length);
    frame++; await sleep(TICK);
  }

  // ── Phase 2: 🦞 slides in from top-left diagonally (2s) ──────────────────
  const lobDstR = GR1, lobDstC = MID - 1;
  let lobR = 1, lobC = 1;
  let pLobR = -1, pLobC = -1;
  for (let f = 0; f <= 33; f++) {
    const t  = easeOut(f / 33);
    const nr = Math.round(lerp(1, lobDstR, t));
    const nc = Math.round(lerp(1, lobDstC, t));
    if (pLobR >= 0) eraseEm(pLobR, pLobC);
    drawStars(frame);
    drawEm(nr, nc, '🦞');
    pLobR = nr; pLobC = nc;
    frame++; await sleep(TICK);
  }
  lobR = lobDstR; lobC = lobDstC;

  // ── Phase 3: 🦞 sits in field (1s) ────────────────────────────────────────
  for (let f = 0; f < 17; f++) {
    drawStars(frame);
    drawEm(lobR, lobC, '🦞');
    frame++; await sleep(TICK);
  }

  // ── Phase 4: Ship drifts in from top-right (3s) ───────────────────────────
  const sStart = { r: -SH, c: Math.max(1, W - SW + 4) };
  let pSR = null, pSC = null;
  for (let f = 0; f <= 50; f++) {
    const t  = easeOut(f / 50);
    const nr = Math.round(lerp(sStart.r, shipRow, t));
    const nc = Math.round(lerp(sStart.c, shipCol, t));
    if (pSR !== null) eraseShip(pSR, pSC);
    drawStars(frame);
    drawEm(lobR, lobC, '🦞');
    drawShip(nr, nc);
    pSR = nr; pSC = nc;
    frame++; await sleep(TICK);
  }
  // Ship settled
  drawShip(shipRow, shipCol);

  // ── Phase 5: Beam extends down to 🦞, pulses (2s) ─────────────────────────
  for (let f = 0; f <= 25; f++) {
    const t  = f / 25;
    const bt = Math.round(lerp(beamTop, beamBot, t));
    drawBeam(beamTop, bt, beamCtr, frame);
    drawStars(frame);
    drawShip(shipRow, shipCol);
    drawEm(lobR, lobC, '🦞');
    frame++; await sleep(TICK);
  }
  // Pulse with 🦞 glowing
  for (let f = 0; f < 20; f++) {
    const glow = (Math.sin(frame * 0.25) + 1) / 2 * 0.4;
    drawBeam(beamTop, beamBot, beamCtr, frame);
    drawStars(frame);
    drawShip(shipRow, shipCol, glow);
    drawEm(lobR, lobC, '🦞');
    frame++; await sleep(TICK);
  }

  // ── Phase 6: 🦞 rises through beam into ship (2s) ─────────────────────────
  for (let f = 0; f <= 33; f++) {
    const t  = easeIn(f / 33);
    const nr = Math.round(lerp(lobR, beamTop, t));
    eraseEm(pLobR ?? lobR, lobC);
    // Redraw beam
    drawBeam(beamTop, beamBot, beamCtr, frame);
    // Erase beam cells below lobster (it "rises above" the beam bottom)
    if (nr > beamTop) {
      drawBeam(nr + 1, beamBot, beamCtr, frame);
    }
    drawStars(frame);
    drawShip(shipRow, shipCol, 0.2 + (Math.sin(frame*0.3)+1)*0.15);
    drawEm(nr, beamCtr - 1, '🦞');
    pLobR = nr;
    frame++; await sleep(TICK);
  }
  eraseEm(pLobR, lobC);
  // Clear beam
  drawBeam(beamTop, beamBot, beamCtr, frame, true);

  // ── Phase 7: Ship wobbles then LAUNCHES (1s) ───────────────────────────────
  for (let f = 0; f < 12; f++) {
    const wb = Math.round(Math.sin(f * 1.1) * 2);
    eraseShip(shipRow, shipCol - 2);
    drawStars(frame);
    drawShip(shipRow, shipCol + wb, 0.3 + Math.abs(Math.sin(f*0.4))*0.3);
    frame++; await sleep(TICK);
  }
  // LAUNCH — accelerate upward
  let lSR = shipRow, lSC = shipCol;
  eraseShip(lSR, lSC);
  for (let f = 0; f < 10; f++) {
    eraseShip(lSR, lSC);
    lSR -= (f + 1) * 2;
    lSC += 1;
    if (lSR + SH < 0) break;
    drawStars(frame);
    drawShip(lSR, lSC, 0.8);
    frame++; await sleep(Math.round(TICK * 0.5));
  }
  eraseShip(lSR, lSC);

  // ── Phase 8: Pause — empty field, stars (1s) ──────────────────────────────
  drawGrass();
  for (let f = 0; f < 17; f++) {
    drawStars(frame);
    frame++; await sleep(TICK);
  }

  // ── Phase 9: Ship returns from top-left, slower (2s) ──────────────────────
  const s2Start = { r: -SH, c: 1 - SW };
  pSR = null; pSC = null;
  for (let f = 0; f <= 40; f++) {
    const t  = easeOut(f / 40);
    const nr = Math.round(lerp(s2Start.r, shipRow, t));
    const nc = Math.round(lerp(s2Start.c, shipCol, t));
    if (pSR !== null) eraseShip(pSR, pSC);
    drawStars(frame);
    drawShip(nr, nc);
    pSR = nr; pSC = nc;
    frame++; await sleep(Math.round(TICK * 1.1));
  }
  drawShip(shipRow, shipCol);

  // ── Phase 10: Beam extends, 👽 descends through beam (2s) ─────────────────
  for (let f = 0; f <= 25; f++) {
    const t  = f / 25;
    const bt = Math.round(lerp(beamTop, beamBot, t));
    drawBeam(beamTop, bt, beamCtr, frame);
    drawStars(frame);
    drawShip(shipRow, shipCol);
    frame++; await sleep(TICK);
  }

  let alienR = beamTop, pAlienR = beamTop;
  for (let f = 0; f <= 33; f++) {
    const t  = easeOut(f / 33);
    const nr = Math.round(lerp(beamTop, beamBot + 1, t));
    eraseEm(pAlienR, beamCtr - 1);
    drawBeam(beamTop, beamBot, beamCtr, frame);
    drawStars(frame);
    drawShip(shipRow, shipCol);
    drawEm(nr, beamCtr - 1, '👽');
    pAlienR = nr;
    frame++; await sleep(TICK);
  }
  alienR = pAlienR;

  // Beam retracts (retract from bottom)
  for (let f = 0; f <= 20; f++) {
    const t  = f / 20;
    const bt = Math.round(lerp(beamBot, beamTop - 1, t));
    drawBeam(beamTop, bt, beamCtr, frame);
    // Clear rows below retracted top
    if (bt < beamBot) drawBeam(bt + 1, beamBot, beamCtr, frame, true);
    drawStars(frame);
    drawShip(shipRow, shipCol);
    drawEm(alienR, beamCtr - 1, '👽');
    frame++; await sleep(TICK);
  }
  drawBeam(beamTop, beamBot, beamCtr, frame, true);

  // 👽 lands in field
  const alienLandC = MID - 1;
  drawGrass();
  drawEm(GR1, alienLandC, '👽');

  // ── Phase 11: Ship drifts away upper-right (1s) ───────────────────────────
  for (let f = 0; f <= 20; f++) {
    const t  = easeIn(f / 20);
    const nr = Math.round(lerp(shipRow, -SH - 2, t));
    const nc = Math.round(lerp(shipCol, W + 4,   t));
    if (pSR !== null) eraseShip(pSR, pSC);
    drawStars(frame);
    drawEm(GR1, alienLandC, '👽');
    drawShip(nr, nc, t * 0.4);
    pSR = nr; pSC = nc;
    frame++; await sleep(TICK);
  }
  if (pSR !== null) eraseShip(pSR, pSC);

  // ── Phase 12: 👽 slides from field center → top-left corner (2s) ──────────
  let pAlienRC = GR1, pAlienCC = alienLandC;
  for (let f = 0; f <= 33; f++) {
    const t  = easeInOut(f / 33);
    const nr = Math.round(lerp(GR1, 1, t));
    const nc = Math.round(lerp(alienLandC, 1, t));
    eraseEm(pAlienRC, pAlienCC);
    drawStars(frame);
    drawGrass();
    drawEm(nr, nc, '👽');
    pAlienRC = nr; pAlienCC = nc;
    frame++; await sleep(TICK);
  }
  // 👽 arrives at top-left
  drawEm(1, 1, '👽');

  // ── Phase 13: Color bleed red → #00FF88, heartbeat pulses, steady (3s) ────
  const TITLE = '  ✦  A L I E N C L A W   O N L I N E  ✦  ';
  const tCol  = Math.max(1, Math.floor((W - TITLE.length) / 2) + 1);
  const tRow  = Math.floor(H / 2);

  for (let f = 0; f < 55; f++) {
    const t = f / 54;
    // Heartbeat: 3 pulses then fade to steady
    const beat = f < 40
      ? (Math.sin(t * Math.PI * 5.5) + 1) / 2
      : 1;
    const pulse = 0.25 + beat * 0.75;

    // Color transition red → green
    const cr = Math.round(lerp(255, 0,   Math.min(1, t * 1.6)) * pulse);
    const cg = Math.round(lerp(51,  255, Math.min(1, t * 1.3)) * pulse);
    const cb = Math.round(lerp(51,  136, t) * pulse);

    const borderCol = rgb(cr, cg, cb);

    // Animated border
    let s = '';
    s += at(1, 1)   + borderCol + '━'.repeat(W) + RST;
    s += at(H-1, 1) + borderCol + '━'.repeat(W) + RST;
    for (let r = 2; r < H-1; r++) {
      s += at(r, 1) + borderCol + '┃' + RST;
      s += at(r, W) + borderCol + '┃' + RST;
    }
    out(s);
    drawStars(frame);
    drawGrass();
    drawEm(1, 1, '👽');

    // Title fades in after first pulse
    if (f > 12) {
      const ta = Math.min(1, (f - 12) / 18);
      const tr = Math.round(cr * ta);
      const tg = Math.round(lerp(0, cg, ta));
      const tb = Math.round(lerp(255, cb, ta));
      out(at(tRow, tCol) + rgb(tr, tg, tb) + BLD + TITLE + RST);
    }
    frame++; await sleep(TICK);
  }

  // Steady alien-green glow for 1 second
  for (let f = 0; f < 17; f++) {
    const pulse = 0.75 + (Math.sin(f * 0.35) + 1) / 2 * 0.25;
    const col   = rgb(0, Math.round(255 * pulse), Math.round(136 * pulse));
    let s = '';
    s += at(1,1)   + col + '━'.repeat(W) + RST;
    s += at(H-1,1) + col + '━'.repeat(W) + RST;
    for (let r = 2; r < H-1; r++) {
      s += at(r,1) + col + '┃' + RST;
      s += at(r,W) + col + '┃' + RST;
    }
    out(s);
    drawStars(frame);
    drawGrass();
    drawEm(1, 1, '👽');
    out(at(tRow, tCol) + col + BLD + TITLE + RST);
    frame++; await sleep(TICK);
  }

  // ── Hand off to first-run setup ───────────────────────────────────────────
  out(SC + RST);
  // Clear for setup prompts
  out(CLR + at(1,1));

  try {
    const { run: firstRun } = await import('../setup/first-run.mjs');
    await firstRun();
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    // first-run.mjs not yet built — just show the banner
    out(at(Math.floor(H/2)-1, 1));
    out(rgb(0,255,136) + BLD + '  👽  AlienClaw is ready. Run: alienclaw run "<goal>"\n' + RST);
  }
}

run().catch(err => { cleanup(1); process.stderr.write(String(err) + '\n'); });
