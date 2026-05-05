/**
 * random-genome.ts — TypeScript runtime genome generator for the Specialist layer.
 *
 * Produces valid 256-char Base62 genomes from a simple LCG so tests are
 * deterministic. Mirrors the structure of Python operators.random_genome().
 */

import { BASE62_ALPHABET, SECTION_SIZE, assembleGenome } from '../registry/genome-codec.js';

function _randomSection(rng: () => number, idTag?: string): string {
  const chars: string[] = [];
  if (idTag) {
    const tag = idTag.slice(0, 8).padEnd(8, '0');
    for (const c of tag) chars.push(BASE62_ALPHABET.includes(c) ? c : '0');
  }
  while (chars.length < SECTION_SIZE) {
    const idx = Math.floor(rng() * BASE62_ALPHABET.length);
    chars.push(BASE62_ALPHABET[idx]!);
  }
  return chars.join('').slice(0, SECTION_SIZE);
}

/** Simple seedable LCG — deterministic for tests without a library dependency. */
function _makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Generate a valid random genome.
 *
 * @param idTag   8-char Base62 Martian ID tag placed at start of IDENTITY section
 * @param seed    Optional numeric seed for determinism (default: Date.now())
 */
export function randomGenome(idTag: string = 'SPEC0001', seed: number = Date.now()): string {
  const rng = _makeLcg(seed);
  const identity  = _randomSection(rng, idTag);
  const execution = _randomSection(rng);
  const behavior  = _randomSection(rng);
  return assembleGenome(identity, execution, behavior);
}
