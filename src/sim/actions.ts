import { BALANCE } from './balance';
import { businessPolicy, clampBusinessPolicy } from './business';
import { beginRecon, canRecon, reconCost } from './cars';
import { createInitialState } from './engine';
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
import { wholesaleValue } from './economy';
import { countersRemaining, resolveCounter } from './haggle';
import { activeNotes, overCapacityFactor } from './notes';
import { loanBalance, retirementPreview, sharkOffer } from './prestige';
import { getStage, nextStage, stageRank, typicalCarPrice, type StageDef } from './stages';
import { applyTuning, coerceTunable, defaultValue, getTunable, pruneTuning } from './tuning';
import { range } from './rng';
import { cloneSkills, haggleSkillFor, reconModsFor } from './skills';
import {
  UPGRADES,
  carCapacity,
  collectionsCapacity,
  getUpgrade,
  level,
  upgradeCost,
  upgradeUnlocked,
} from './upgrades';
import type { BusinessPolicy, DealPolicy, GameState, StageId } from './types';

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
 * Everything a move costs you, beyond the cheque. Computed before the move so
 * the UI can put it in front of the player, and computed from the same data the
 * move itself uses so the warning cannot drift from what actually happens.
 *
 * Not just the next rung. Any store on the ladder can be previewed from any
 * other, because the card the player reads this through lets them look ahead at
 * stores they cannot afford, jump straight past rungs they can, and walk back
 * down to a smaller one. `direction` is what the caller should branch on;
 * everything else is filled in for whichever move it describes.
 */
export interface StageMovePreview {
  /** The store you are standing in. */
  from: StageDef;
  /** The store this preview is about. Null only at the top of the ladder. */
  target: StageDef | null;
  direction: 'up' | 'down' | 'stay';
  /**
   * Cash the move costs. A bigger store is bought at its own entry price —
   * skipping rungs does not compound, because you are buying one dealership and
   * this is what that dealership costs. Zero going down: nobody sells you a
   * smaller store, you just leave.
   */
  cost: number;
  /**
   * Cash you must still hold *after* paying the entry cost, or the move is not
   * allowed. You arrive with an empty lot, no staff and rent falling due — this
   * is the money that reopens the business. Zero going down.
   */
  float: number;
  /**
   * What going down writes off: everything you paid to move into the store you
   * are leaving. You take your cash and your cars, and you get none of that
   * back. Zero going up, where the property comes with you.
   */
  forfeit: number;
  /** Rungs you would step straight past. Zero for a single step. */
  rungsSkipped: number;
  /** Whether the cheque clears. Trivially true going down, which is free. */
  affordable: boolean;
  /** Whether `moveToStage` would actually do this. The gate to put on a button. */
  allowed: boolean;
  /** Employees who do not come with you, by name, at their current level. */
  staffLost: { name: string; level: number }[];
  /** Contracts on the book against the collections desk you would be left with. */
  bookAfter: { active: number; capacity: number };
  /**
   * Room on the lot you arrive at. Not "will my cars fit" any more — the move
   * clears the lot either way — but what you have to rebuild into, which is the
   * whole of what a smaller store means when you walk back down to one.
   */
  lotAfter: { capacity: number };
  /**
   * The forced sale of the lot on the way out: how many cars go and what the
   * wholesaler pays for them.
   *
   * Lives on the preview so the confirmation and the action can never disagree
   * about the cheque — both read `lotLiquidation`, which is the only place the
   * number is worked out.
   */
  liquidation: { cars: number; proceeds: number };
}

