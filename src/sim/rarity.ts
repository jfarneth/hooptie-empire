import { BALANCE } from './balance';
import { nextFloat } from './rng';
import type { Car, Rarity, RngState } from './types';

/**
 * Trim grades, and the one thing they change.
 *
 * A rarer car is worth more at retail. The seller does not charge for it —
 * `spawnListing` prices the ask against `baseTrim(car)` — so the whole premium
 * lands on the dealer's side of the deal. That asymmetry IS the feature; the
 * two halves of it are one line each and they live nowhere else.
 *
 * RARITY IS PUBLIC INFORMATION. You can see a spoiler, a lift kit and a bar of
 * neon under the sill, so unlike condition it carries no appraisal noise and no
 * band: `appraisedCar` passes it through untouched and `appraisal.ts` never
 * mentions it. That keeps the line the rest of the game already draws between
 * what an operator could know and what they could not — and it is what makes a
 * rare car a decision (is it worth the lot slot?) rather than a lottery.
 *
 * The value multiplier is applied inside `conditionFreeValue`, which is already
 * the correct basis for anything that scales with how much car is present. That
 * one placement means retail, wholesale, the finance window, recon cost, recon
 * value gain, the forced-sale haircut and the traffic reference all price rarity
 * correctly with no second call site. Recon ROI in particular comes out
 * unchanged, because cost and value gain scale together — a lift kit does not
 * make bodywork a better or worse investment, and it should not.
 */

/**
 * Worst to best. Index in this array is the grade's rank, and rank is what the
 * value multiplier is derived from — so a fifth grade is one entry here and one
 * probability in `BALANCE.rarity`, with no other edits.
 */
export const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export interface RarityDef {
  id: Rarity;
  /**
   * What goes on the window sticker. Empty for common, because a stock car is
   * just a car and badging it "COMMON" would put a label on nine cars in ten to
   * say nothing.
   *
   * These are trim names rather than the grade ids on purpose: the game's voice
   * is American used-car, not RPG loot, and "EPIC" next to chips reading LOOKS
   * CHEAP and UNDER WHOLESALE is a jarring register shift. The top grade steps
   * out of the badge vocabulary entirely — a spoiler AND stripes AND neon
   * underglow is not a factory car, so lot slang is the honest register for it.
   */
  badge: string;
  /** The grade itself, for anywhere that has to name the tier rather than the trim. */
  name: string;
}

export const RARITIES: Record<Rarity, RarityDef> = {
  common: { id: 'common', badge: '', name: 'Common' },
  rare: { id: 'rare', badge: 'Sport', name: 'Rare' },
  epic: { id: 'epic', badge: 'Special Edition', name: 'Epic' },
  legendary: { id: 'legendary', badge: 'Unicorn', name: 'Legendary' },
};

/** Position on the ladder: 0 for common, 3 for legendary. */
export function rarityRank(rarity: Rarity): number {
  const rank = RARITY_ORDER.indexOf(rarity);
  // A grade this build does not know reads as stock rather than throwing. Save
  // data can outlive a build; a car should never become unrenderable.
  return rank < 0 ? 0 : rank;
}

/**
 * What this grade multiplies the car's value by.
 *
 * Linear in rank rather than compounding, so `valueStep` reads as exactly what
 * it is: each grade is worth ten percent of the car more than the one below.
 */
export function rarityValueMult(rarity: Rarity): number {
  return 1 + rarityRank(rarity) * BALANCE.rarity.valueStep;
}

/**
 * Roll a grade for a car coming off the feed.
 *
 * ONE DRAW, ALWAYS, whatever comes back. `generateCar` is on the replay path,
 * so a conditional draw would make the stream depend on its own output and
 * offline catch-up would stop reproducing.
 *
 * Tested from the rarest end down so that adding a grade later shifts only the
 * boundary it introduces, rather than renumbering every threshold.
 */
export function rollRarity(rng: RngState): Rarity {
  const { legendaryChance, epicChance, rareChance } = BALANCE.rarity;
  const roll = nextFloat(rng);
  if (roll < legendaryChance) return 'legendary';
  if (roll < legendaryChance + epicChance) return 'epic';
  if (roll < legendaryChance + epicChance + rareChance) return 'rare';
  return 'common';
}

/**
 * The same car in stock trim.
 *
 * What the seller is pricing. A dealer auction does not pay extra for a spoiler
 * and neither does a wholesale book, so the ask is drawn against this and the
 * premium is left on the table for whoever spots it.
 *
 * Returns the car itself when there is nothing to strip, so the common path —
 * nine listings in ten — allocates nothing.
 */
export function baseTrim(car: Car): Car {
  return car.rarity === 'common' ? car : { ...car, rarity: 'common' };
}

/**
 * What the seller wants, as a multiple of the stock-trim value.
 *
 * `capture` is the share of the premium they price in — see
 * `StageSourcing.raritySellerCapture`. At 0 this is 1 and the ask is blind to
 * the grade; at 1 it is the full value multiplier and the trim is worth nothing.
 * In between it is linear in the premium, which is the only reading of "half the
 * trim is priced in" that anybody would guess.
 */
export function rarityAskMult(rarity: Rarity, capture: number): number {
  if (capture <= 0) return 1;
  const mult = rarityValueMult(rarity);
  return 1 + Math.min(1, capture) * (mult - 1);
}
