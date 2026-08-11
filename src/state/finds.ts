import { retailValue } from '../sim/economy';
import { rarityRank } from '../sim/rarity';
import type { Car, GameState } from '../sim/types';

/**
 * What the retainer buyer turned up while the app was closed.
 *
 * Pure, and deliberately kept out of `store.ts`: the store reaches for
 * AsyncStorage the moment it is imported, and this is the one piece of the away
 * summary with a rule in it worth testing.
 */

/** One card in the away-summary carousel. */
export interface SpecialFind {
  car: Car;
  /** What the buyer paid — the ask, which was priced in stock trim. */
  paid: number;
  /** What it is worth now. The gap is the trim premium. */
  worth: number;
}


/**
 * The graded cars bought during the absence and still on the lot.
 *
 * Found by acquisition time rather than by a new event kind, because the state
 * from before catch-up and the state after it are both right here — no save
 * data, no SimEvent, nothing in `src/sim` at all.
 *
 * Deliberately only cars still HELD. One bought and sold while away is gone from
 * `cars` by the time anyone looks, and a card for a car the player never saw and
 * no longer owns would be a trophy for something that is not there. Rare is
 * excluded: at roughly one every eight minutes it is a good day, not news.
 */
export function specialFinds(before: GameState, after: GameState): SpecialFind[] {
  return after.cars
    .filter(
      (c) =>
        c.status !== 'sold' &&
        c.acquiredAt >= before.t &&
        rarityRank(c.rarity) >= rarityRank('epic'),
    )
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || b.acquiredAt - a.acquiredAt)
    .map((car) => ({ car, paid: car.costBasis, worth: retailValue(car) }));
}

