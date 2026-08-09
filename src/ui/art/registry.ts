import type { ImageSourcePropType } from 'react-native';
import type { Archetype } from './archetypes';

/**
 * Where rendered sprites will live, and the reason nothing has to change when
 * they arrive.
 *
 * The plan (see `docs/ui-3d-plan.md`) is that cars are modelled once in 3D and
 * rendered offline to a sprite atlas by a script in the repo — so the images are
 * a build artifact, and the assets you actually own are the `.glb` files. Until
 * that pipeline exists this table is empty, `spriteFor` returns `null`, and
 * `CarArt` draws the vector fallback instead.
 *
 * That is the whole stubbing story: art can land one archetype at a time,
 * because a missing entry is a supported state rather than a broken one. There
 * is never a half-migrated build.
 *
 * WHEN SPRITES ARRIVE: fill `SPRITES` with `require()`d images per archetype and
 * angle. Do not add a lookup path that bypasses this function — the fallback is
 * what keeps the game rendering, and code that reaches around it will crash on
 * exactly the archetype nobody has drawn yet.
 */

/** Camera angles the game asks for. Top-down is the lot; side is the feed. */
export type CarAngle = 'top' | 'side';

export interface SpriteFrame {
  source: ImageSourcePropType;
  /** Intrinsic size of the frame, so callers can scale without measuring. */
  width: number;
  height: number;
}

type SpriteTable = Partial<Record<Archetype, Partial<Record<CarAngle, SpriteFrame>>>>;

const SPRITES: SpriteTable = {
  // Intentionally empty. See the note above.
};

export function spriteFor(archetype: Archetype, angle: CarAngle): SpriteFrame | null {
  return SPRITES[archetype]?.[angle] ?? null;
}

/** Whether any real art exists yet, for anything that wants to report it. */
export function hasSprites(): boolean {
  return Object.keys(SPRITES).length > 0;
}
