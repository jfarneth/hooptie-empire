import type { Archetype } from './archetypes';
import { CAR_BOX_L, CAR_BOX_W } from '../lot/layout';
import { TOP_SHAPES } from './vector/shapes';

/**
 * Where the car actually sits inside its artboard.
 *
 * `RarityTrim` draws spoilers, flares, stripes and underglow over whatever
 * rendered the car, and the two renderers do NOT frame a car the same way.
 * Measured off the shipped frames, the sprite's sedan fills 85% of the artboard
 * width where the vector drawing fills 73%, and a coupe goes the other way — so
 * a single shared footprint would put a spoiler in mid-air on half the
 * catalogue.
 *
 * Everything here is a FRACTION of the artboard, so the same numbers position
 * trim identically at 34px on a small lot and at 220px on the inventory sheet.
 * `x`/`X` and `y`/`Y` are the car's bounding box; the three widths are measured
 * across the car at that fraction of its own length, because the bounding box is
 * generous — it catches wing mirrors and, at twelve degrees of tilt, the flanks
 * — and anything that sits ON the car has to know the row it will land on.
 */
export interface Footprint {
  /** Bounding box of the car within the artboard, as fractions. */
  x: number;
  X: number;
  y: number;
  Y: number;
  /** Body width across the nose, the middle and the tail. */
  hoodW: number;
  midW: number;
  tailW: number;
}

/**
 * Measured from the shipped PNGs by `tools/measure-sprites/measure.js`.
 *
 * Regenerate by running that script and pasting its output. It needs neither
 * Blender nor a Python imaging stack — it reads the committed frames through
 * headless Chromium — so unlike the render pipeline this stays reproducible from
 * a normal checkout.
 *
 * An archetype with no entry falls back to its vector footprint, which is the
 * right answer twice over: an archetype with no sprite is drawn by the vector
 * renderer anyway, and a newly rendered one gets sane-if-imperfect trim rather
 * than none until somebody re-runs the measurement.
 */
const SPRITE_FOOTPRINTS: Partial<Record<Archetype, Footprint>> = {
  coupePremium: { x: 0.156, X: 0.844, y: 0.159, Y: 0.814, hoodW: 0.688, midW: 0.641, tailW: 0.688 },
  hatchEconomy: { x: 0.146, X: 0.859, y: 0.106, Y: 0.861, hoodW: 0.708, midW: 0.714, tailW: 0.708 },
  sedanEconomy: { x: 0.073, X: 0.927, y: 0.128, Y: 0.836, hoodW: 0.74, midW: 0.688, tailW: 0.74 },
  sedanPremium: { x: 0.115, X: 0.885, y: 0.118, Y: 0.851, hoodW: 0.771, midW: 0.714, tailW: 0.771 },
  suvEconomy: { x: 0.099, X: 0.901, y: 0.093, Y: 0.854, hoodW: 0.698, midW: 0.646, tailW: 0.698 },
  suvPremium: { x: 0.036, X: 0.964, y: 0.033, Y: 0.909, hoodW: 0.802, midW: 0.745, tailW: 0.802 },
  truckEconomy: { x: 0.073, X: 0.927, y: 0.068, Y: 0.892, hoodW: 0.74, midW: 0.688, tailW: 0.74 },
  truckPremium: { x: 0.01, X: 0.995, y: 0.005, Y: 0.952, hoodW: 0.854, midW: 0.792, tailW: 0.854 },
  vanEconomy: { x: 0.057, X: 0.943, y: 0.078, Y: 0.879, hoodW: 0.771, midW: 0.714, tailW: 0.771 },
};

/**
 * Derived from the vector renderer's own shape table rather than copied out of
 * it, so the two cannot drift. The body there is a plain rounded rect, so all
 * three widths are the same number.
 */
function vectorFootprint(archetype: Archetype): Footprint {
  const shape = TOP_SHAPES[archetype] ?? TOP_SHAPES.sedanEconomy;
  const w = shape.w / CAR_BOX_W;
  const len = shape.len / CAR_BOX_L;
  return {
    x: (1 - w) / 2,
    X: (1 + w) / 2,
    y: (1 - len) / 2,
    Y: (1 + len) / 2,
    hoodW: w,
    midW: w,
    tailW: w,
  };
}

/** Which renderer drew the car, and therefore which framing the trim must match. */
export type ArtSource = 'sprite' | 'vector';

export function footprintFor(archetype: Archetype, source: ArtSource): Footprint {
  if (source === 'sprite') {
    const measured = SPRITE_FOOTPRINTS[archetype];
    if (measured) return measured;
  }
  return vectorFootprint(archetype);
}
