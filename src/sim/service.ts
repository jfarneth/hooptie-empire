import { BALANCE, MS_PER_GAME_WEEK } from './balance';
import { clamp01, conditionFreeValue } from './economy';
import { mintId } from './ids';
import { chance, range } from './rng';
import { bayCount } from './shop';
import { getStage } from './stages';
import type {
  Car,
  GameState,
  Millis,
  Prospect,
  ServiceContract,
} from './types';

/**
 * Service contracts: the finance office's other product, and a note run
 * backwards.
 *
 * A `Note` is an asset. The customer owes you, you collect weekly, and the worst
 * case is that you take the car back. This is the mirror image: the customer
 * pays once at signing and the house owes the repairs for the life of the plan,
 * weekly, whether or not anyone is watching. Same clock, same beat, opposite
 * sign — which is why it is a real object on the save rather than a lump of
 * margin booked at the point of sale. A plan sold two hours ago has to be able
 * to cost you money tonight.
 *
 * THREE PROPERTIES CARRY THE WHOLE FEATURE, and they only work together:
 *
 *  - **Price is the car's risk, and the player does not set it.** A plan on a
 *    200,000-mile beater costs more than a plan on a new Valmont, because it
 *    will be claimed on more. What the player sets is the MARKUP over that (the
 *    band), and the attach rate moves against the band.
 *  - **The margin is a derivation, not an assertion.** Price is expected claims
 *    divided by `targetLossRatio`, so 35% falls out. Nothing anywhere adds a
 *    profit; the profit is what is left when the claims are paid.
 *  - **The variance is the product.** Most plans pay nothing at all, the average
 *    one pays about half its price in a single claim, and a few cost more than
 *    they sold for. A plan desk that returned 35% on every contract would be an
 *    interest rate with extra steps.
 */

/**
 * What the finance office charges over the plan's cost, and what that does to
 * the share of buyers who say yes.
 *
 * The elasticity is set so the STANDARD band is the peak of expected dollars
 * per car (see `attachElasticity`), which makes both ends real trades rather
 * than one of them a mistake: cheap sells three times the plans at a third of
 * the margin, dear sells one in twelve and keeps half of it. What moves the
 * optimum is opening a service department — at a 0.5 loss ratio the cheap bands
 * win, because the house is no longer paying retail to honour its own paper.
 */
export const SERVICE_PLAN_BANDS: readonly { name: string; multiplier: number }[] = [
  { name: 'Loss leader', multiplier: 0.8 },
  { name: 'Cheap', multiplier: 0.9 },
  { name: 'Standard', multiplier: 1 },
  { name: 'Firm', multiplier: 1.15 },
  { name: 'Take them for it', multiplier: 1.3 },
];

export const SERVICE_PLAN_LEVELS = SERVICE_PLAN_BANDS.length;

/**
 * Is the plan desk switched off?
 *
 * Level 0 is "don't sell them", and it is its own position rather than the
 * bottom of the range for the same reason the sales floors' "any deal" is: the
 * bottom band is a real price that real customers buy at, so a save landing
 * there would be selling cover it never agreed to sell. Written as a negated
 * comparison so a NaN out of a hand-edited save reads as off.
 */
export function planBandIsOff(level: number): boolean {
  return !(level >= 1);
}

/** The markup at this stop, or 0 when the desk is closed. */
export function planBandMultiplier(level: number): number {
  if (planBandIsOff(level)) return 0;
  const band = SERVICE_PLAN_BANDS[Math.min(Math.round(level), SERVICE_PLAN_LEVELS) - 1];
  return band ? band.multiplier : 0;
}

export function planBandName(level: number): string {
  if (planBandIsOff(level)) return 'Not offered';
  return SERVICE_PLAN_BANDS[Math.min(Math.round(level), SERVICE_PLAN_LEVELS) - 1]?.name ?? '';
}

/** Whether this store's finance office can sell cover at all. */
export function sellsServicePlans(state: Pick<GameState, 'stage'>): boolean {
  return getStage(state.stage).serviceContracts;
}

