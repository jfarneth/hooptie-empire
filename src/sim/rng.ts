import type { RngState } from './types';

export type { RngState };

/**
 * mulberry32 — small, fast, good enough for a game economy, and crucially its
 * entire state is one uint32 so it round-trips through JSON without loss.
 *
 * The generator state lives inside GameState, which means a save file replays
 * identically and offline catch-up cannot be re-rolled by reloading.
 *
 * These functions MUTATE the passed state. The engine clones state once per
 * advance() call; mutating inside the step loop is what keeps 8h of catch-up
 * affordable.
 */
export function nextU32(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) | 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform in [0, 1). */
export function nextFloat(rng: RngState): number {
  return nextU32(rng) / 4294967296;
}

/** Uniform in [min, max). */
export function range(rng: RngState, min: number, max: number): number {
  return min + nextFloat(rng) * (max - min);
}

/** Uniform integer in [min, max]. */
export function intRange(rng: RngState, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}

/** True with probability p. */
export function chance(rng: RngState, p: number): boolean {
  return nextFloat(rng) < p;
}

export function pick<T>(rng: RngState, items: readonly T[]): T {
  return items[Math.floor(nextFloat(rng) * items.length)];
}

/**
 * Weighted pick. `weights` must be the same length as `items` and sum > 0.
 */
export function pickWeighted<T>(
  rng: RngState,
  items: readonly T[],
  weights: readonly number[],
): T {
  let total = 0;
  for (const w of weights) total += w;
  let roll = nextFloat(rng) * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Approximately normal, clamped to [min, max]. Used for mileage and condition spread. */
export function normalish(
  rng: RngState,
  mean: number,
  spread: number,
  min: number,
  max: number,
): number {
  const n = (nextFloat(rng) + nextFloat(rng) + nextFloat(rng)) / 3; // ~centred on 0.5
  const v = mean + (n - 0.5) * 2 * spread;
  return Math.min(max, Math.max(min, v));
}

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}
