import { BALANCE } from './balance';
import { businessPolicy, clampBusinessPolicy } from './business';
import { beginRecon, canRecon, reconCost } from './cars';
import {
  acceptCash,
  acceptFinance,
  buyListingInternal,
  cloneState,
  expectedFinanceValue,
  listCar,
  logEvent,
  registerWalkaway,
} from './engine';
import { countersRemaining, resolveCounter } from './haggle';
import { activeNotes, overCapacityFactor } from './notes';
import { haggleSkillFor, reconModsFor } from './skills';
import { collectionsCapacity, getUpgrade, level, upgradeCost } from './upgrades';
import type { BusinessPolicy, DealPolicy, GameState } from './types';

/**
 * Player commands. Every one of these takes a state and returns a new state, so
 * the store can treat them exactly like `advance` and React sees fresh identity.
 *
 * Validation lives here rather than in the engine: automation calls the engine's
 * internals directly and has already checked its own preconditions.
 */

function act(state: GameState, fn: (s: GameState) => boolean): GameState {
  const next = cloneState(state);
  return fn(next) ? next : state;
}

export function buyListing(state: GameState, listingId: string): GameState {
  return act(state, (s) => buyListingInternal(s, listingId));
}

export function startRecon(state: GameState, carId: string): GameState {
  return act(state, (s) => {
    const car = s.cars.find((c) => c.id === carId);
    const mods = reconModsFor(s);
    if (!car || !canRecon(car, mods)) return false;
    const cost = reconCost(car, mods);
    if (s.cash < cost) return false;
    s.cash -= cost;
    car.costBasis += cost;
    beginRecon(car, mods);
    return true;
  });
}

export function listForSale(state: GameState, carId: string, askPrice?: number): GameState {
  return act(state, (s) => {
    const car = s.cars.find((c) => c.id === carId);
    if (!car || car.status !== 'ready') return false;
    listCar(s, car, askPrice);
    return true;
  });
}

export function unlist(state: GameState, carId: string): GameState {
  return act(state, (s) => {
    const car = s.cars.find((c) => c.id === carId);
    if (!car || car.status !== 'listed') return false;
    car.status = 'ready';
    car.askPrice = 0;
    car.listedAt = null;
    s.prospects = s.prospects.filter((p) => p.carId !== carId);
    return true;
  });
}

export function repriceCar(state: GameState, carId: string, askPrice: number): GameState {
  return act(state, (s) => {
    const car = s.cars.find((c) => c.id === carId);
    if (!car || car.status !== 'listed') return false;
    car.askPrice = Math.max(1, Math.round(askPrice));
    return true;
  });
}

export function takeCashDeal(state: GameState, prospectId: string): GameState {
  return act(state, (s) => acceptCash(s, prospectId));
}

/**
 * Push back on a cash offer.
 *
 * Resolves immediately — they either take it, come back with a better number, or
 * walk. Each exchange buys the buyer a little more patience so a haggle is not
 * cut short by the walk-up timer; running out of *counters* is what ends it,
 * not running out of clock.
 */
export function counterOffer(state: GameState, prospectId: string, price: number): GameState {
  return act(state, (s) => {
    const prospect = s.prospects.find((p) => p.id === prospectId);
    if (!prospect) return false;

    const neg = prospect.negotiation;
    if (neg.status !== 'open') return false;
    const haggle = haggleSkillFor(s);
    if (countersRemaining(neg, haggle) <= 0) return false;

    const asking = Math.round(price);
    // Countering at or below what they already offered is just acceptance with
    // extra steps, and countering above your own ask makes no sense.
    if (asking <= neg.currentOffer || asking > neg.anchor) return false;

    const outcome = resolveCounter(s.rng, neg, asking, haggle);
    prospect.expiresAt = s.t + BALANCE.negotiation.exchangeGraceMs;

    if (outcome.kind === 'walked') registerWalkaway(s, prospect.name);
    return true;
  });
}

export function takeFinanceDeal(state: GameState, prospectId: string): GameState {
  return act(state, (s) => acceptFinance(s, prospectId));
}

export function declineProspect(state: GameState, prospectId: string): GameState {
  return act(state, (s) => {
    const i = s.prospects.findIndex((p) => p.id === prospectId);
    if (i < 0) return false;
    s.prospects.splice(i, 1);
    return true;
  });
}

export function purchaseUpgrade(state: GameState, id: string): GameState {
  return act(state, (s) => {
    const def = getUpgrade(id);
    const lvl = level(s, id);
    if (lvl >= def.maxLevel) return false;
    if (def.stage === 'bhph' && s.stage !== 'bhph') return false;
    const cost = upgradeCost(def, lvl);
    if (s.cash < cost) return false;
    s.cash -= cost;
    s.upgrades[id] = lvl + 1;
    return true;
  });
}

export function setDealPolicy(state: GameState, policy: DealPolicy): GameState {
  return act(state, (s) => {
    if (level(s, 'salesDesk') === 0 && policy !== 'manual') return false;
    s.dealPolicy = policy;
    return true;
  });
}

/**
 * Change one or more house rules.
 *
 * Takes a patch rather than a whole policy so a control that owns one setting
 * cannot clobber the other two, and clamps rather than rejects so an out-of-range
 * value lands somewhere sane instead of silently doing nothing.
 */
export function setBusinessPolicy(state: GameState, patch: Partial<BusinessPolicy>): GameState {
  return act(state, (s) => {
    const current = businessPolicy(s);
    const next = clampBusinessPolicy(patch, current);
    if (
      next.minWorkingCapital === current.minWorkingCapital &&
      next.repoAfterMissedPayments === current.repoAfterMissedPayments &&
      next.minBuyMargin === current.minBuyMargin
    ) {
      // No-op: returning false keeps state identity, so the UI does not re-render
      // the whole lot every time a control re-reports the value it already had.
      return false;
    }
    s.business = next;
    return true;
  });
}

/**
 * Stage gate: buy the lot. This is the moment the game changes shape — the
 * finance desk opens and every sale becomes a choice rather than a transaction.
 */
export function canBuyLot(state: GameState): boolean {
  return state.stage === 'curbstoner' && state.cash >= BALANCE.lotPurchaseCost;
}

export function buyLot(state: GameState): GameState {
  return act(state, (s) => {
    if (s.stage !== 'curbstoner' || s.cash < BALANCE.lotPurchaseCost) return false;
    s.cash -= BALANCE.lotPurchaseCost;
    s.stage = 'bhph';
    logEvent(s, {
      t: s.t,
      kind: 'stage-up',
      label: 'Bought the lot. The finance desk is open.',
      amount: -BALANCE.lotPurchaseCost,
    });
    return true;
  });
}

/** Expected value of the paper on this prospect, for the deal sheet. */
export function financeExpectedValue(state: GameState, prospectId: string): number {
  const capFactor = overCapacityFactor(activeNotes(state.notes).length, collectionsCapacity(state));
  return expectedFinanceValue(state, prospectId, capFactor);
}
