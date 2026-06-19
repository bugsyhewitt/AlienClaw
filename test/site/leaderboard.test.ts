/**
 * Headless tests for the read-only leaderboard page (site/leaderboard.{html,js}).
 *
 * The page is a pure consumer of GET /v1/genomes/top. These tests exercise the
 * page's render/transform logic against a *stub* top-genomes response shaped
 * exactly like handleTopGenomes' output (src/alienclaw/api/handlers/genomes.ts),
 * plus a static structural check of the HTML. No DOM library, no browser, no
 * server, no network — runs entirely in Node under vitest.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  fnv1a32,
  shortHash,
  formatFitness,
  formatGeneration,
  escapeHtml,
  rowsFromResponse,
  statusText,
  renderRowsHtml,
  topGenomesUrl,
  MARTIAN_TYPES,
  DEFAULT_MARTIAN_TYPE,
  TOP_N,
  API_BASE,
  type LeaderboardRow,
} from '../../site/leaderboard.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../site');

// Real 256-char Base62 genomes from the cross-language contract fixtures. All
// three `compute_*` genomes share the leading `COMPUT01G1AlienClaw1` prefix —
// ideal for proving the short-hash is a hash, not a prefix slice.
const FIXTURES = JSON.parse(
  readFileSync(resolve(HERE, '../fixtures/api-contract-fixtures.json'), 'utf8'),
) as { valid_genomes: Record<string, string> };

const GENOME_A = FIXTURES.valid_genomes['compute_a'];
const GENOME_B = FIXTURES.valid_genomes['compute_b'];
const GENOME_C = FIXTURES.valid_genomes['compute_c'];

/**
 * A stub response identical in shape to what handleTopGenomes returns:
 *   { martian_type, genomes: GenomeEntry[], total_for_type }
 * Entries are pre-ranked by fitness descending (as the server returns them).
 * Note: entry 2 deliberately omits `generation` (undefined when the submitter
 * did not include run_metadata.generation).
 */
function stubTopResponse() {
  return {
    martian_type: 'compute',
    total_for_type: 137,
    genomes: [
      {
        genome: GENOME_A,
        fitness: 0.9876,
        submission_id: '11111111-1111-1111-1111-111111111111',
        submitted_at: '2026-06-18T12:00:00.000Z',
        leaderboard_name: 'ALIENBOT',
        generation: 12,
      },
      {
        genome: GENOME_B,
        fitness: 0.8123,
        submission_id: '22222222-2222-2222-2222-222222222222',
        submitted_at: '2026-06-18T11:00:00.000Z',
        leaderboard_name: 'CLAWZERO',
        // generation intentionally absent
      },
      {
        genome: GENOME_C,
        fitness: 0.5,
        submission_id: '33333333-3333-3333-3333-333333333333',
        submitted_at: '2026-06-18T10:00:00.000Z',
        leaderboard_name: 'REDPLANE',
        generation: 0,
      },
    ],
  };
}

// ── fnv1a32 / shortHash ──────────────────────────────────────────────────────