export function stageMovePreview(state: GameState, targetId?: StageId): StageMovePreview {
  const from = getStage(state.stage);
  const target = targetId
    ? stageRank(targetId) >= 0
      ? getStage(targetId)
      : null
    : nextStage(state.stage);

  const here = stageRank(state.stage);
  const there = target ? stageRank(target.id) : here;
  const direction: StageMovePreview['direction'] =
    !target || there === here ? 'stay' : there > here ? 'up' : 'down';

  const cost = direction === 'up' ? target!.entryCost : 0;
  /**
   * What you must still be holding after the cheque clears.
   *
   * Moving now clears the lot AND the whole upgrade table, so you arrive with no
   * stock, no staff and no process — and the rent starts the same week. Buying a
   * dealership with your last dollar used to be merely unwise; now it is fatal,
   * because cash at zero buys no inventory, no inventory earns nothing, and the
   * bill still comes. The harness found this the hard way: the bot moved the
   * moment it could afford the entry price and every seed flatlined at $0 inside
   * half an hour.
   *
   * So the ladder asks for the float to open the doors as well as the price of
   * the keys. A share of the entry cost to restock with, plus a few weeks of the
   * new store's rent.
   */
  const float = direction === 'up' ? reopeningFloat(state, target!) : 0;
  const affordable = state.cash >= cost + float;

  // Everything owned, because everything goes.
  const staffLost = UPGRADES.filter((u) => level(state, u.id) > 0).map((u) => ({
    name: u.name,
    level: level(state, u.id),
  }));

  // The collections desk is staff, so it resets too — and the book does not.
  // A player carrying 40 contracts into a new store lands there with capacity
  // for 8 until they rehire, which is the single sharpest edge in the move.
  const withoutStaff = { upgrades: {} as Record<string, number> };

  return {
    from,
    target,
    direction,
    cost,
    float,
    forfeit: direction === 'down' ? from.entryCost : 0,
    rungsSkipped: direction === 'up' ? there - here - 1 : 0,
    affordable,
    allowed: direction !== 'stay' && affordable,
    staffLost,
    bookAfter: {
      active: activeNotes(state.notes).length,
      capacity: collectionsCapacity(withoutStaff),
    },
    liquidation: lotLiquidation(state),
    lotAfter: {
      // Capacity upgrades are property and carry, so only the store's own floor
      // moves. Going down, that floor drops — which used to leave a player
      // standing on a lot too small for the cars they already had, and is now
      // just a smaller lot to start filling.
      capacity: target ? carCapacity({ ...state, stage: target.id }) : carCapacity(state),
    },
  };
}

/**
 * What the lot fetches when the business changes stores.
 *
 * Cars out on finance are NOT part of this and must never be: a financed car is
 * still in `state.cars` marked sold, precisely so a repossession can bring it
 * back, and selling one out from under a live contract would strand the note and
 * break every repo on the book. Only what is physically on the lot is sold.
 *
 * The one place the figure is computed. `stageMovePreview` reports it and
 * `moveToStage` pays it, so the confirmation cannot promise a number the move
 * does not honour.
 */
export function lotLiquidation(state: GameState): { cars: number; proceeds: number } {
  const onLot = state.cars.filter((c) => c.status !== 'sold');
  const rate = BALANCE.forcedSaleRate;
  return {
    cars: onLot.length,
    // Rounded per car rather than on the total, so the ledger line and the sum
    // of the cars a player could count on the lot agree to the dollar.
    proceeds: onLot.reduce((sum, car) => sum + Math.round(wholesaleValue(car) * rate), 0),
  };
}

/**
 * Cash the business must still hold after the cheque clears.
 *
 * Sized to what you actually have to put back: rebuying the office you are
 * walking away from, at the new store's prices, plus a few weeks of its rent
 * while you restock. Only a share of the rebuild — you do not have to replace
 * everything on day one, but you do have to be able to open.
 *
 * Self-scaling, which is the point: the more office you built, the more it costs
 * to move it, so a heavily upgraded small lot is a bigger commitment to leave
 * than a bare one. It also closes the hole the harness found — the bot moved the
 * moment it could afford the entry price, arrived with no stock, no staff and no
 * process, and every seed flatlined at $0 within the hour.
 */
