import { BALANCE } from './balance';
import { clamp } from './economy';
import type { BusinessPolicy, GameState } from './types';

/**
 * The house rules, resolved.
 *
 * Policy lives on the save (see `BusinessPolicy` in types.ts) so it keeps
 * applying while the app is closed. This module is the only place that reads it,
 * which is what lets every reader be tolerant of a save that predates a rule
 * without scattering `??` through the engine.
 *
 * It imports nothing but balance and economy on purpose: `upgrades.ts` needs the
 * repo trigger to price repo damage, and anything here that reached back into
 * upgrades would close a cycle.
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
    minCashMarginZ: set?.minCashMarginZ ?? defaults.minCashMarginZ,
    minFinanceMarginZ: set?.minFinanceMarginZ ?? defaults.minFinanceMarginZ,
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
 * The desk's floors, in σ off the store's average deal. Resolved to dollars by
 * `dealMarginFloor` in margins.ts, which is the only place that knows what a
 * standard deviation is worth here.
 */
export function minCashMarginZ(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).minCashMarginZ;
}

export function minFinanceMarginZ(state: Pick<GameState, 'business'>): number {
  return businessPolicy(state).minFinanceMarginZ;
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
    minCashMarginZ: clampMarginZ(merged.minCashMarginZ, base.minCashMarginZ),
    minFinanceMarginZ: clampMarginZ(merged.minFinanceMarginZ, base.minFinanceMarginZ),
  };
}

/**
 * A σ floor, or the "any deal" stop.
 *
 * Everything under the bottom of the scale collapses onto one stored value
 * rather than being clamped up onto it, because those are different rules and a
 * clamp would silently turn "take anything" into "take anything above -3σ" — a
 * real floor, at the store where σ is smallest and it bites hardest.
 */
function clampMarginZ(value: number, fallback: number): number {
  const { marginZMin, marginZMax, marginZOff } = BALANCE.business;
  const v = finite(value, fallback);
  return v < marginZMin ? marginZOff : clamp(v, marginZMin, marginZMax);
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