/**
 * Share of buyers who take a plan at a given band.
 *
 * Zero — and it must be exactly zero, not merely small — whenever the store does
 * not offer plans, the desk is switched off, or `attachRate` has been set to 0.
 * The caller checks this BEFORE drawing, so a build with the feature turned off
 * consumes not one number from the RNG stream and every baseline measured before
 * this landed still reproduces byte for byte.
 */
export function attachChance(state: Pick<GameState, 'stage' | 'business'>, band: number): number {
  if (!sellsServicePlans(state)) return 0;
  const multiplier = planBandMultiplier(band);
  if (multiplier <= 0) return 0;

  const { attachRate, attachElasticity, maxAttachRate } = BALANCE.service;
  if (attachRate <= 0) return 0;
  return Math.min(maxAttachRate, attachRate * Math.exp(-attachElasticity * (multiplier - 1)));
}

/**
 * How much likelier this car is to need work than a showroom example.
 *
 * The one place condition enters the price, and it is why a rough car costs the
 * customer MORE rather than less — which is the right way round and is the
 * inversion that makes this product interesting. Linear between the two ends,
 * because nothing here justifies a curve nobody can feel.
 */
export function conditionRisk(condition: number): number {
  const { riskAtClean, riskAtRough } = BALANCE.service;
  return riskAtRough + (riskAtClean - riskAtRough) * clamp01(condition);
}

/**
 * What one claim on this car costs on average, in dollars.
 *
 * INDEXED TO `conditionFreeValue`, for exactly the reason recon cost is: a
 * gearbox for a 200,000-mile beater is not a gearbox for a new car, and pricing
 * repairs off the model's showroom value would make cover unsellable at the
 * bottom of the ladder and free money at the top. Trim grade rides along inside
 * that function, which is right — there is more car to go wrong on a legendary
 * one, and it costs more to put right.
 */
export function meanClaimCost(car: Car): number {
  return conditionFreeValue(car) * BALANCE.service.claimCostOfValue * conditionRisk(car.condition);
}

/** Claims expected across a plan of this length. */
export function expectedClaimCount(weeks: number): number {
  return Math.max(0, weeks) * BALANCE.service.claimChancePerWeek;
}

/** What the house expects to pay out across the life of the plan, before any shop. */
export function expectedPlanPayout(car: Car, weeks: number): number {
  return meanClaimCost(car) * expectedClaimCount(weeks);
}

/**
 * What the customer pays.
 *
 * Expected claims over the target loss ratio, times the band. The 35% is in this
 * division and nowhere else — there is no line in this module that adds a
 * margin, which is what makes the number impossible to quietly get wrong.
 *
 * Note what it is NOT a function of: whether the store has a service department.
 * The shop makes the claims cheaper to honour, not the cover dearer to buy — a
 * customer's price does not jump because the dealer opened some bays.
 */
export function planPrice(car: Car, weeks: number, band: number): number {
  const multiplier = planBandMultiplier(band);
  if (multiplier <= 0) return 0;
  const { targetLossRatio, capRecovery } = BALANCE.service;
  if (targetLossRatio <= 0) return 0;
  // Expected claims, discounted by the share of them the cap will never let
  // through, divided by the loss ratio the desk aims at. Charging the undiscounted
  // expectation would price cover a third too dear and quietly hand the house a
  // 45% margin on a product sold as a 35% one.
  return Math.round(
    ((expectedPlanPayout(car, weeks) * capRecovery) / targetLossRatio) * multiplier,
  );
}

/**
 * Multiplier on every claim once the store services its own paper.
 *
 * Applied at CLAIM time rather than at sale time, so a plan written before the
 * bays were built is honoured at the new cost too. That is not a generosity:
 * your own shop is doing the work either way. It is also why the price of cover
 * does not move when the department opens — the customer's price is the market's,
 * and what changes is what it costs you to keep the promise.
 */
export function claimCostMultiplier(state: Pick<GameState, 'stage' | 'upgrades'>): number {
  return hasServiceDept(state) ? BALANCE.service.shopClaimMultiplier : 1;
}