export function reopeningFloat(_state: GameState, target: StageDef): number {
  // Enough to put cars on the empty lot you are about to stand on, plus a few
  // weeks of its rent. The entry cost buys the keys; this buys something to sell.
  //
  // A PROPERTY OF THE TARGET STORE ONLY, and that is not a simplification — it
  // is the whole correctness argument. The first cut of this also charged for
  // rebuilding the office you were leaving, which scales with what you own, so
  // every upgrade a player bought pushed the next rung further away. The harness
  // showed it exactly: the bot stalled at the small lot forever and reported the
  // identical lifetime profit under every expense setting, because expenses were
  // never the binding constraint — the receding gate was. A requirement that
  // grows when you invest is a trap, not a gate.
  return Math.round(
    typicalCarPrice(target) * BALANCE.expenses.reopeningCars +
      target.rentPerWeek * BALANCE.expenses.reserveWeeks,
  );
}

export function canAdvanceStage(state: GameState): boolean {
  return stageMovePreview(state).allowed;
}

/**
 * Move the business to another store on the ladder, in either direction.
 *
 * GOING UP is the moment the game changes shape. What survives is deliberate and
 * is the whole design of the progression: cash, inventory, the loan book,
 * property, contracts, process and — above all — skills. What does not survive
 * is the payroll. You are hiring into a bigger operation and you are hiring from
 * scratch, at that operation's prices.
 *
 * You may jump as many rungs as your cash covers, and the price is the target's
 * entry cost and nothing else. Entry cost is what a dealership costs, not a toll
 * on the rung below it, so a player who has ground out $32M at a small lot has
 * genuinely bought a Valmont store — they just arrive with a two-man payroll and
 * a book sized for a small lot, which is punishment enough and is exactly what
 * the confirmation says.
 *
 * GOING DOWN takes your cash, your cars and your paper with you, and writes off
 * every dollar you ever put into the store you are leaving. There is no partial
 * refund and there is deliberately no discount on the way back up: down-then-up
 * pays the full entry price twice, which is what stops this being a way to park
 * money. It is an escape hatch, not a strategy.
 *
 * The payroll resets in BOTH directions, for the same reason it resets going up:
 * the rule is "would this person have to be hired again", and at a different
 * store they would. Cheaper to rehire at a smaller one, which is the only mercy
 * in it.
 *
 * THE LOT IS CLEARED IN BOTH DIRECTIONS. Every car physically on the lot is sold
 * to a wholesaler at `BALANCE.forcedSaleRate` of its true wholesale value,
 * and the cash lands with the move. You do not haul stock across town, and the
 * wholesaler knows you have already signed for the next store — the haircut is
 * his leverage, and it is deliberately not the only thing the move costs. The
 * retail spread you were holding each car for goes too, along with any recon you
 * have already paid for. A car halfway through the shop is sold rough.
 *
 * What is NOT sold is the paper, and the distinction matters more than it looks.
 * A financed car is still in `state.cars` marked sold, so that a repossession can
 * bring it back; selling one here would strand its note and break the book. The
 * business you are moving is the loan book, and it moves intact.
 *
 * The lot arriving empty is the point. Beaters bought at a small lot were never
 * going to sell at a franchise store, and a driveway with room for two was never
 * going to hold forty Valmonts — the old rule left the player to unwind that by
 * hand, which is bookkeeping rather than a decision. Now the decision is where it
 * belongs: whether to sell the lot down at retail *before* you move, or take the
 * wholesaler's price and start clean.
 */
