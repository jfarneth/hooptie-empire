import { BALANCE } from './balance';
import { clamp } from './economy';
import { SERVICE_PLAN_LEVELS } from './service';
import { DEAL_FLOOR_LEVELS, SHOP_RATE_LEVELS } from './stages';
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
  return { ...BALANCE.business.defaults };
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
    cashFloorLevel: set?.cashFloorLevel ?? defaults.cashFloorLevel,
    financeFloorLevel: set?.financeFloorLevel ?? defaults.financeFloorLevel,
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

/**
 * The desk's floors, as positions on the store's ladder. Resolved to a margin
 * by `dealMarginFloor` in margins.ts, which is the only place that reads the
 * table those positions index into.
 */
export function cashFloorLevel(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).cashFloorLevel;
}

export function financeFloorLevel(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).financeFloorLevel;
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
    cashFloorLevel: clampFloorLevel(merged.cashFloorLevel, base.cashFloorLevel),
    financeFloorLevel: clampFloorLevel(merged.financeFloorLevel, base.financeFloorLevel),
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
function clampFloorLevel(value: number, fallback: number): number {
  return clampLevel(value, fallback, 0, DEAL_FLOOR_LEVELS);
}

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
