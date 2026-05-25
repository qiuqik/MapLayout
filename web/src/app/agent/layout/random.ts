export type RandomSource = () => number;

/**
 * Mulberry32 provides a compact deterministic source for comparable layout runs.
 */
export function createSeededRandom(seed: number): RandomSource {
  let state = (Math.trunc(seed) >>> 0) || 1;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