export function moveToStage(state: GameState, targetId: StageId): GameState {
  return act(state, (s) => {
    const move = stageMovePreview(s, targetId);
    const target = move.target;
    if (!target || !move.allowed) return false;

    const leaving = move.from;
    s.cash -= move.cost;
    s.stage = target.id;

    // NOTHING ON THE UPGRADE TABLE COMES WITH YOU. Not the payroll, not the
    // paving, not the process — the office you built was that store's office,
    // and at this one you build it again at this one's prices. Deleted rather
    // than zeroed so a save never carries a key the player has not bought here.
    //
    // This replaced the older "property carries, people do not" split. That rule
    // made a move a payroll event; this makes it the decision the whole ladder
    // turns on, because the rebuild is now the dominant cost of a rung and it is
    // paid in the currency the store charges for it.
    const released: string[] = [];
    for (const def of UPGRADES) {
      if (level(s, def.id) === 0) continue;
      released.push(def.name);
      delete s.upgrades[def.id];
    }

    // The sales manager was staff, so the standing order has nobody to carry it
    // out. Left set, the policy would silently do nothing and the player would
    // think the desk was still running.
    if (s.dealPolicy !== 'manual') s.dealPolicy = 'manual';

    // The lot does not come with you. Sold before the staff are released so the
    // ledger reads in the order the day would have happened: you clear the
    // forecourt, then you hand back the keys.
    const sale = move.liquidation;
    if (sale.cars > 0) {
      const basis = s.cars.reduce((sum, c) => (c.status === 'sold' ? sum : sum + c.costBasis), 0);
      s.cash += sale.proceeds;
      // Counted as profit but NOT as a sale, and no XP: this is a wholesaler
      // taking the lot off your hands, not the desk closing anybody. Awarding
      // Closing XP for it would train the skill by moving house.
      s.stats.lifetimeProfit += sale.proceeds - basis;
      // Only what is on the lot. Financed cars stay in state, marked sold, or
      // their notes have nothing to repossess. See `lotLiquidation`.
      s.cars = s.cars.filter((c) => c.status === 'sold');
      logEvent(s, {
        t: s.t,
        kind: move.direction === 'up' ? 'stage-up' : 'stage-down',
        label: `Cleared the lot — ${sale.cars} car${sale.cars > 1 ? 's' : ''} to the wholesaler.`,
        amount: sale.proceeds,
      });
    }

    // The feed belonged to the old store. Left alone, a brand new franchise
    // spends its first two minutes showing auction beaters on a feed that has
    // just promised one make and factory pricing — which reads as a bug and, on
    // the used stages, quietly lets a big lot buy the small lot's inventory.
    // Cars already bought are yours; leads are not.
    s.listings = [];

    if (move.direction === 'up') {
      logEvent(s, {
        t: s.t,
        kind: 'stage-up',
        label:
          move.rungsSkipped > 0
            ? `Bought straight into the ${target.name.toLowerCase()}, past ${move.rungsSkipped} store${move.rungsSkipped > 1 ? 's' : ''}.`
            : `Took on the ${target.name.toLowerCase()}.`,
        amount: -move.cost,
      });
    } else {
      // No `amount`: nothing left the cash balance. The write-off is in the
      // words, because a minus sign in the ledger would read as a payment.
      logEvent(s, {
        t: s.t,
        kind: 'stage-down',
        label: `Walked away from the ${leaving.name.toLowerCase()} — everything it cost, gone.`,
      });
    }
    if (released.length > 0) {
      logEvent(s, {
        t: s.t,
        kind: move.direction === 'up' ? 'stage-up' : 'stage-down',
        label: `Payroll reset — rehiring ${released.length} at the new store.`,
      });
    }
    return true;
  });
}

/** Take on the next dealership up. The common case, and what automation uses. */
export function advanceStage(state: GameState): GameState {
  const next = nextStage(state.stage);
  return next ? moveToStage(state, next.id) : state;
}

// ------------------------------------------------------------ the shark

/**
 * Take the shark's money. One loan at a time — he does not refinance, and he
 * does not do seconds. The terms are whatever `sharkOffer` says for this store;
 * there is no negotiation, which is the point of borrowing from a man like this.
 */
export function takeLoan(state: GameState): GameState {
  return act(state, (s) => {
    if (s.loan) return false;
    const offer = sharkOffer(s);

    s.cash += offer.principal;
    s.loan = {
      originalPrincipal: offer.principal,
      apr: offer.apr,
      paymentAmount: offer.weeklyPayment,
      paymentsRemaining: offer.termWeeks,
      nextDueAt: s.nextBillAt,
      openedAt: s.t,
    };
    logEvent(s, {
      t: s.t,
      kind: 'loan',
      label: `Borrowed from the shark — ${offer.termWeeks} weeks at ${Math.round(offer.apr * 100)}%`,
      amount: offer.principal,
    });
    return true;
  });
}

