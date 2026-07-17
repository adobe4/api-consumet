/**
 * Tiny deterministic PRNG (mulberry32). A seed makes "random" animation and
 * transition choices reproducible, which keeps renders and tests stable.
 * When no seed is given, choices are seeded from the clock (non-deterministic).
 */
export function makeRng(seed?: number): () => number {
  let a = (seed ?? (Date.now() & 0xffffffff)) >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
