import type { ImageSourcePropType } from 'react-native';
import { BODY_COLORS } from '../../sim/models';
import type { Archetype } from './archetypes';

/**
 * Where rendered sprites live, and the reason nothing else has to change when
 * they arrive.
 *
 * Cars are modelled once in 3D and rendered offline to sprites by
 * `tools/render-sprites`, so the images are a build artifact and the assets you
 * actually own are the `.glb` files. Until a given archetype is rendered this
 * table has no entry for it, `spriteFor` returns `null`, and `CarArt` draws the
 * vector fallback instead.
 *
 * That is the whole stubbing story: art lands one archetype at a time, because a
 * missing entry is a supported state rather than a broken one. Do not add a
 * lookup path that bypasses this function — the fallback is what keeps the game
 * rendering, and code that reaches around it will crash on exactly the archetype
 * nobody has drawn yet.
 *
 * PAINT IS BAKED, NOT TINTED. Every frame is rendered once per entry in
 * `BODY_COLORS`, which is why the lookup takes a colour index. The alternative —
 * one frame tinted at runtime — flattens the shading that makes a sprite read as
 * three-dimensional in the first place, and the whole point of these is the
 * shading. Kenney's kit in particular bakes paint into a shared palette texture
 * rather than a material, so colour variants come from re-rendering against a
 * recoloured atlas; see `tools/render-sprites`.
 *
 * Condition is NOT baked. It is continuous, so baking it would multiply this
 * table by however many buckets we chose. `CarArt` handles it by compositing.
 */

/** Camera angles the game asks for. Top-down is the lot; side is the feed. */
export type CarAngle = 'top' | 'side';

export interface SpriteFrame {
  source: ImageSourcePropType;
  /** Intrinsic size of the frame, so callers can scale without measuring. */
  width: number;
  height: number;
}

/** One frame per body colour, indexed to match `BODY_COLORS`. */
type ColorVariants = readonly SpriteFrame[];

type SpriteTable = Partial<Record<Archetype, Partial<Record<CarAngle, ColorVariants>>>>;

const SPRITES: SpriteTable = {
  // Intentionally empty. See the note above.
};

export function spriteFor(
  archetype: Archetype,
  angle: CarAngle,
  colorIndex: number,
): SpriteFrame | null {
  const variants = SPRITES[archetype]?.[angle];
  if (!variants || variants.length === 0) return null;
  // Wrap the way the rest of the game does, so a colour index that outruns the
  // rendered set falls back to a real frame rather than to nothing.
  return variants[((colorIndex % variants.length) + variants.length) % variants.length] ?? null;
}

/** Which archetypes have art at a given angle. For tooling and diagnostics. */
export function renderedArchetypes(angle: CarAngle): Archetype[] {
  return (Object.keys(SPRITES) as Archetype[]).filter(
    (a) => (SPRITES[a]?.[angle]?.length ?? 0) > 0,
  );
}

/** How many colour variants the pipeline is expected to emit per archetype. */
export const COLOR_VARIANT_COUNT = BODY_COLORS.length;
