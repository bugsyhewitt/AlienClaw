/*
 * AlienClaw — read-only community leaderboard.
 *
 * Pure consumer of the live, unauthenticated endpoint:
 *     GET /v1/genomes/top?martian_type=<type>&n=<1..100>
 *
 * Response contract (src/alienclaw/api/handlers/genomes.ts → handleTopGenomes,
 * mirrored in src/alienclaw/api/types.ts → TopGenomesResponse / GenomeEntry):
 *
 *   {
 *     "martian_type":   "compute",
 *     "total_for_type": 42,
 *     "genomes": [
 *       {
 *         "genome":           "<256-char Base62>",
 *         "fitness":          0.9123,
 *         "submission_id":    "<uuid>",
 *         "submitted_at":     "<ISO-8601>",
 *         "leaderboard_name": "ALIENBOT",   // ^[A-Z]{8}$
 *         "generation":       7              // optional (run_metadata.generation)
 *       }
 *     ]
 *   }
 *
 * No backend changes. No frameworks. No third-party JavaScript. No trackers.
 *
 * This module is written as plain ES so its pure functions can be unit-tested
 * in Node (vitest) without a DOM. Anything that touches `document`/`window` is
 * guarded behind a runtime check and only runs in a browser.
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const API_BASE = 'https://api.alienclaw.net';

/**
 * The Martian types surfaced in the read-only leaderboard dropdown. These are
 * the eight primary registered types from the server's registry
 * (src/alienclaw/api/server.ts → _REGISTERED). The `_alone` benchmark variants
 * are intentionally not surfaced to the public board.
 */
export const MARTIAN_TYPES = Object.freeze([
  'compute',
  'search_text',
  'http_get',
  'url_fetch',
  'web_search',
  'file_read',
  'file_write',
  'extract_json',
]);

export const DEFAULT_MARTIAN_TYPE = 'compute';

/** How many rows to request. Server clamps to [1, 100]; 20 is a sensible board. */
export const TOP_N = 20;

// ── Pure helpers (DOM-free, unit-tested) ─────────────────────────────────────

/**
 * Deterministic, dependency-free FNV-1a 32-bit hash → 8 hex chars.
 * Identical output in every JS engine (browser + Node), no Web Crypto needed.
 * Used to derive a short, stable display identity for a 256-char genome.
 * @param {string} str
 * @returns {string} 8 lowercase hex chars
 */
