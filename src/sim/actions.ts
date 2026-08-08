import { BALANCE } from './balance';
import { beginRecon, canRecon, reconCost } from './cars';
import {
  acceptCash,
  acceptFinance,
  buyListingInternal,
  cloneState,
  expectedFinanceValue,
  listCar,
  logEvent,
} from './engine';
import { activeNotes, overCapacityFactor } from './notes';
import { collectionsCapacity, getUpgrade, level, upgradeCost } from './upgrades';
import type { DealPolicy, GameState } from './types';

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
    if (!car || !canRecon(car)) return false;
    const cost = reconCost(car);
    if (s.cash < cost) return false;
    s.cash -= cost;
    car.costBasis += cost;
    beginRecon(car, level(s, 'mechanic'));
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
