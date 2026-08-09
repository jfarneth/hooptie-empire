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
import { nextStage, type StageDef } from './stages';
import { applyTuning, coerceTunable, defaultValue, getTunable, pruneTuning } from './tuning';
import { haggleSkillFor, reconModsFor } from './skills';
import { UPGRADES, collectionsCapacity, getUpgrade, level, upgradeCost, upgradeUnlocked } from './upgrades';
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
    if (!upgradeUnlocked(s, def)) return false;
    const cost = upgradeCost(def, lvl, s.stage);
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
 * Everything moving up costs you, beyond the cheque. Computed before the move so
 * the UI can put it in front of the player, and computed from the same data the
 * move itself uses so the warning cannot drift from what actually happens.
 */
export interface StageMovePreview {
  next: StageDef | null;
  cost: number;
  affordable: boolean;
  /** Employees who do not come with you, by name, at their current level. */
  staffLost: { name: string; level: number }[];
  /** Contracts on the book against the collections desk you would be left with. */
  bookAfter: { active: number; capacity: number };
}

export function stageMovePreview(state: GameState): StageMovePreview {
  const next = nextStage(state.stage);
  const staffLost = UPGRADES.filter((u) => u.staff && level(state, u.id) > 0).map((u) => ({
    name: u.name,
    level: level(state, u.id),
  }));

  // The collections desk is staff, so it resets too — and the book does not.
  // A player carrying 40 contracts into a new store lands there with capacity
  // for 8 until they rehire, which is the single sharpest edge in the move.
  const withoutStaff = { upgrades: { ...state.upgrades } };
  for (const u of UPGRADES) if (u.staff) delete withoutStaff.upgrades[u.id];

  return {
    next,
    cost: next?.entryCost ?? 0,
    affordable: next ? state.cash >= next.entryCost : false,
    staffLost,
    bookAfter: {
      active: activeNotes(state.notes).length,
      capacity: collectionsCapacity(withoutStaff),
    },
  };
}

export function canAdvanceStage(state: GameState): boolean {
  return stageMovePreview(state).affordable;
}

/**
 * Take on the next dealership up.
 *
 * The moment the game changes shape, five times over. What survives is
 * deliberate and is the whole design of the progression: cash, inventory, the
 * loan book, property, contracts, process and — above all — skills. What does
 * not survive is the payroll. You are hiring into a bigger operation and you are
 * hiring from scratch, at that operation's prices.
 *
 * Inventory is deliberately NOT liquidated. Beaters bought at a small lot are
 * still yours at a franchise store even though nothing like them will ever come
 * across the feed again; selling them off is the player's problem and their
 * first taste of what the new store's traffic wants.
 */
export function advanceStage(state: GameState): GameState {
  return act(state, (s) => {
    const next = nextStage(s.stage);
    if (!next || s.cash < next.entryCost) return false;

    s.cash -= next.entryCost;
    s.stage = next.id;

    // Staff do not come with you. Deleted rather than set to zero so a save
    // never carries a key the player has not bought at this store.
    const released: string[] = [];
    for (const def of UPGRADES) {
      if (!def.staff || level(s, def.id) === 0) continue;
      released.push(def.name);
      delete s.upgrades[def.id];
    }

    // The sales manager was staff, so the standing order has nobody to carry it
    // out. Left set, the policy would silently do nothing and the player would
    // think the desk was still running.
    if (s.dealPolicy !== 'manual') s.dealPolicy = 'manual';

    // The feed belonged to the old store. Left alone, a brand new franchise
    // spends its first two minutes showing auction beaters on a feed that has
    // just promised one make and factory pricing — which reads as a bug and, on
    // the used stages, quietly lets a big lot buy the small lot's inventory.
    // Cars already bought are yours; leads are not.
    s.listings = [];

    logEvent(s, {
      t: s.t,
      kind: 'stage-up',
      label: `Took on the ${next.name.toLowerCase()}.`,
      amount: -next.entryCost,
    });
    if (released.length > 0) {
      logEvent(s, {
        t: s.t,
        kind: 'stage-up',
        label: `Payroll reset — rehiring ${released.length} at the new store.`,
      });
    }
    return true;
  });
}

/** Expected value of the paper on this prospect, for the deal sheet. */
export function financeExpectedValue(state: GameState, prospectId: string): number {
  const capFactor = overCapacityFactor(activeNotes(state.notes).length, collectionsCapacity(state));
  return expectedFinanceValue(state, prospectId, capFactor);
}

// ------------------------------------------------------------- admin console

/**
 * Change one tuning constant.
 *
 * Writes the override onto the save *and* into the live globals, because those
 * globals are what every valuation and negotiation actually reads. Doing both
 * here keeps the two in step on the only path that can change them from inside
 * the app; the other path is load, in the store. See tuning.ts for why the
 * simulation is allowed a global at all.
 *
 * Setting a knob back to its shipped value removes the override rather than
 * storing it, so `tuning` stays a record of what the player deliberately
 * changed instead of a snapshot of everything.
 */
export function setTuning(state: GameState, path: string, value: number): GameState {
  return act(state, (s) => {
    const def = getTunable(path);
    if (!def) return false;

    const coerced = coerceTunable(def, value);
    const wasSet = path in s.tuning;
    const nowSet = coerced !== defaultValue(path);
    if (!wasSet && !nowSet) return false;
    if (wasSet && nowSet && s.tuning[path] === coerced) return false;

    const next = { ...s.tuning };
    if (nowSet) next[path] = coerced;
    else delete next[path];

    s.tuning = next;
    applyTuning(s.tuning);
    return true;
  });
}

/** Put every constant back to the value the game shipped with. */
export function resetTuning(state: GameState): GameState {
  return act(state, (s) => {
    if (Object.keys(s.tuning ?? {}).length === 0) return false;
    s.tuning = {};
    applyTuning(s.tuning);
    return true;
  });
}

/** Drop overrides for knobs this build no longer has, and re-apply the rest. */
export function reconcileTuning(state: GameState): GameState {
  const pruned = pruneTuning(state.tuning ?? {});
  applyTuning(pruned);
  if (Object.keys(pruned).length === Object.keys(state.tuning ?? {}).length) return state;
  return { ...cloneState(state), tuning: pruned };
}
