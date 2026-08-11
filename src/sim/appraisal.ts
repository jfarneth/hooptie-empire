import { clamp01, retailValue, wholesaleValue } from './economy';
import type { Car, Listing } from './types';

/**
 * What a car on the feed *looks* like worth.
 *
 * A specific car's true condition is the seller's private information. The deal
 * sheet shows exact expected value and exact default odds for financing because
 * those are long-run properties a dealer genuinely learns across a thousand
 * contracts; how tired this particular Corolla is underneath is not one of
 * them. That is the same line the rest of the UI already draws, applied to the
 * one surface that had been getting a free pass.
 *
 * The listing stores a *noise draw*, not an estimate. Everything here is a pure
 * function of that draw and the current Buying level, which is what lets a
 * level-up sharpen the whole feed at once with nothing to re-roll and no RNG
 * consumed outside listing spawn.
 *
 * The estimate is unbiased: it is as likely to flatter a car as to malign it.
 * A rookie who systematically over-estimates would be a different mechanic —
 * one that punishes new players rather than one that asks them to judge.
 */

/** Condition as it appears on the feed. `sigma` is 1σ of error in condition points. */
export function estimatedCondition(listing: Listing, sigma: number): number {
  return clamp01(listing.car.condition + listing.appraisalNoise * sigma);
}

/** The car as the feed presents it: real in every respect except condition. */
export function appraisedCar(listing: Listing, sigma: number): Car {
  return { ...listing.car, condition: estimatedCondition(listing, sigma) };
}

export function estimatedRetail(listing: Listing, sigma: number): number {
  return retailValue(appraisedCar(listing, sigma));
}

export function estimatedWholesale(listing: Listing, sigma: number): number {
  return wholesaleValue(appraisedCar(listing, sigma));
}

/**
 * What it is worth if the car is at the bad end of what you can see.
 *
 * This is the number anything spending money unattended should use. A retainer
 * buyer working from the midpoint would be making the player's gamble for them
 * without the player's judgement; working from the floor, it only takes deals
 * that survive being wrong.
 */
export function pessimisticWholesale(listing: Listing, sigma: number): number {
  const condition = clamp01(estimatedCondition(listing, sigma) - sigma);
  return wholesaleValue({ ...listing.car, condition });
}

/**
 * Retail at the bad end of the band — `appraisalBand(...).low`, named for what
 * the retainer buyer actually asks: "if this car is as rough as it could
 * plausibly be, what would it still sell for?"
 */
export function pessimisticRetail(listing: Listing, sigma: number): number {
  const condition = clamp01(estimatedCondition(listing, sigma) - sigma);
  return retailValue({ ...listing.car, condition });
}

/**
 * The ±1σ range the UI should quote.
 *
 * Honest by construction: the band shown really is the error distribution, so
 * the game never misrepresents how much it does not know.
 */
export function appraisalBand(
  listing: Listing,
  sigma: number,
): { low: number; high: number; exact: boolean } {
  const est = estimatedCondition(listing, sigma);
  return {
    low: retailValue({ ...listing.car, condition: clamp01(est - sigma) }),
    high: retailValue({ ...listing.car, condition: clamp01(est + sigma) }),
    // At a tight enough band there is nothing left to hedge about, and a range
    // of one number reads as clutter.
    exact: sigma <= 0.005,
  };
}

/**
 * Signed appraisal error in condition points: positive means it looked better
 * than it was. Only meaningful once the car is bought and the truth is out.
 */
export function appraisalError(listing: Listing, sigma: number): number {
  return estimatedCondition(listing, sigma) - listing.car.condition;
}
