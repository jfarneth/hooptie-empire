import type { Archetype } from './archetypes';
import { CAR_BOX_L, CAR_BOX_W } from '../lot/layout';
import type { CarAngle } from './registry';
import { SPRITE_AXES, SPRITE_FOOTPRINTS } from './sprites/geometry';
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
 * across the frame at that fraction of the way DOWN the car, because the
 * bounding box is generous — it catches wing mirrors and, at any real tilt, the
 * flanks — and anything that sits ON the car has to know the row it will land
 * on.
 *
 * "Down the car" means different things at the two angles, and the field names
 * are honest about only one of them. In a top-down frame the car's length runs
 * down the screen, so the three widths really are the nose, the middle and the
 * tail. In a three-quarter frame the length runs ACROSS the screen, so the same
 * three numbers are the width at roof height, at the belt line and down at the
 * sills. Both are the useful measurement for the angle they come from — a
 * spoiler on a plan view needs the tail's width, and a stripe on a hero shot
 * needs the belt line's — which is why one measurement serves both rather than
 * the two angles growing separate shapes.
 */
export interface Footprint {
  /** Bounding box of the car within the artboard, as fractions. */
  x: number;
  X: number;
  y: number;
  Y: number;
  /** Width across the frame at three stations down the car. See above. */
  hoodW: number;
  midW: number;
  tailW: number;
}

/** A point or a displacement on the artboard, in fractions of it. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Which way a car's own axes point on its artboard.
 *
 * A footprint is a bounding box, and a bounding box is enough to place trim on
 * a plan view because a plan view has barely any projection to speak of: the
 * car's length runs down the frame and its width runs across it. On the
 * three-quarter side frames neither is true — the length runs diagonally, "up"
 * is a different diagonal, and a spoiler positioned by fractions of a bounding
 * box lands in the air beside the boot.
 *
 * So the renderer hands the overlay the projection itself, which is the same
 * trade `camera.ts` makes with the ground plate. `anchor` is where the car's
 * footprint centre sits on the artboard; the three vectors are the displacement
 * from there to the NOSE, to the near flank, and to roof height. Anything that
 * sits on the car is then placed in the car's own space — "at the tail, at deck
 * height, a third of the way out to the flank" — and projected, rather than
 * guessed at in the frame's.
 */
export interface FrameAxes {
  anchor: Vec2;
  length: Vec2;
  width: Vec2;
  up: Vec2;
  /**
   * The car's roofline: how tall it is at each station along its length, as a
   * fraction of its own height, sampled nose to tail.
   *
   * A racing stripe runs over the bonnet, the roof and the boot lid, and those
   * are three different heights on every body in the catalogue. The plan view
   * never had to care — from overhead a stripe is on the car wherever the car
   * is — but on a three-quarter shot height is the whole of what puts it on the
   * paintwork rather than in the air above it.
   */
  profile: number[];
}

/**
 * MEASURED AT RENDER TIME, by the run that produced the frame.
 *
 * These used to be measured by a separate pass over the committed PNGs and
 * pasted in here by hand, which works and leaves one failure mode wide open:
 * re-render the frames, forget the paste, and every spoiler in the game sits a
 * few percent off the car it is bolted to, on every screen, with nothing
 * failing. `tools/render-cars` writes `sprites/footprints.ts` in the same pass
 * that writes the PNGs, so a number cannot go stale against the frame it
 * describes. `tools/measure-sprites` still exists and still agrees to the
 * digit — the two use one thresholding rule on purpose — for frames this
 * pipeline did not produce.
 */
function measured(archetype: Archetype, angle: CarAngle): Footprint | null {
  return SPRITE_FOOTPRINTS[angle]?.[archetype] ?? null;
}

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

/**
 * The top-down footprint, for whichever renderer drew the car.
 *
 * An archetype with no rendered frame falls back to its vector footprint, which
 * is the right answer twice over: an archetype with no sprite is drawn by the
 * vector renderer anyway, and a newly rendered one gets sane-if-imperfect trim
 * rather than none until somebody re-runs the pipeline.
 */
export function footprintFor(archetype: Archetype, source: ArtSource): Footprint {
  if (source === 'sprite') {
    const fp = measured(archetype, 'top');
    if (fp) return fp;
  }
  return vectorFootprint(archetype);
}

/**
 * The footprint of a rendered frame at any angle, or `null` when there is none.
 *
 * Separate from `footprintFor` rather than an angle argument on it, because
 * there is no vector fallback to offer: the vector side drawing is a flat
 * elevation and the rendered side frame is a three-quarter shot, and the two
 * are not different framings of one picture the way the top-down pair are.
 * Trim over the vector elevation is anchored off `SIDE_SHAPES` instead, which
 * is the shape table that drew it.
 */
export function spriteFootprint(archetype: Archetype, angle: CarAngle): Footprint | null {
  return measured(archetype, angle);
}

/** The car's own axes on a rendered frame, or `null` when there is no frame. */
export function frameAxes(archetype: Archetype, angle: CarAngle): FrameAxes | null {
  return SPRITE_AXES[angle]?.[archetype] ?? null;
}
