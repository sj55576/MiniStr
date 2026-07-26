/** A reproducible 32-bit LCG used for combat variance and replay-safe randomness. */
export function nextRandom(seed: number): { seed: number; value: number } {
  const next = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
  return { seed: next, value: next / 0x1_0000_0000 };
}

