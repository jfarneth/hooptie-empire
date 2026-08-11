import { BALANCE } from './balance';
import { getModel } from './models';
import { rarityValueMult } from './rarity';
import type { Car } from './types';

/**
 * Valuation. Everything the player earns or pays traces back through here, so
 * these curves are the real difficulty knobs of the game.
 */

/**
 * Miles knock value down on an exponential curve, not a straight line.
 *
 * This matters more than it looks. A linear slide to zero makes high-mileage
 * cars nearly worthless, which quietly kills the entire curbstoner stage — the
 * 180k-mile beater is the whole inventory at that point. Exponential decay keeps
 * tired cars cheap but tradeable, which is both how the real market behaves and
 * what makes the opening loop playable.
 */
export function mileageFactor(mileage: number): number {
  const decayed = Math.exp(-mileage / BALANCE.mileageDecayScale);
  return Math.max(BALANCE.mileageFloor, decayed);
}

/** A rough car is worth `conditionFloorFactor` of an identical clean one. */
export function conditionFactor(condition: number): number {
  const floor = BALANCE.conditionFloorFactor;
  return floor + (1 - floor) * clamp01(condition);
}

/**
 * What this car would be worth in showroom condition — value with the condition
 * term factored out.
 *
 * This is the correct basis for anything that scales with "how much car is
 * here": both the value a point of condition adds and the cost of adding it.
 * Pricing recon off the model's base value instead makes bodywork on a
 * 200k-mile beater cost as much as bodywork on a new one, which silently makes
 * reconditioning a trap on every car in the opening stage.
 *
 * Trim grade belongs here for exactly that reason, and it is the ONLY place the
 * rarity multiplier is applied. Retail, wholesale, the finance window, recon
 * cost, recon value gain and the forced-sale haircut all compose from this, so
 * one multiply prices a spoiler correctly everywhere. It also keeps recon ROI
 * flat across grades — cost and value gain scale together — which is right: a
 * lift kit does not make bodywork a better or worse investment.
 */
export function conditionFreeValue(car: Car): number {
  const model = getModel(car.modelId);
  const repoPenalty = Math.max(0.5, 1 - car.repoCount * BALANCE.repoValuePenalty);
  return model.baseValue * mileageFactor(car.mileage) * repoPenalty * rarityValueMult(car.rarity);
}

/** What the car will actually fetch in a straight cash sale. */
export function retailValue(car: Car): number {
  return Math.round(conditionFreeValue(car) * conditionFactor(car.condition));
}

/** Dollars of retail value one point of condition is worth on this car. */
export function valuePerConditionPoint(car: Car): number {
  return conditionFreeValue(car) * (1 - BALANCE.conditionFloorFactor);
}

/** What it is worth to a wholesaler — what you should be paying for it. */
export function wholesaleValue(car: Car): number {
  return Math.round(retailValue(car) * BALANCE.wholesaleOfRetail);
}

/**
 * The buy-here-pay-here window sticker. Marked above cash retail, which is not a
 * game exaggeration — it is how the business works. The customer is not buying a
 * car, they are buying approval.
 *
 * `multiplier` is the store's, not the game's: it falls as you move upmarket,
 * because a premium franchise is selling to someone who could have walked into a
 * bank. Absolute dollars still climb, because the cars do.
 *
 * Deliberately required. It used to default to the small lot's 1.5x, and the one
 * caller that took the default (the inventory sheet) quietly quoted subprime
 * money on a Valmont. A wrong number shown confidently is worse than a compile
 * error.
 */
export function bhphPrice(car: Car, multiplier: number): number {
  return Math.round(retailValue(car) * multiplier);
}

/** Value of what is sitting on the lot, at cost. */
export function inventoryValue(cars: Car[]): number {
  let total = 0;
  for (const car of cars) if (car.status !== 'sold') total += car.costBasis;
  return total;
}

/**
 * Level payment on a simple-interest installment contract.
 * `apr` is annual, payments are weekly.
 */
export function weeklyPayment(principal: number, apr: number, weeks: number): number {
  const r = apr / 52;
  if (weeks <= 0) return principal;
  if (r === 0) return principal / weeks;
  const payment = (principal * r) / (1 - Math.pow(1 + r, -weeks));
  return Math.round(payment * 100) / 100;
}

/** Total the borrower hands over across the life of a performing contract. */
export function totalOfPayments(principal: number, apr: number, weeks: number): number {
  return Math.round(weeklyPayment(principal, apr, weeks) * weeks * 100) / 100;
}

/** Sum of outstanding principal — the portfolio number the player watches grow. */
export function portfolioValue(notes: { principal: number; status: string }[]): number {
  let total = 0;
  for (const n of notes) {
    if (n.status === 'current' || n.status === 'delinquent') total += n.principal;
  }
  return Math.round(total);
}

/**
 * Prospect arrival rate for a listed car, per second.
 *
 * Asking under retail pulls traffic hard; asking over it kills traffic fast.
 * Above `maxViablePriceRatio` the car is effectively invisible, which is the
 * feedback that teaches price discipline without a tutorial.
 */
export function prospectRate(
  askPrice: number,
  referenceValue: number,
  advertisingLevel: number,
): number {
  if (referenceValue <= 0) return 0;
  const ratio = askPrice / referenceValue;
  if (ratio > BALANCE.maxViablePriceRatio) return 0;
  const demand = Math.exp(-BALANCE.priceElasticity * (ratio - 1));
  const ads = Math.pow(BALANCE.ratePerAdvertisingLevel, advertisingLevel);
  return BALANCE.baseProspectRatePerSec * demand * ads;
}

/** Probability that at least one Poisson event with rate `ratePerSec` lands in `dtMs`. */
export function arrivalChance(ratePerSec: number, dtMs: number): number {
  if (ratePerSec <= 0) return 0;
  return 1 - Math.exp(-ratePerSec * (dtMs / 1000));
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}