/**
 * What share of the premium this business should expect to pay back out, over a
 * full book.
 *
 * THE ONE NUMBER EVERY READOUT QUOTES, and it exists because the obvious
 * arithmetic is wrong: `targetLossRatio x shopClaimMultiplier` is 41%, and the
 * measured answer with a shop is 50%. Cheaper claims run into the cap less
 * often, so a third off the cost of a repair is not a third off the loss ratio.
 * Both figures are measured constants; this picks the right one.
 */
export function expectedLossRatio(state: Pick<GameState, 'stage' | 'upgrades'>): number {
  return hasServiceDept(state) ? BALANCE.service.shopLossRatio : BALANCE.service.targetLossRatio;
}

/**
 * Does this business have bays of its own?
 *
 * One question with one answer, because there is no free bay: buying the first
 * one IS opening the department. The dependency runs one way — the plan desk
 * needs to know whether the house can do its own repairs, and the shop needs
 * nothing at all from the plan desk.
 */
export function hasServiceDept(state: Pick<GameState, 'stage' | 'upgrades'>): boolean {
  return bayCount(state) > 0;
}

/** Plans still on the hook. */
export function activePlans(contracts: ServiceContract[]): ServiceContract[] {
  return contracts.filter((c) => c.status === 'active');
}

/**
 * The most the plans in force could still cost, at the cap.
 *
 * The honest exposure number, and the reason the cap is not decoration: without
 * it there is no answer to "what is the worst this book can do to me", and a
 * liability with no worst case is not something a business can plan around.
 */
export function planExposure(contracts: ServiceContract[]): number {
  let total = 0;
  for (const c of activePlans(contracts)) {
    total += Math.max(0, c.price * BALANCE.service.payoutCap - c.paidOut);
  }
  return Math.round(total);
}

/**
 * Sell cover on a deal that has just closed, if this buyer takes it.
 *
 * Called from `acceptCash` and `acceptFinance` — the two functions every sale in
 * the game goes through, whoever closed it — so a plan is as likely to be sold
 * at four in the morning by the sales manager as by the player at the sheet.
 *
 * THE TERM IS THE BUYER'S OWN. `financeTerms.weeks` is drawn for every walk-up
 * whether or not they end up financing, so a plan runs exactly as long as this
 * customer's note would have. That is what was asked for, and it saves inventing
 * a second contract-length table that would immediately drift from the first.
 */
export function maybeSellPlan(
  s: GameState,
  prospect: Prospect,
  car: Car,
  label: string,
  band: number,
): ServiceContract | null {
  const odds = attachChance(s, band);
  // Checked before the draw, not after: this is what keeps the RNG stream
  // identical to the pre-plan build when the feature is switched off.
  if (odds <= 0) return null;
  if (!chance(s.rng, odds)) return null;

  const weeks = Math.max(1, Math.round(prospect.financeTerms.weeks));
  const price = planPrice(car, weeks, band);
  if (price <= 0) return null;

  const contract: ServiceContract = {
    id: mintId(s, 'plan'),
    carId: car.id,
    carLabel: label,
    customerName: prospect.name,
    price,
    expectedPayout: Math.round(expectedPlanPayout(car, weeks)),
    paidOut: 0,
    claims: 0,
    weeksTotal: weeks,
    weeksRemaining: weeks,
    nextCheckAt: s.t + MS_PER_GAME_WEEK,
    status: 'active',
    openedAt: s.t,
  };
  s.serviceContracts.push(contract);
  return contract;
}

export interface PlanClaim {
  contract: ServiceContract;
  /** Dollars this claim costs the house. Never negative, never past the cap. */
  cost: number;
  /** True when this check retired the plan — it ran its full term. */
  expired: boolean;
}

/**
 * Run every plan whose weekly check has come due.
 *
 * Returns what happened rather than paying for it, so the caller owns the cash,
 * the ledger and the stats — the same division `applyDuePayment` uses on the
 * note side, and the reason both are testable without a GameState full of
 * scaffolding.
 *
 * `costMultiplier` is the service department's discount, passed in rather than
 * read, so this function knows nothing about upgrades.
 */