export function fnv1a32(str) {
  let h = 0x811c9dc5; // offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i) & 0xff;
    // h *= 16777619, kept in 32-bit space via Math.imul
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 coerces to unsigned 32-bit; pad to a fixed 8 hex chars.
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Short, stable identity for a genome: `g-XXXXXXXX` (8 hex from FNV-1a).
 * A *hash*, not a prefix — two genomes that share the first N chars still get
 * distinct short-hashes. Falls back to `g-????????` for missing/invalid input.
 * @param {unknown} genome
 * @returns {string}
 */
export function shortHash(genome) {
  if (typeof genome !== 'string' || genome.length === 0) return 'g-????????';
  return 'g-' + fnv1a32(genome);
}

/**
 * Format a fitness score to 4 decimal places. Fitness is a float in [0, 1].
 * Non-numeric / out-of-range input renders as an em dash.
 * @param {unknown} fitness
 * @returns {string}
 */
export function formatFitness(fitness) {
  // Only a genuine finite number is a valid fitness. We deliberately do NOT
  // coerce (Number(null) === 0, Number('') === 0) — coercing malformed input
  // to a plausible-looking 0.0000 would fabricate a score the API never sent.
  if (typeof fitness !== 'number' || !Number.isFinite(fitness)) return '—';
  return fitness.toFixed(4);
}

/**
 * Format an optional generation number. `generation` is undefined when the
 * submitter did not include run_metadata.generation. Renders an em dash then.
 * @param {unknown} generation
 * @returns {string}
 */
export function formatGeneration(generation) {
  if (generation === null || generation === undefined) return '—';
  const n = typeof generation === 'number' ? generation : Number(generation);
  if (!Number.isInteger(n) || n < 0) return '—';
  return String(n);
}

/**
 * Escape a string for safe insertion into HTML text/attribute context.
 * Defense in depth: although the server validates submitted fields, this page
 * is a read-only consumer of a *live, community-fed* endpoint and never trusts
 * response values.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Row view-model for one leaderboard entry.
 * @typedef {Object} LeaderboardRow
 * @property {number} rank             1-based rank (response order is ranked)
 * @property {string} shortHash        `g-XXXXXXXX`
 * @property {string} genomeFull       full genome string (for title/tooltip), or ''
 * @property {string} leaderboardName  ^[A-Z]{8}$ or '—'
 * @property {string} fitness          formatted fitness, e.g. '0.9123'
 * @property {string} generation       formatted generation or '—'
 */

/**
 * Transform a /v1/genomes/top response into ranked row view-models.
 * Defensive: tolerates a missing/garbled body, a non-array `genomes`, and
 * malformed individual entries without throwing.
 * @param {unknown} resp
 * @returns {LeaderboardRow[]}
 */
export function rowsFromResponse(resp) {
  const genomes = resp && Array.isArray(resp.genomes) ? resp.genomes : [];
  return genomes.map((entry, i) => {
    const e = entry && typeof entry === 'object' ? entry : {};
    const name = typeof e.leaderboard_name === 'string' && /^[A-Z]{8}$/.test(e.leaderboard_name)
      ? e.leaderboard_name
      : '—';
    return {
      rank:            i + 1,
      shortHash:       shortHash(e.genome),
      genomeFull:      typeof e.genome === 'string' ? e.genome : '',
      leaderboardName: name,
      fitness:         formatFitness(e.fitness),
      generation:      formatGeneration(e.generation),
    };
  });
}

/**
 * Human status line for a response (or a count of rows already derived).
 * @param {{ total_for_type?: unknown }} resp
 * @param {number} shown number of rows rendered
 * @param {string} martianType
 * @returns {string}
 */
export function statusText(resp, shown, martianType) {
  if (shown === 0) {
    return `No genomes submitted yet for ${martianType}.`;
  }
  const totalRaw = resp && typeof resp.total_for_type === 'number' ? resp.total_for_type : shown;
  const total = Number.isFinite(totalRaw) ? totalRaw : shown;
  const plural = total === 1 ? '' : 's';
  return `${total} genome${plural} — showing top ${shown}`;
}

/**
 * Render rows to a string of <tr> HTML. Pure and DOM-free so it can be asserted
 * directly in tests. All interpolated values are HTML-escaped.
 * @param {LeaderboardRow[]} rows
 * @returns {string}
 */
export function renderRowsHtml(rows) {
  return rows.map((r) => {
    const topClass = r.rank === 1 ? ' class="top1"' : '';
    const title = r.genomeFull ? ` title="${escapeHtml(r.genomeFull)}"` : '';
    return (
      `<tr${topClass}>` +
      `<td class="rank">${escapeHtml(r.rank)}</td>` +
      `<td class="genome"${title}>${escapeHtml(r.shortHash)}</td>` +
      `<td class="fitness">${escapeHtml(r.fitness)}</td>` +
      `<td class="operator">${escapeHtml(r.leaderboardName)}</td>` +
      `<td class="generation">${escapeHtml(r.generation)}</td>` +
      `</tr>`
    );
  }).join('');
}

/**
 * Build the request URL for the top-genomes endpoint.
 * @param {string} martianType
 * @param {number} [n]
 * @param {string} [base]
 * @returns {string}
 */
export function topGenomesUrl(martianType, n = TOP_N, base = API_BASE) {
  return `${base}/v1/genomes/top?martian_type=${encodeURIComponent(martianType)}&n=${encodeURIComponent(n)}`;
}

// ── DOM binding (browser only) ───────────────────────────────────────────────
// Everything below touches the DOM and is therefore guarded. Importing this
// module in Node (for tests) runs none of it.

/**
 * Wire the leaderboard UI to a document. Exposed (and exported) so a browser
 * harness could drive it, but it is only auto-invoked in a real browser via
 * init() at the bottom of this file.
 * @param {Document} doc
 * @param {(input: string) => Promise<Response>} [fetchImpl]
 */
export function mountLeaderboard(doc, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const statusEl = doc.getElementById('lb-status');
  const tableEl  = doc.getElementById('lb-table');
  const bodyEl   = doc.getElementById('lb-body');
  const selectEl = doc.getElementById('type-select');

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'lb-status' + (kind ? ' ' + kind : '');
  }

  async function load(martianType) {
    if (!doFetch) return;
    setStatus('Loading…', 'loading');
    if (tableEl) tableEl.style.display = 'none';
    if (bodyEl) bodyEl.replaceChildren();
    let resp;
    try {
      const r = await doFetch(topGenomesUrl(martianType));
      if (!r.ok) {
        let code = String(r.status);
        try {
          const errBody = await r.json();
          code = (errBody && errBody.error && errBody.error.code) || code;
        } catch { /* non-JSON error body */ }
        setStatus(`Error: ${code}`, 'error');
        return;
      }
      resp = await r.json();
    } catch {
      setStatus('api.alienclaw.net not reachable — check back soon.', 'error');
      return;
    }

    const rows = rowsFromResponse(resp);
    if (bodyEl) {
      // Build rows via the DOM (not innerHTML) so response values are inserted
      // as text and can never execute. genomeFull goes in a title attribute.
      const frag = doc.createDocumentFragment();
      for (const row of rows) {
        const tr = doc.createElement('tr');
        if (row.rank === 1) tr.className = 'top1';
        tr.appendChild(td(doc, 'rank', String(row.rank)));
        tr.appendChild(td(doc, 'genome', row.shortHash, row.genomeFull));
        tr.appendChild(td(doc, 'fitness', row.fitness));
        tr.appendChild(td(doc, 'operator', row.leaderboardName));
        tr.appendChild(td(doc, 'generation', row.generation));
        frag.appendChild(tr);
      }
      bodyEl.appendChild(frag);
    }
    setStatus(statusText(resp, rows.length, martianType), '');
    if (tableEl && rows.length > 0) tableEl.style.display = '';
  }

  if (selectEl) {
    selectEl.addEventListener('change', (e) => {
      const t = e && e.target && e.target.value ? e.target.value : DEFAULT_MARTIAN_TYPE;
      load(t);
    });
  }

  return { load };
}

