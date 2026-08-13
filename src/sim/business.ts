import { BALANCE } from './balance';
import { clamp } from './economy';
import { SERVICE_PLAN_LEVELS } from './service';
import { SHOP_RATE_LEVELS } from './stages';
import type { BusinessPolicy, GameState } from './types';

/**
 * The house rules, resolved.
 *
 * Policy lives on the save (see `BusinessPolicy` in types.ts) so it keeps
 * applying while the app is closed. This module is the only place that reads it,
 * which is what lets every reader be tolerant of a save that predates a rule
 * without scattering `??` through the engine.
 *
 * It imports nothing but balance, economy and the stage table on purpose:
 * `upgrades.ts` needs the repo trigger to price repo damage, and anything here
 * that reached back into upgrades would close a cycle. The stage table is safe
 * because it depends on none of them, and it is where the sales floors live.
 */

export function businessDefaults(): BusinessPolicy {
  // Spread rather than returned directly: BALANCE is frozen-by-convention and
  // callers put this straight onto a mutable GameState.
  //
  // The markup is DERIVED rather than read off the table, so the shipped default
  // is cash retail whatever `wholesaleOfRetail` is later retuned to. A literal
  // would silently become a discount or a premium on the next balance pass — the
  // exact drift the sales floors were rebuilt to end.
  return { ...BALANCE.business.defaults, listMarkup: retailMarkup() };
}

/**
 * The markup over book that reproduces cash retail.
 *
 * `retail = wholesale / wholesaleOfRetail`, so listing at book + 35.1% IS
 * listing at retail. This is the hinge of the whole pricing rule: it is the
 * default, it is where traffic is judged from, and it is where the buyer's
 * ceiling and the list price agree.
 */
export function retailMarkup(): number {
  return 1 / BALANCE.wholesaleOfRetail - 1;
}

/**
 * The policy in force. Falls back field by field rather than wholesale, so a
 * save that gains a rule later still keeps the rules it already had.
 */
export function businessPolicy(state: Pick<GameState, 'business'>): BusinessPolicy {
  const set = state.business;
  const defaults = BALANCE.business.defaults;
  return {
    minWorkingCapital: set?.minWorkingCapital ?? defaults.minWorkingCapital,
    repoAfterMissedPayments: set?.repoAfterMissedPayments ?? defaults.repoAfterMissedPayments,
    minBuyMargin: set?.minBuyMargin ?? defaults.minBuyMargin,
    offerFloorLevel: set?.offerFloorLevel ?? defaults.offerFloorLevel,
    paymentPushLevel: set?.paymentPushLevel ?? defaults.paymentPushLevel,
    listMarkup: set?.listMarkup ?? retailMarkup(),
    servicePlanBand: set?.servicePlanBand ?? defaults.servicePlanBand,
    shopRateLevel: set?.shopRateLevel ?? defaults.shopRateLevel,
  };
}

/** Cash automation will not spend below. */
export function minWorkingCapital(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).minWorkingCapital;
}

/** Consecutive missed payments before the car comes back. */
export function repoThreshold(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).repoAfterMissedPayments;
}

/** Discount to worst-case retail the retainer buyer insists on. */
export function minBuyMargin(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).minBuyMargin;
}

// ------------------------------------------------------- what the desk signs

/**
 * The stops on the cash rule, and what to call them.
 *
 * Named for the buyer rather than for the arithmetic, because that is how the
 * player meets them: the lot already paints a lowball red and a near-ask green,
 * and this rule is which of those colours the manager is allowed to sign.
 */
export const OFFER_FLOOR_NAMES: readonly string[] = [
  'Anything sane',
  'No deep lowballs',
  'Nothing red',
  'Green only',
  'Sticker or near it',
];

export const OFFER_FLOOR_LEVELS = OFFER_FLOOR_NAMES.length;

/**
 * Is the cash rule switched off?
 *
 * Level 0 is the ABSENCE of a floor rather than a lenient one, the same
 * distinction the old margin ladder needed: the bottom stop still refuses a
 * genuine lowball, so a save backfilled onto it would arrive holding a rule it
 * never agreed to. Written as a negated comparison so a NaN reads as "no rule".
 */
export function offerFloorIsOff(level: number): boolean {
  return !(level >= 1);
}

/**
 * The least the desk will take, as a share of the ask. Zero when the rule is
 * off, so every caller is one comparison.
 */
export function offerFloor(state: Pick<GameState, 'business'>): number {
  const level = businessPolicy(state).offerFloorLevel;
  if (offerFloorIsOff(level)) return 0;
  const stops = BALANCE.business.offerFloors;
  return stops[Math.min(Math.round(level), stops.length) - 1];
}

export function offerFloorLevel(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).offerFloorLevel;
}

/** What each stop on the payment rule is called, from the desk's point of view. */
export const PAYMENT_PUSH_NAMES: readonly string[] = [
  'Nudge it',
  'Push',
  'Push hard',
  'Stretch them',
  'All they can carry',
];