describe('shortHash', () => {
  it('fnv1a32 returns a fixed 8-hex-char string', () => {
    expect(fnv1a32(GENOME_A)).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a32('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic across calls', () => {
    expect(shortHash(GENOME_A)).toBe(shortHash(GENOME_A));
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'));
  });

  it('has the g- prefix and 8 hex chars', () => {
    expect(shortHash(GENOME_A)).toMatch(/^g-[0-9a-f]{8}$/);
  });

  it('is a hash, not a prefix: genomes sharing a long prefix differ', () => {
    // GENOME_A/B/C share the first 20 chars; a prefix slice would collide.
    expect(GENOME_A.slice(0, 20)).toBe(GENOME_B.slice(0, 20));
    expect(GENOME_A.slice(0, 20)).toBe(GENOME_C.slice(0, 20));
    const a = shortHash(GENOME_A);
    const b = shortHash(GENOME_B);
    const c = shortHash(GENOME_C);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('handles missing / non-string genome with a sentinel', () => {
    expect(shortHash(undefined)).toBe('g-????????');
    expect(shortHash(null)).toBe('g-????????');
    expect(shortHash('')).toBe('g-????????');
    expect(shortHash(42 as unknown)).toBe('g-????????');
  });
});

// ── formatFitness / formatGeneration ─────────────────────────────────────────

describe('formatFitness', () => {
  it('renders 4 decimal places', () => {
    expect(formatFitness(0.9876)).toBe('0.9876');
    expect(formatFitness(1)).toBe('1.0000');
    expect(formatFitness(0)).toBe('0.0000');
    expect(formatFitness(0.5)).toBe('0.5000');
  });
  it('renders an em dash for non-numeric input', () => {
    expect(formatFitness(undefined)).toBe('—');
    expect(formatFitness(null)).toBe('—');
    expect(formatFitness('not-a-number')).toBe('—');
    expect(formatFitness(NaN)).toBe('—');
  });
});

describe('formatGeneration', () => {
  it('renders integer generations including zero', () => {
    expect(formatGeneration(0)).toBe('0');
    expect(formatGeneration(12)).toBe('12');
    expect(formatGeneration(999)).toBe('999');
  });
  it('renders an em dash when absent or invalid', () => {
    expect(formatGeneration(undefined)).toBe('—');
    expect(formatGeneration(null)).toBe('—');
    expect(formatGeneration(-1)).toBe('—');
    expect(formatGeneration(1.5)).toBe('—');
    expect(formatGeneration('x')).toBe('—');
  });
});

// ── rowsFromResponse (the core transform against the stub) ───────────────────

describe('rowsFromResponse', () => {
  it('maps a stub /v1/genomes/top response into ranked rows', () => {
    const rows = rowsFromResponse(stubTopResponse());
    expect(rows).toHaveLength(3);

    expect(rows[0]).toEqual<LeaderboardRow>({
      rank: 1,
      shortHash: shortHash(GENOME_A),
      genomeFull: GENOME_A,
      leaderboardName: 'ALIENBOT',
      fitness: '0.9876',
      generation: '12',
    });
    // rank is response order (server returns ranked desc)
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.leaderboardName)).toEqual(['ALIENBOT', 'CLAWZERO', 'REDPLANE']);
    expect(rows.map((r) => r.fitness)).toEqual(['0.9876', '0.8123', '0.5000']);
  });

  it('renders generation as em dash when absent and "0" when zero', () => {
    const rows = rowsFromResponse(stubTopResponse());
    expect(rows[1].generation).toBe('—'); // omitted by submitter
    expect(rows[2].generation).toBe('0'); // present and zero
  });

  it('returns [] for an empty board', () => {
    expect(rowsFromResponse({ martian_type: 'compute', genomes: [], total_for_type: 0 })).toEqual([]);
  });

  it('is defensive against a garbled body', () => {
    expect(rowsFromResponse(undefined)).toEqual([]);
    expect(rowsFromResponse(null)).toEqual([]);
    expect(rowsFromResponse({})).toEqual([]);
    expect(rowsFromResponse({ genomes: 'nope' })).toEqual([]);
    // malformed individual entries do not throw
    const rows = rowsFromResponse({ genomes: [null, {}, { fitness: 'x' }] });
    expect(rows).toHaveLength(3);
    expect(rows[0].shortHash).toBe('g-????????');
    expect(rows[0].leaderboardName).toBe('—');
    expect(rows[0].fitness).toBe('—');
  });

  it('rejects leaderboard names that are not ^[A-Z]{8}$', () => {
    const rows = rowsFromResponse({
      genomes: [
        { genome: GENOME_A, fitness: 0.5, leaderboard_name: 'lowercase' },
        { genome: GENOME_B, fitness: 0.5, leaderboard_name: 'TOOLONGGG' },
        { genome: GENOME_C, fitness: 0.5, leaderboard_name: 'OKVALIDX' },
      ],
    });
    expect(rows.map((r) => r.leaderboardName)).toEqual(['—', '—', 'OKVALIDX']);
  });
});

// ── statusText ───────────────────────────────────────────────────────────────

describe('statusText', () => {
  it('reports total and shown count (plural)', () => {
    expect(statusText({ total_for_type: 137 }, 3, 'compute')).toBe('137 genomes — showing top 3');
  });
  it('uses singular for a total of one', () => {
    expect(statusText({ total_for_type: 1 }, 1, 'compute')).toBe('1 genome — showing top 1');
  });
  it('reports an empty board', () => {
    expect(statusText({ total_for_type: 0 }, 0, 'web_search')).toBe('No genomes submitted yet for web_search.');
  });
  it('falls back to shown count when total is missing', () => {
    expect(statusText({}, 2, 'compute')).toBe('2 genomes — showing top 2');
  });
});

// ── topGenomesUrl (request contract) ─────────────────────────────────────────

describe('topGenomesUrl', () => {
  it('uses the n= query param (matching the server route) and default base', () => {
    const url = topGenomesUrl('compute');
    expect(url).toBe(`${API_BASE}/v1/genomes/top?martian_type=compute&n=${TOP_N}`);
  });
  it('URL-encodes the martian type', () => {
    expect(topGenomesUrl('search text')).toContain('martian_type=search%20text');
  });
  it('honours an explicit base and n', () => {
    expect(topGenomesUrl('compute', 5, 'http://localhost:9999')).toBe(
      'http://localhost:9999/v1/genomes/top?martian_type=compute&n=5',
    );
  });
});

// ── escapeHtml + renderRowsHtml (XSS safety + stub render) ────────────────────

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<script>"x"&'y'`)).toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
  });
});

describe('renderRowsHtml', () => {
  it('renders five cells per row in contract order', () => {
    const html = renderRowsHtml(rowsFromResponse(stubTopResponse()));
    expect(html).toContain('<td class="rank">1</td>');
    expect(html).toContain(`<td class="genome" title="${GENOME_A}">${shortHash(GENOME_A)}</td>`);
    expect(html).toContain('<td class="fitness">0.9876</td>');
    expect(html).toContain('<td class="operator">ALIENBOT</td>');
    expect(html).toContain('<td class="generation">12</td>');
    // top-ranked row gets the highlight class
    expect(html).toContain('<tr class="top1">');
  });

  it('NEVER emits an unescaped tag from an untrusted response value', () => {
    // A hostile endpoint returns a genome/operator containing markup. Even
    // though the live server validates these, the page must not trust them.
    const hostile = rowsFromResponse({
      genomes: [
        {
          genome: '<img src=x onerror=alert(1)>',
          fitness: 0.5,
          leaderboard_name: '<script>', // invalid per regex → becomes em dash anyway
        },
      ],
    });
    const html = renderRowsHtml(hostile);
    // No live tag is ever emitted from response values: every '<' / '>' that
    // came from the response is escaped, so no element can be parsed out of it.
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    // The hostile genome reaches output only inside an *escaped* title attribute
    // (inert text), and the visible cell shows the derived short-hash, not the
    // raw genome — so even the escaped markup is not the user-visible value.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // visible genome cell value is the derived short-hash, not the raw genome
    expect(html).toMatch(/<td class="genome"[^>]*>g-[0-9a-f]{8}<\/td>/);
    // Sanity: the only '<'/'>' characters in the output belong to OUR markup
    // (the tags we generate), never to escaped response content.
    expect(html).not.toMatch(/<img|<script|<svg|<iframe/i);
  });

  it('renders the whole stub board (page-renders-against-stub gate)', () => {
    const rows = rowsFromResponse(stubTopResponse());
    const html = renderRowsHtml(rows);
    // three rows, each operator present, each fitness present
    expect(html.match(/<tr/g)).toHaveLength(3);
    for (const op of ['ALIENBOT', 'CLAWZERO', 'REDPLANE']) {
      expect(html).toContain(op);
    }
    for (const f of ['0.9876', '0.8123', '0.5000']) {
      expect(html).toContain(f);
    }
  });
});

// ── module surface ───────────────────────────────────────────────────────────

describe('module constants', () => {
  it('surfaces the eight primary martian types with compute as default', () => {
    expect(MARTIAN_TYPES).toHaveLength(8);
    expect(MARTIAN_TYPES).toContain('compute');
    expect(MARTIAN_TYPES).toContain('extract_json');
    expect(MARTIAN_TYPES).not.toContain('compute_alone');
    expect(DEFAULT_MARTIAN_TYPE).toBe('compute');
    expect(MARTIAN_TYPES).toContain(DEFAULT_MARTIAN_TYPE);
  });
  it('defaults TOP_N within the server clamp [1, 100]', () => {
    expect(TOP_N).toBeGreaterThanOrEqual(1);
    expect(TOP_N).toBeLessThanOrEqual(100);
  });
});

// ── static HTML structure ────────────────────────────────────────────────────

describe('leaderboard.html structure', () => {
  const html = readFileSync(resolve(SITE, 'leaderboard.html'), 'utf8');

  it('starts with a doctype (CI structural check)', () => {
    expect(html.slice(0, 60).toLowerCase()).toContain('<!doctype html');
  });

  it('declares all five required table columns in contract order', () => {
    const headerBlock = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
    const cols = [...headerBlock.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1].trim());
    expect(cols).toEqual(['#', 'Genome', 'Fitness', 'Operator', 'Gen']);
  });

  it('includes the VISION.md environmental thesis blurb', () => {
    expect(html).toContain('Less compute is better compute.');
    expect(html).toContain('selects against sprawl');
    expect(html).toContain('VISION.md');
  });

  it('wires the leaderboard.js module via a relative import (no external src)', () => {
    expect(html).toContain('./leaderboard.js');
    // CI forbids external script/CSS — assert none present on this page
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href="https?:\/\/[^"]+\.css/);
  });

  it('lists the eight primary martian types in the type selector', () => {
    const selectBlock = html.slice(html.indexOf('<select'), html.indexOf('</select>'));
    for (const t of MARTIAN_TYPES) {
      expect(selectBlock).toContain(`value="${t}"`);
    }
  });

  it('does not interpolate response values via innerHTML string building', () => {
    // The page imports the module; the DOM-building path uses textContent.
    // Guard against a regression that reintroduces innerHTML templating.
    expect(html).not.toContain('.innerHTML');
  });
});