/**
 * Create a <td> with text content (escaped by the DOM) and an optional title.
 * @param {Document} doc
 * @param {string} cls
 * @param {string} text
 * @param {string} [title]
 * @returns {HTMLTableCellElement}
 */
function td(doc, cls, text, title) {
  const cell = doc.createElement('td');
  cell.className = cls;
  cell.textContent = text;
  if (title) cell.title = title;
  return cell;
}

/**
 * Best-effort stats fetch for the summary bar. Fails silently if the server is
 * not reachable (the page must render a useful read-only view regardless).
 * @param {Document} doc
 * @param {(input: string) => Promise<Response>} [fetchImpl]
 */
export async function loadStats(doc, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return;
  try {
    const r = await doFetch(`${API_BASE}/v1/stats`);
    if (!r.ok) return;
    const d = await r.json();
    const set = (id, v) => {
      const el = doc.getElementById(id);
      if (el) el.textContent = (v === null || v === undefined) ? '—' : String(v);
    };
    set('stat-genomes', d.total_genomes);
    set('stat-installs', d.total_installs);
    set('stat-evals', d.total_fitness_evaluations);
  } catch { /* server not yet live — leave placeholders */ }
}

/** Browser entry point. No-op outside a browser (keeps Node imports pure). */
export function init() {
  if (typeof document === 'undefined') return;
  const ui = mountLeaderboard(document);
  loadStats(document);
  if (ui) ui.load(DEFAULT_MARTIAN_TYPE);
}

// Auto-run only in a browser. In Node/vitest, `document` is undefined → no-op.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