export const PAYMENT_PUSH_LEVELS = PAYMENT_PUSH_NAMES.length;

export function paymentPushIsOff(level: number): boolean {
  return !(level >= 1);
}

/**
 * How far past their own payment the desk will push, as a multiple. 1 is "take
 * their number", which is what financing did before it was a negotiation.
 */
export function paymentPush(state: Pick<GameState, 'business'>): number {
  const level = businessPolicy(state).paymentPushLevel;
  if (paymentPushIsOff(level)) return 1;
  const stops = BALANCE.business.paymentPushes;
  return stops[Math.min(Math.round(level), stops.length) - 1];
}

export function paymentPushLevel(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).paymentPushLevel;
}

/** What the lot prices at, as a markup over true book value. */
export function listMarkup(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).listMarkup;
}

/**
 * What the finance office charges for cover, as a position on the plan bands.
 * Resolved to a markup by `planBandMultiplier` in service.ts, which owns the
 * table those positions index into.
 */
export function servicePlanBand(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).servicePlanBand;
}

/** Where the shop's labour rate sits on this store's ladder. */
export function shopRateLevel(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).shopRateLevel;
}

/**
 * Multiplier on repo condition damage for a given trigger.
 *
 * 1.0 at the default trigger by construction, so the setting is neutral until
 * the player moves it. See `repoConditionLossPerExtraMiss` for why patience has
 * to cost something.
 */
export function repoDamageMultiplier(trigger: number): number {
  const steps = trigger - BALANCE.repoAfterMissedPayments;
  return Math.max(
    BALANCE.repoConditionLossFloor,
    1 + steps * BALANCE.repoConditionLossPerExtraMiss,
  );
}

/**
 * Coerce a proposed policy into one the engine can run.
 *
 * Every field is clamped rather than rejected: this is the boundary a UI control
 * and a hand-edited save both come through, and a policy that is merely odd
 * should not be able to produce a repo trigger of zero (every note defaults on
 * its first miss) or a negative cash floor.
 */
export function clampBusinessPolicy(patch: Partial<BusinessPolicy>, base: BusinessPolicy): BusinessPolicy {
  const {
    repoTriggerMin,
    repoTriggerMax,
    buyMarginMin,
    buyMarginMax,
  } = BALANCE.business;
  const merged = { ...base, ...patch };
  return {
    minWorkingCapital: Math.max(0, Math.round(finite(merged.minWorkingCapital, base.minWorkingCapital))),
    repoAfterMissedPayments: clamp(
      Math.round(finite(merged.repoAfterMissedPayments, base.repoAfterMissedPayments)),
      repoTriggerMin,
      repoTriggerMax,
    ),
    minBuyMargin: clamp(finite(merged.minBuyMargin, base.minBuyMargin), buyMarginMin, buyMarginMax),
    offerFloorLevel: clampLevel(merged.offerFloorLevel, base.offerFloorLevel, 0, OFFER_FLOOR_LEVELS),
    paymentPushLevel: clampLevel(
      merged.paymentPushLevel,
      base.paymentPushLevel,
      0,
      PAYMENT_PUSH_LEVELS,
    ),
    // A price, so it clamps to a range rather than to a ladder. The bottom is
    // deliberately below anything that could turn a profit: listing under cost
    // to clear a lot is a real move.
    listMarkup: clamp(
      finite(merged.listMarkup, base.listMarkup),
      BALANCE.business.listMarkupMin,
      BALANCE.business.listMarkupMax,
    ),
    // The plan desk has an off position, like a sales floor. The shop's rate
    // does not: a shop with no rate is not a shop, and "closed" is already
    // spelled by owning no bays.
    servicePlanBand: clampLevel(merged.servicePlanBand, base.servicePlanBand, 0, SERVICE_PLAN_LEVELS),
    shopRateLevel: clampLevel(merged.shopRateLevel, base.shopRateLevel, 1, SHOP_RATE_LEVELS),
  };
}

/**
 * A position on a sales floor's ladder, or 0 for the "any deal" stop.
 *
 * A whole number, because every level indexes a hard-coded margin and half a
 * stop indexes nothing. Clamped to the ladder's length rather than to the store
 * you happen to be standing in: the levels are the same count everywhere, so a
 * setting survives a move, which is the whole reason this is a level and not a
 * percentage.
 */
/**
 * A position on any of the ladders, whole-numbered.
 *
 * `min` is what says whether a rule can be switched off: 0 for the sales floors
 * and the plan desk, 1 for the shop rate, which has no "off" stop. Clamped to
 * the ladder's LENGTH rather than to the store you happen to be standing in, so
 * a setting survives a move — which is the whole reason these are levels rather
 * than percentages.
 */
function clampLevel(value: number, fallback: number, min: number, max: number): number {
  return clamp(Math.round(finite(value, fallback)), min, max);
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