/**
 * Clear the loan early. The payoff is every remaining payment, vig included —
 * the shark keeps his interest whether the money runs long or short. Allowed
 * only when the balance actually covers it; a payoff that dug the hole deeper
 * would just be the weekly schedule with a button on it.
 */
export function payOffLoan(state: GameState): GameState {
  return act(state, (s) => {
    if (!s.loan) return false;
    const owed = loanBalance(s.loan);
    if (s.cash < owed) return false;

    s.cash -= owed;
    s.stats.lifetimeProfit -= owed;
    s.loan = null;
    logEvent(s, { t: s.t, kind: 'loan', label: 'Paid the shark off early', amount: -owed });
    return true;
  });
}

// ------------------------------------------------------------- retirement

/**
 * Sell the whole operation and start over.
 *
 * Allowed from any store, at any moment, in any financial condition — this is
 * the game's ultimate escape hatch, and a hatch with preconditions is not one.
 * The buyers pay cash for the business (`retirementPreview` is the contract),
 * the shark is settled off the top, and whatever is left is logged on the
 * scoreboard and converted to points.
 *
 * What the next run inherits is deliberately short: skills (the work taught
 * you), tuning overrides (the admin console is meta), house rules (settings,
 * not progress), and the prestige block itself. Everything else — stage, cash,
 * cars, notes, upgrades, feed — is a genuinely new game via
 * `createInitialState`, so there is never a second definition of what a new
 * game is.
 */
export function retire(state: GameState): GameState {
  const sale = retirementPreview(state);

  // The new run's seed is drawn from the old run's stream: deterministic from
  // the save, so a retirement replays identically, but different every career.
  const seedSource = { s: state.rng.s };
  const seed = Math.floor(range(seedSource, 1, 2 ** 31));

  const fresh = createInitialState(seed, state.lastSeenAt);
  fresh.skills = cloneSkills(state.skills);
  fresh.business = { ...state.business };
  fresh.tuning = { ...state.tuning };
  fresh.prestige = {
    count: state.prestige.count + 1,
    points: state.prestige.points + sale.points,
    history: [
      ...state.prestige.history.map((r) => ({ ...r })),
      {
        n: state.prestige.count + 1,
        at: state.lastSeenAt,
        hours: state.t / 3_600_000,
        stage: state.stage,
        gross: sale.gross,
        debt: sale.debt,
        net: sale.net,
        points: sale.points,
      },
    ],
  };

  logEvent(fresh, {
    t: fresh.t,
    kind: 'retire',
    label:
      sale.net > 0
        ? `Retired — sold the empire for ${'$' + sale.net.toLocaleString()}${sale.points > 0 ? `, +${sale.points} point${sale.points > 1 ? 's' : ''}` : ''}`
        : 'Retired with nothing — but clear of the shark',
    amount: sale.net,
  });

  return fresh;
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

/**
 * Set the cash balance from the admin console.
 *
 * NOT A TUNABLE, and the distinction is the entire reason this is its own
 * function rather than another row in `TUNABLES`. Tuning overrides live on the
 * save and are re-applied on load *before* offline catch-up — that is what makes
 * a given save replay identically. Cash is state, not a constant, so an override
 * would re-stamp the balance every single load and silently delete everything
 * the business earned while the app was closed. Nothing that the simulation
 * writes back to may ever be registered as a tunable.
 *
 * Deliberately does not touch `lifetimeProfit`. That number is how the harness
 * and the ledger judge the health of the economy, and money conjured from a
 * debug field is not profit — polluting it would make every later balance
 * reading a lie.
 */
export function setCash(state: GameState, amount: number): GameState {
  return act(state, (s) => {
    if (!Number.isFinite(amount)) return false;
    const next = Math.max(0, Math.round(amount));
    const delta = next - Math.round(s.cash);
    if (delta === 0) return false;

    s.cash = next;
    // Logged like any other movement of money. A balance that changes with no
    // line in the ledger is the kind of thing you later mistake for a bug in
    // the economy.
    logEvent(s, {
      t: s.t,
      kind: 'admin',
      label: delta > 0 ? 'Admin: cash added' : 'Admin: cash removed',
      amount: delta,
    });
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
