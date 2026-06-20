/**
 * Type declarations for the read-only leaderboard module (leaderboard.js).
 * Hand-written so the page stays plain ES (no build step) while the vitest
 * suite (a .ts file) typechecks its imports under strict mode.
 */

export const API_BASE: string;
export const MARTIAN_TYPES: readonly string[];
export const DEFAULT_MARTIAN_TYPE: string;
export const TOP_N: number;

export interface LeaderboardRow {
  rank: number;
  shortHash: string;
  genomeFull: string;
  leaderboardName: string;
  fitness: string;
  generation: string;
}

export function fnv1a32(str: string): string;
export function shortHash(genome: unknown): string;
export function formatFitness(fitness: unknown): string;
export function formatGeneration(generation: unknown): string;
export function escapeHtml(value: unknown): string;
export function rowsFromResponse(resp: unknown): LeaderboardRow[];
export function statusText(resp: unknown, shown: number, martianType: string): string;
export function renderRowsHtml(rows: LeaderboardRow[]): string;
export function topGenomesUrl(martianType: string, n?: number, base?: string): string;

export function mountLeaderboard(
  doc: Document,
  fetchImpl?: (input: string) => Promise<Response>,
): { load: (martianType: string) => Promise<void> };

export function loadStats(
  doc: Document,
  fetchImpl?: (input: string) => Promise<Response>,
): Promise<void>;

export function init(): void;