export function stepDuePlans(
  contracts: ServiceContract[],
  now: Millis,
  rng: { s: number },
  costMultiplier: number,
): PlanClaim[] {
  const { claimChancePerWeek, claimShapeMin, claimShapeSpan, payoutCap } = BALANCE.service;
  const results: PlanClaim[] = [];

  for (const contract of contracts) {
    if (contract.status !== 'active') continue;
    // A week can only come due once per 1s step, so this is an `if` and not a
    // `while` — the same argument `stepNotes` makes about payments.
    if (contract.nextCheckAt > now) continue;

    contract.nextCheckAt += MS_PER_GAME_WEEK;
    contract.weeksRemaining -= 1;
    const expired = contract.weeksRemaining <= 0;
    if (expired) {
      contract.weeksRemaining = 0;
      contract.status = 'expired';
    }

    let cost = 0;
    if (claimChancePerWeek > 0 && chance(rng, claimChancePerWeek)) {
      // Mean claim recovered from the stamped expectation rather than re-derived
      // from the car, which may since have been repossessed, reconditioned or
      // sold on. The plan is a contract about a car as it was the day it was
      // written.
      const expectedClaims = expectedClaimCount(contract.weeksTotal);
      const mean = expectedClaims > 0 ? contract.expectedPayout / expectedClaims : 0;
      // `min + span·u³`: most repair orders are small and the mean is carried by
      // the rare one that is not. See `claimShapeSpan`.
      const u = range(rng, 0, 1);
      const drawn = mean * (claimShapeMin + claimShapeSpan * u * u * u) * costMultiplier;
      // The cap is on the LIFETIME of the plan, not on one claim, so a contract
      // that has already been badly hit stops paying part way through a bill.
      //
      // FLOORED, not rounded. `price x payoutCap` is rarely a whole number, and
      // rounding the last dollar up puts the payout a hair over a limit the
      // whole product is priced against — which is exactly the class of bug
      // `humanizePrice` was fixed for. A cap that can be exceeded is not a cap.
      const room = Math.max(0, contract.price * payoutCap - contract.paidOut);
      cost = Math.min(Math.round(drawn), Math.floor(room));
    }

    if (cost > 0) {
      contract.paidOut += cost;
      contract.claims += 1;
    }
    if (cost > 0 || expired) results.push({ contract, cost, expired });
  }

  return results;
}

/**
 * Tear up every plan on a car that has just been taken back.
 *
 * The customer is gone and so is their cover. Without this the house goes on
 * paying to repair a car sitting on its own lot, on behalf of somebody who
 * stopped paying for it two months ago — which is not a hard case to argue, it
 * is just wrong. It is also the one place a plan can end early, and it means the
 * worst customers are the cheapest to cover, which is a genuinely nice thing to
 * notice on the ledger.
 */
export function voidPlansForCar(contracts: ServiceContract[], carId: string): ServiceContract[] {
  const voided: ServiceContract[] = [];
  for (const contract of contracts) {
    if (contract.status !== 'active' || contract.carId !== carId) continue;
    contract.status = 'void';
    contract.weeksRemaining = 0;
    voided.push(contract);
  }
  return voided;
}

/**
 * Drop closed plans past the history the sheet shows.
 *
 * Same rule and the same reason as `pruneClosedNotes`: without it the array
 * grows for the length of the run and every step pays to walk it.
 */
export function pruneClosedPlans(contracts: ServiceContract[]): ServiceContract[] {
  const closed = contracts.filter((c) => c.status !== 'active');
  const keep = BALANCE.service.closedPlanHistory;
  if (closed.length <= keep) return contracts;

  let drop = closed.length - keep;
  return contracts.filter((c) => {
    if (c.status === 'active') return true;
    if (drop > 0) {
      drop -= 1;
      return false;
    }
    return true;
  });
}
