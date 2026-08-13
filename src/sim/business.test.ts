import { setBusinessPolicy, takeFinanceDeal } from './actions';
import { BALANCE, MS_PER_GAME_WEEK } from './balance';
import {
  OFFER_FLOOR_LEVELS,
  OFFER_FLOOR_NAMES,
  PAYMENT_PUSH_LEVELS,
  PAYMENT_PUSH_NAMES,
  businessDefaults,
  businessPolicy,
  clampBusinessPolicy,
  offerFloor,
  offerFloorIsOff,
  paymentPush,
  paymentPushIsOff,
  repoDamageMultiplier,
  repoThreshold,
  retailMarkup,
} from './business';
import { generateProspect } from './customers';
import { generateCar } from './cars';
import { getStage, typicalCarPrice } from './stages';
import { pessimisticRetail, pessimisticWholesale } from './appraisal';
import {
  acquisitionCeiling,
  advance,
  cloneState,
  createInitialState,
  expectedCollections,
  listCar,
  weeklyExpenses,
} from './engine';
import { bookValue, retailValue } from './economy';
import { getModel } from './models';
import { activeNotes, applyDuePayment, bookRoom, canWriteNote, openNote } from './notes';
import { appraisalSigma, haggleSkillFor } from './skills';
import { collectionsCapacity, repoConditionLoss } from './upgrades';
import type { GameState, Note } from './types';

/**
 * The house rules, and the one limit that used to be a suggestion.
 *
 * Two things these have to prove and not merely assert. First that the book cap
 * binds on *every* path a contract can be written on, because a cap with one way
 * around it is not a cap. Second that each rule is inert at its default, which is
 * what makes it safe to migrate a save into this build.
 */

// ------------------------------------------------------------------ fixtures

/** A stage-2 state with a listed car and a buyer standing in front of it. */
function lotWithProspect(seed = 4242): GameState {
  const s = cloneState(createInitialState(seed, 0));
  s.stage = 'smallUsed';
  s.cash = 500_000;

  const car = generateCar(s, s.rng, getModel('civet'), s.t);
  s.cars.push(car);
  listCar(s, car);
  s.prospects.push(generateProspect(s, s.rng, car, 0, haggleSkillFor(s), s.t));

  return s;
}

/** Fill the book to `count` live contracts without going near the finance desk. */
function fillBook(s: GameState, count: number): void {
  for (let i = 0; i < count; i++) {
    const note = openNote(
      s,
      {
        carId: `filler_${i}`,
        name: `Filler ${i}`,
        tier: 'C',
        financeTerms: { amountFinanced: 5_000, apr: 0.239, weeklyPayment: 260, weeks: 24 },
      } as any,
      'Filler car',
      s.t,
    );
    s.notes.push(note);
  }
}

function makeNote(over: Partial<Note> = {}): Note {
  return {
    id: 'note_x',
    carId: 'car_x',
    carLabel: 'Test car',
    customerName: 'Test Customer',
    customerTier: 'C',
    originalPrincipal: 5_000,
    downPayment: 0,
    principal: 5_000,
    apr: 0.239,
    paymentAmount: 260,
    paymentsTotal: 24,
    paymentsRemaining: 24,
    nextDueAt: MS_PER_GAME_WEEK,
    missedPayments: 0,
    collected: 0,
    status: 'current',
    openedAt: 0,
    ...over,
  };
}

// ---------------------------------------------------------------- the book cap

describe('the book limit is a limit', () => {
  it('reports room against the collections desk', () => {
    const s = lotWithProspect();
    expect(collectionsCapacity(s)).toBe(BALANCE.baseCollectionsCapacity);
    expect(bookRoom(s)).toBe(BALANCE.baseCollectionsCapacity);

    fillBook(s, BALANCE.baseCollectionsCapacity - 1);
    expect(bookRoom(s)).toBe(1);
    expect(canWriteNote(s)).toBe(true);

    fillBook(s, 1);
    expect(bookRoom(s)).toBe(0);
    expect(canWriteNote(s)).toBe(false);
  });

  it('refuses to write a contract past the limit', () => {
    const s = lotWithProspect();
    fillBook(s, collectionsCapacity(s));
    const before = activeNotes(s.notes).length;

    const after = takeFinanceDeal(s, s.prospects[0].id);

    expect(activeNotes(after.notes).length).toBe(before);
    // The buyer is still standing there — a full book refuses the paper, it does
    // not throw the customer off the lot.
    expect(after.prospects.length).toBe(1);
  });

  it('writes the contract when there is exactly one slot left', () => {
    const s = lotWithProspect();
    fillBook(s, collectionsCapacity(s) - 1);

    const after = takeFinanceDeal(s, s.prospects[0].id);

    expect(activeNotes(after.notes).length).toBe(collectionsCapacity(s));
    expect(after.stats.financeDeals).toBe(1);
  });

  it('never grows a full book, however long the sales desk runs unattended', () => {
    let s = lotWithProspect(99);
    s.upgrades = { salesDesk: 1, autoList: 1, advertising: 3 };
    s.dealPolicy = 'finance';
    // A lot rather than a single car, so the "it sold something instead" half of
    // this does not hang on one negotiation going the right way. Traffic is per
    // listed car, and a rejected counter loses the buyer nine times in ten.
    for (let i = 0; i < 6; i++) {
      const extra = generateCar(s, s.rng, getModel('civet'), s.t);
      s.cars.push(extra);
      listCar(s, extra);
    }
    fillBook(s, collectionsCapacity(s));

    // Long enough for many walk-ups, and short of a game week so no filler note
    // can retire and free a slot.
    s = advance(s, MS_PER_GAME_WEEK - 1_000);

    expect(activeNotes(s.notes).length).toBeLessThanOrEqual(collectionsCapacity(s));
    // And the desk did not simply stall: with paper unavailable it sold cars.
    expect(s.stats.carsSold).toBeGreaterThan(0);
    expect(s.stats.financeDeals).toBe(0);
  });

  it('leaves an over-capacity book from an older save alone, and writes nothing new', () => {
    const s = lotWithProspect();
    fillBook(s, collectionsCapacity(s) + 12);
    const before = activeNotes(s.notes).length;

    const after = takeFinanceDeal(s, s.prospects[0].id);

    // Nothing torn up, nothing added.
    expect(activeNotes(after.notes).length).toBe(before);
    expect(bookRoom(after)).toBe(0);
  });

  it('reopens the desk when a contract closes out', () => {
    const s = lotWithProspect();
    fillBook(s, collectionsCapacity(s));
    expect(canWriteNote(s)).toBe(false);

    s.notes[0].status = 'paid';
    expect(canWriteNote(s)).toBe(true);
  });
});

// ------------------------------------------------------------ working capital

describe('minimum working capital', () => {
  /**
   * A lot with the retainer buyer running, holding exactly $100 more than the
   * cheapest car it would actually take. The gate the buyer applies is its own
   * (see `pessimisticWholesale`), so the fixture has to find a listing that
   * clears it — otherwise the buyer declines for a reason that has nothing to do
   * with the floor and the test proves nothing.
   */
  function retainerLot(floor: number): GameState {
    // Search for an opening hand that deals something the buyer would take. One
    // fixed seed used to do; since the ask band tightened, the retainer buyer —
    // which works from the WORST case, not the estimate — passes on most of the
    // feed, and a single seed frequently deals it nothing. That is correct
    // behaviour, so the fixture adapts rather than the buyer.
    for (let seed = 31; seed < 400; seed++) {
      const s = cloneState(createInitialState(seed, 0));
      s.upgrades = { autoBuy: 1, driveway: 3 };
      s.business = { ...businessDefaults(), minWorkingCapital: floor };

      const sigma = appraisalSigma(s);
      const buyable = s.listings
        .filter((l) => l.price <= pessimisticWholesale(l, sigma))
        .sort((a, b) => a.price - b.price)[0];
      if (!buyable) continue;

      s.cash = buyable.price + 100;
      return s;
    }
    throw new Error('fixture: no seed in range dealt anything the retainer buyer would take');
  }

  it('stops the retainer buyer at the floor instead of running the till dry', () => {
    const s = retainerLot(500);
    const after = advance(s, 5_000);

    expect(after.cars.length).toBe(0);
    expect(after.cash).toBe(s.cash);
  });

  it('lets the same buy through once the floor is out of the way', () => {
    // THE PLAYER'S FLOOR IS THE ONLY FLOOR. Two hidden terms used to sit under
    // it — weeks of expenses and the price of a couple of cars — and this test
    // had to top the fixture up past both to isolate anything. They are gone:
    // bills charge in full now, so an over-spent till shows up as a visible
    // negative balance rather than a silent freeze, and a safety rail the
    // player cannot see is exactly what made "why isn't my buyer buying"
    // unanswerable from inside the game. At floor 0 with price + $100 in hand,
    // the buy goes through with $100 left — to the dollar, so a hidden term
    // creeping back in cannot hide.
    const s = retainerLot(0);
    const after = advance(s, 5_000);

    expect(after.cars.length).toBeGreaterThan(0);
    expect(after.cash).toBeLessThan(s.cash);
    expect(after.cash).toBeLessThanOrEqual(150);
  });

  /**
   * The bug a player hit and no test could: $20,000 in the bank, a $1,577 car on
   * the feed that cleared the buyer's own price test, working capital set to
   * $500 — and the retainer buyer bought nothing, for days.
   *
   * The reserve is `max(player floor, weeks of expenses, price of N cars)`, and
   * the last term was computed from a model's clean `baseValue` rather than the
   * 200,000-mile beater that actually turns up. At curbstone that put the floor
   * at $23,820 against a $3,000 starting balance, so `max()` overrode the
   * player's $500 by a factor of forty-seven and the buyer was inert forever.
   *
   * ABSOLUTE ON PURPOSE. Every test around this one sizes its fixture by calling
   * `typicalCarPrice`, so they agreed with the broken value by construction and
   * went on passing. This one states the requirement in dollars a player would
   * recognise: twenty thousand is enough to buy a beater at a curbstone lot.
   */
  it('buys a cheap car at a curbstone lot with $20,000 in the bank', () => {
    let bought = 0;
    let dealt = 0;
    for (let seed = 0; seed < 60; seed++) {
      const s = cloneState(createInitialState(5_000 + seed, 0));
      s.upgrades = { autoBuy: 1, driveway: 3 };
      s.business = { ...businessDefaults(), minWorkingCapital: 500 };
      s.cash = 20_000;

      const sigma = appraisalSigma(s);
      if (!s.listings.some((l) => l.price <= pessimisticWholesale(l, sigma))) continue;
      dealt += 1;
      if (advance(s, 5_000).cars.length > 0) bought += 1;
    }

    // Some openings deal nothing the buyer will touch; that is the ask band
    // doing its job. But whenever it IS dealt a bargain it has to take it.
    expect(dealt).toBeGreaterThan(0);
    expect(bought).toBe(dealt);
  });

  /**
   * THE SCREENSHOT BUG. Eight listings on a small lot's feed, every one showing
   * a green est-vs-retail margin, $98k in the till, floor at zero, buyer hired
   * — and nothing bought, for a session. The buyer was gating on wholesale
   * (retail x 0.74) while the stage's own ask band prices the feed at
   * 0.84-1.38x wholesale by design, so ~90% of retail-profitable cars were
   * "overpaying" by a rule the store's economy does not share. The ceiling now
   * judges margin against worst-case RETAIL, which is where the cars actually
   * go.
   */
  it('buys a retail-profitable car even when it is priced over wholesale', () => {
    let bought = 0;
    let eligible = 0;
    for (let seed = 700; seed < 760; seed++) {
      const s = cloneState(createInitialState(seed, 0));
      s.upgrades = { autoBuy: 1, driveway: 3 };
      s.business = { ...businessDefaults(), minWorkingCapital: 0 };
      s.cash = 30_000;

      const sigma = appraisalSigma(s);
      // The exact shape from the report: over wholesale, but the WORST CASE
      // retail still clears the price. The old gate refused every one of these.
      const target = s.listings.find(
        (l) => l.price > pessimisticWholesale(l, sigma) && l.price <= pessimisticRetail(l, sigma),
      );
      if (!target) continue;
      eligible += 1;
      const after = advance(s, 5_000);
      if (after.cars.length > 0) bought += 1;
    }
    expect(eligible).toBeGreaterThan(10);
    expect(bought).toBe(eligible);
  });

  it('gets pickier, not blind, when the margin rule is raised', () => {
    // The house rule still means what it said: higher margin, fewer cars,
    // better ones. At 20% the buyer must skip a deal whose worst case clears
    // the price by less than that.
    for (let seed = 700; seed < 760; seed++) {
      const s = cloneState(createInitialState(seed, 0));
      s.upgrades = { autoBuy: 1, driveway: 3 };
      s.business = { ...businessDefaults(), minWorkingCapital: 0, minBuyMargin: 0.2 };
      s.cash = 30_000;

      const sigma = appraisalSigma(s);
      const thin = s.listings.find(
        (l) =>
          l.price <= pessimisticRetail(l, sigma) &&
          l.price > pessimisticRetail(l, sigma) * 0.8,
      );
      if (!thin) continue;
      const after = advance(s, 5_000);
      // The thin deal specifically must not be in the garage.
      expect(after.cars.some((c) => c.id === thin.car.id)).toBe(false);
      return;
    }
    throw new Error('fixture: no seed dealt a thin-margin listing');
  });

  it('holds the standing shop order to the same floor', () => {
    const s = cloneState(createInitialState(77, 0));
    s.upgrades = { autoRecon: 1 };
    const car = generateCar(s, s.rng, getModel('civet'), s.t);
    car.condition = 0.3;
    s.cars.push(car);

    // Plenty of cash, but all of it spoken for.
    s.cash = 100_000;
    s.business = { ...businessDefaults(), minWorkingCapital: 100_000 };
    expect(advance(s, 5_000).cars[0].status).toBe('ready');

    s.business = { ...businessDefaults(), minWorkingCapital: 0 };
    expect(advance(s, 5_000).cars[0].status).toBe('recon');
  });
});

// ----------------------------------------------------------------- buy margin

describe("the retainer buyer's minimum margin", () => {
  /**
   * Measured on the decision rather than on an outcome: a listing the buyer takes
   * at 0% and refuses at 20% is the whole behaviour, and reading it off the
   * gate directly keeps the test from depending on which cars a seed deals.
   */
  function wouldBuy(s: GameState, margin: number): number {
    const sigma = appraisalSigma(s);
    return s.listings.filter((l) => l.price <= pessimisticWholesale(l, sigma) * (1 - margin)).length;
  }

  it('is inert at zero, which is what the buyer always did', () => {
    const s = advance(createInitialState(5150, 0), 10 * 60 * 1000);
    const sigma = appraisalSigma(s);
    const legacy = s.listings.filter((l) => l.price <= pessimisticWholesale(l, sigma)).length;
    expect(wouldBuy(s, 0)).toBe(legacy);
  });

  it('only ever narrows what the buyer will take', () => {
    const s = advance(createInitialState(5150, 0), 30 * 60 * 1000);
    const counts = [-0.1, 0, 0.05, 0.1, 0.2].map((m) => wouldBuy(s, m));
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  it('changes what the retainer buyer actually does over a run', () => {
    // A fully automated lot, so the only hand on the wheel is the margin rule.
    const base = cloneState(createInitialState(808, 0));
    base.upgrades = { autoBuy: 1, autoList: 1, driveway: 3, salesDesk: 1, advertising: 3 };
    base.dealPolicy = 'cash';
    // Comfortably clear of the working-capital floor, which is now denominated
    // in cars — at $20k the buyer could not have bought anything at all and both
    // arms of this comparison returned zero, which is a pass that proves nothing.
    base.cash = 90_000;

    const run = (margin: number) => {
      const s = cloneState(base);
      s.business = { ...businessDefaults(), minBuyMargin: margin };
      return advance(s, 30 * 60 * 1000).stats.carsSold;
    };

    // Fewer cars through the gate, so fewer sold out the other side.
    expect(run(0.2)).toBeLessThan(run(0));
  });
});

// ---------------------------------------------------------------- repo trigger

describe('the repo trigger', () => {
  it('defaults the note at the number the player set, not the house number', () => {
    const early = makeNote();
    applyDuePayment(early, false, 1);
    expect(early.status).toBe('defaulted');

    const patient = makeNote();
    for (let i = 0; i < 5; i++) {
      applyDuePayment(patient, false, 6);
      if (i < 4) expect(patient.status).toBe('delinquent');
    }
    expect(patient.status).toBe('delinquent');
    applyDuePayment(patient, false, 6);
    expect(patient.status).toBe('defaulted');
  });

  it('is what the engine actually repossesses on', () => {
    const build = (trigger: number) => {
      const s = cloneState(createInitialState(606, 0));
      s.stage = 'smallUsed';
      s.business = { ...businessDefaults(), repoAfterMissedPayments: trigger };
      // Eight deep-subprime borrowers. Any single miss inside the window ends a
      // contract at a trigger of 1; at a trigger of 6 there are not enough weeks
      // in the window for even a borrower who never pays to reach it, so that
      // side of the comparison is structural rather than lucky.
      s.notes = Array.from({ length: 8 }, (_, i) =>
        makeNote({ id: `note_${i}`, customerTier: 'D', nextDueAt: MS_PER_GAME_WEEK }),
      );
      return s;
    };

    const threeWeeks = MS_PER_GAME_WEEK * 3 + 1_000;

    expect(advance(build(1), threeWeeks).stats.reposCompleted).toBeGreaterThan(0);
    expect(advance(build(6), threeWeeks).stats.reposCompleted).toBe(0);
  });

  it('collects more and defaults less the longer the leash', () => {
    const tight = expectedCollections(24, 200, 0.16, 2);
    const house = expectedCollections(24, 200, 0.16, 3);
    const loose = expectedCollections(24, 200, 0.16, 5);

    expect(house.expectedCollected).toBeGreaterThan(tight.expectedCollected);
    expect(loose.expectedCollected).toBeGreaterThan(house.expectedCollected);
    expect(house.defaultProbability).toBeLessThan(tight.defaultProbability);
    expect(loose.defaultProbability).toBeLessThan(house.defaultProbability);
  });

  /**
   * The deal sheet presents expected value as exact, so the widened chain has to
   * be right at a non-default trigger and not merely monotonic. Same independent
   * simulation notes.test.ts runs against the default.
   */
  it('models a non-default trigger exactly, against a Monte Carlo of the same rules', () => {
    const weeks = 24;
    const payment = 200;
    const baseMiss = 0.12;
    const trigger = 5;
    const model = expectedCollections(weeks, payment, baseMiss, trigger);

    let totalCollected = 0;
    let defaults = 0;
    const runs = 20_000;
    let seed = 90210;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let r = 0; r < runs; r++) {
      let consecutive = 0;
      let dead = false;
      for (let w = 0; w < weeks && !dead; w++) {
        const p = consecutive > 0 ? baseMiss * BALANCE.delinquencyMissMultiplier : baseMiss;
        if (rand() < p) {
          consecutive += 1;
          if (consecutive >= trigger) {
            dead = true;
            defaults += 1;
          }
        } else {
          consecutive = 0;
          totalCollected += payment;
        }
      }
    }

    expect(model.expectedCollected).toBeCloseTo(totalCollected / runs, -2);
    expect(model.defaultProbability).toBeCloseTo(defaults / runs, 2);
  });

  it('charges for patience in condition, so a longer leash is not free', () => {
    expect(repoDamageMultiplier(BALANCE.repoAfterMissedPayments)).toBe(1);
    expect(repoDamageMultiplier(1)).toBeLessThan(1);
    expect(repoDamageMultiplier(6)).toBeGreaterThan(1);

    const at = (trigger: number) => {
      const s = createInitialState(1, 0);
      s.business = { ...businessDefaults(), repoAfterMissedPayments: trigger };
      return repoConditionLoss(s);
    };
    expect(at(3)).toBeCloseTo(BALANCE.repoConditionLoss, 10);
    expect(at(1)).toBeLessThan(at(3));
    expect(at(6)).toBeGreaterThan(at(3));
  });

  it('still stacks the recovery agent on top of the trigger', () => {
    const s = createInitialState(1, 0);
    s.business = { ...businessDefaults(), repoAfterMissedPayments: 6 };
    const bare = repoConditionLoss(s);
    s.upgrades = { repoMan: 2 };
    expect(repoConditionLoss(s)).toBeLessThan(bare);
  });
});

// ------------------------------------------------------------ policy plumbing

describe('setting the house rules', () => {
  it('starts every rule at the value the game used before they existed', () => {
    const s = createInitialState(1, 0);
    expect(s.business).toEqual({
      minWorkingCapital: 500,
      repoAfterMissedPayments: BALANCE.repoAfterMissedPayments,
      minBuyMargin: 0,
      offerFloorLevel: 0,
      paymentPushLevel: 0,
      listMarkup: retailMarkup(),
      // The two later rules are the exception to this test's name, and the
      // exception is the whole reason it is stated here: there is no "what the
      // plan desk did before it existed", because it did not exist. A store that
      // offers cover and sells none is not reproducing an older build, it is a
      // feature nobody found. What reproduces the older build is
      // `balance.service.attachRate = 0`, which consumes no RNG at all.
      servicePlanBand: BALANCE.business.defaults.servicePlanBand,
      shopRateLevel: BALANCE.business.defaults.shopRateLevel,
    });
    expect(repoThreshold(s)).toBe(BALANCE.repoAfterMissedPayments);
    // Stated as properties rather than as numbers: what the two sales rules
    // have to be is OFF, and a later retune must not be able to turn them on by
    // moving a constant this assertion happens to quote. The markup's invariant
    // is different in kind — it is not "off", it is "prices at cash retail",
    // which is what makes the pricing rule inert rather than absent.
    expect(offerFloorIsOff(s.business.offerFloorLevel)).toBe(true);
    expect(paymentPushIsOff(s.business.paymentPushLevel)).toBe(true);
    expect(offerFloor(s)).toBe(0);
    expect(paymentPush(s)).toBe(1);
    expect(s.business.listMarkup).toBeCloseTo(1 / BALANCE.wholesaleOfRetail - 1, 10);
  });

  it('changes one rule without disturbing the others', () => {
    const s = createInitialState(1, 0);
    const after = setBusinessPolicy(s, { minWorkingCapital: 10_000 });
    expect(after.business.minWorkingCapital).toBe(10_000);
    expect(after.business.repoAfterMissedPayments).toBe(s.business.repoAfterMissedPayments);
    expect(after.business.minBuyMargin).toBe(s.business.minBuyMargin);
  });

  it('clamps a rule that would break the sim rather than accepting it', () => {
    const s = createInitialState(1, 0);
    const { repoTriggerMin, repoTriggerMax } = BALANCE.business;

    // A trigger of zero would default every contract before its first payment.
    expect(setBusinessPolicy(s, { repoAfterMissedPayments: 0 }).business.repoAfterMissedPayments)
      .toBe(repoTriggerMin);
    expect(setBusinessPolicy(s, { repoAfterMissedPayments: 99 }).business.repoAfterMissedPayments)
      .toBe(repoTriggerMax);
    expect(setBusinessPolicy(s, { minWorkingCapital: -5_000 }).business.minWorkingCapital).toBe(0);
    expect(setBusinessPolicy(s, { minBuyMargin: 4 }).business.minBuyMargin).toBeLessThanOrEqual(0.9);
  });

  it('survives a garbage value instead of poisoning the state with NaN', () => {
    const s = createInitialState(1, 0);
    const after = clampBusinessPolicy(
      { minWorkingCapital: NaN, minBuyMargin: Infinity },
      businessPolicy(s),
    );
    expect(Number.isFinite(after.minWorkingCapital)).toBe(true);
    expect(Number.isFinite(after.minBuyMargin)).toBe(true);
  });

  it('keeps state identity when nothing actually changed', () => {
    const s = createInitialState(1, 0);
    expect(setBusinessPolicy(s, { minWorkingCapital: s.business.minWorkingCapital })).toBe(s);
  });

  /**
   * The cloneState contract. `business` is a nested mutable object on the state,
   * so a missed clone would let a rule set now rewrite the rules a historical
   * state was running under — the exact failure mode that corrupts offline
   * catch-up. Mutation-tested: drop the `business` line from cloneState and this
   * goes red.
   */
  it('does not share the policy object between a state and its clone', () => {
    const s = createInitialState(1, 0);
    const copy = cloneState(s);
    copy.business.repoAfterMissedPayments = 6;
    expect(s.business.repoAfterMissedPayments).toBe(BALANCE.repoAfterMissedPayments);
  });

  it('carries the policy through a run untouched', () => {
    const s = setBusinessPolicy(createInitialState(1, 0), { minBuyMargin: 0.1 });
    expect(advance(s, 10 * 60 * 1000).business.minBuyMargin).toBe(0.1);
  });
});

/**
 * Running costs.
 *
 * The sink that stops a franchise being pure upside the moment its entry cost
 * clears. Everything here is a property of the *rate* rather than of any single
 * number, which is why the harness found the design fault and unit tests did
 * not: light expenses killed 12 of 16 seeds outright, because cash at zero is an
 * absorbing state — no cash buys no stock, no stock earns nothing, and the bill
 * still arrives.
 */
describe('running costs', () => {
  it('charges rent, wages and floorplan, and nothing at the curbstone', () => {
    const curb = cloneState(createInitialState(5, 0));
    expect(weeklyExpenses(curb).total).toBe(0);

    const lot = cloneState(createInitialState(5, 0));
    lot.stage = 'largeUsed';
    lot.upgrades = { mechanic: 2, lot: 3 };
    const e = weeklyExpenses(lot);
    expect(e.rent).toBe(getStage('largeUsed').rentPerWeek);
    // `lot` is paving and does not eat; `mechanic` is staff and does.
    expect(e.payroll).toBeGreaterThan(0);
    expect(e.total).toBe(e.rent + e.payroll + e.floorplan);
  });

  it('charges floorplan on unsold stock only', () => {
    const s = cloneState(createInitialState(6, 0));
    s.stage = 'largeUsed';
    const car = generateCar(s, s.rng, getModel('civet'), s.t);
    car.costBasis = 20_000;
    car.status = 'ready';
    s.cars.push(car);
    const held = weeklyExpenses(s).floorplan;
    expect(held).toBeGreaterThan(0);

    // Out on finance: the book's problem, not the floorplan's.
    car.status = 'sold';
    expect(weeklyExpenses(s).floorplan).toBe(0);
  });

  it('takes the bill out of cash on the weekly beat', () => {
    const s = cloneState(createInitialState(7, 0));
    s.stage = 'largeUsed';
    s.cash = 500_000;
    const bill = weeklyExpenses(s).total;
    expect(bill).toBeGreaterThan(0);

    const after = advance(s, MS_PER_GAME_WEEK);
    expect(after.cash).toBe(s.cash - bill);
    expect(after.events.some((e) => e.kind === 'expense')).toBe(true);
  });

  it('drives the balance honestly negative when the bills exceed it', () => {
    // THE INVERSE OF THE GUARD THAT USED TO LIVE HERE. Rent and wages floored
    // at zero for a long time, and the price was the sneakiest failure state in
    // the game: a business pinned at $0 paid nothing, so two different expense
    // settings produced identical lifetime profit and the tell was a ledger
    // that had quietly stopped meaning anything. Bills charge in full now. A
    // Valmont store with $10 in the till owes three weeks of rent regardless,
    // and the books say so.
    const s = cloneState(createInitialState(8, 0));
    s.stage = 'premiumFranchise';
    s.cash = 10;
    const after = advance(s, MS_PER_GAME_WEEK * 3);
    expect(after.cash).toBeLessThan(0);
    // Three weeks of a $20k/week rent, minus the tenner: the whole bill.
    expect(after.cash).toBeLessThanOrEqual(10 - 3 * getStage('premiumFranchise').rentPerWeek);
  });
});

/**
 * THE LADDERS, GUARDED.
 *
 * The old per-store margin tables had a mutation-tested suite and a harness
 * column keeping them honest, and both retired with them. What replaced them is
 * far less to guard — one scale-free ladder each — but "less" is not "nothing",
 * and a stop that cannot bite is still a slider position doing nothing.
 */
describe('the two sales ladders', () => {
  it('runs the cash floor up the ask, and never past it', () => {
    const stops = BALANCE.business.offerFloors;
    expect(stops.length).toBe(OFFER_FLOOR_NAMES.length);
    for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1]);
    // Every stop is a real share of the ask. Above 1 would be a rule demanding
    // more than the sticker, which no buyer can ever satisfy.
    expect(stops[0]).toBeGreaterThan(0);
    expect(stops[stops.length - 1]).toBeLessThanOrEqual(1);
  });

  /**
   * The stops have to straddle the colours the lot paints, or the rule and the
   * read are two scales wearing one name. Measured offers run 0.80 to 1.00 of
   * the ask, so a ladder entirely above 0.93 would refuse almost everything and
   * one entirely below 0.87 would refuse almost nothing.
   */
  it('puts stops either side of an ordinary offer', () => {
    const stops = BALANCE.business.offerFloors;
    const { strong, fair } = BALANCE.negotiation.offerRead;
    expect(stops.some((x) => x <= fair)).toBe(true);
    expect(stops.some((x) => x > fair && x <= strong)).toBe(true);
    expect(stops.some((x) => x > strong)).toBe(true);
  });

  it('runs the payment push up from their own number', () => {
    const stops = BALANCE.business.paymentPushes;
    expect(stops.length).toBe(PAYMENT_PUSH_NAMES.length);
    for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1]);
    // Every stop asks for MORE than they offered — a push that asked for less
    // would be a discount with a confusing name.
    expect(stops[0]).toBeGreaterThan(1);
  });

  /**
   * And the top stop has to be somewhere a real buyer might refuse. A ladder
   * that topped out inside every customer's means would be five stops all
   * saying "yes", which is the failure the old franchise ladders shipped with.
   */
  it('tops out past what an average buyer can carry', () => {
    const stops = BALANCE.business.paymentPushes;
    expect(stops[stops.length - 1]).toBeGreaterThan(BALANCE.negotiation.payment.ceilingMean);
  });

  it('clamps a hand-edited save onto both ladders', () => {
    const base = businessDefaults();
    for (const bad of [NaN, -5, 99, undefined as any]) {
      const p = clampBusinessPolicy({ offerFloorLevel: bad, paymentPushLevel: bad }, base);
      expect(p.offerFloorLevel).toBeGreaterThanOrEqual(0);
      expect(p.offerFloorLevel).toBeLessThanOrEqual(OFFER_FLOOR_LEVELS);
      expect(p.paymentPushLevel).toBeGreaterThanOrEqual(0);
      expect(p.paymentPushLevel).toBeLessThanOrEqual(PAYMENT_PUSH_LEVELS);
    }
  });
});

/**
 * The pricing rule.
 *
 * One property matters more than the rest and it is the first test: the shipped
 * default has to price a car at cash retail EXACTLY, or every pacing baseline in
 * CLAUDE.md silently moved on the day this landed.
 */
describe('what the lot asks for a car', () => {
  const car = () => {
    const s = cloneState(createInitialState(5, 0));
    return generateCar(s, s.rng, getModel('civet'), 0);
  };

  it('prices at cash retail by default, to the dollar', () => {
    const s = cloneState(createInitialState(5, 0));
    const c = car();
    s.cars.push(c);
    listCar(s, c);
    expect(c.askPrice).toBe(retailValue(c));
  });

  it('moves the sticker with the markup', () => {
    const c = car();
    const at = (markup: number) => {
      const s = cloneState(createInitialState(5, 0));
      s.business = { ...businessDefaults(), listMarkup: markup };
      const copy = { ...c };
      s.cars.push(copy);
      listCar(s, copy);
      return copy.askPrice;
    };
    expect(at(0.1)).toBeLessThan(at(retailMarkup()));
    expect(at(0.6)).toBeGreaterThan(at(retailMarkup()));
    // It is a markup over BOOK, so the arithmetic is stateable exactly.
    expect(at(0.5)).toBe(Math.round(bookValue(c) * 1.5));
  });

  /**
   * PRICED ON THE FULL PICTURE, which is the whole reason this rule exists. The
   * buyer bought on a guess; by the time the car is listed the condition is
   * known and the shop has been through it, and the sticker reflects that
   * rather than whatever anybody hoped they were buying.
   */
  it('re-prices a car after the shop has improved it', () => {
    const s = cloneState(createInitialState(5, 0));
    const c = { ...car(), condition: 0.4 };
    s.cars.push(c);
    listCar(s, c);
    const before = c.askPrice;

    // Out of the shop in better shape, and listed again.
    c.condition = 0.8;
    c.status = 'ready';
    listCar(s, c);
    expect(c.askPrice).toBeGreaterThan(before);
  });

  it('will price under what the car cost, if that is what you asked for', () => {
    const s = cloneState(createInitialState(5, 0));
    s.business = { ...businessDefaults(), listMarkup: 0 };
    const c = { ...car(), costBasis: 999_999 };
    s.cars.push(c);
    listCar(s, c);
    expect(c.askPrice).toBeLessThan(c.costBasis);
  });

  /**
   * AND THE BUYER FOLLOWS IT. A buyer still judging against retail would pay
   * more for a car than the desk will list it at — the same "judge a purchase
   * against the number the car SELLS at" bug this codebase has paid for three
   * times, arriving through a new door.
   */
  it('drags the retainer buyer down with it', () => {
    const s = cloneState(createInitialState(31, 0));
    const listing = s.listings[0];
    const ceilingAt = (markup: number) =>
      acquisitionCeiling({ ...s, business: { ...businessDefaults(), listMarkup: markup } }, listing);

    expect(ceilingAt(0.1)).toBeLessThan(ceilingAt(retailMarkup()));
    expect(ceilingAt(0.6)).toBeGreaterThan(ceilingAt(retailMarkup()));
  });

  /**
   * At the default markup the new ceiling is the old one to the dollar, because
   * `book x (1 + retailMarkup())` IS retail. That equivalence is what makes this
   * change inert until somebody moves the slider, and it is worth pinning
   * because it is the reason no pacing baseline had to be re-measured for the
   * buy side.
   */
  it('is the buyer that shipped before it, at the default markup', () => {
    const s = cloneState(createInitialState(31, 0));
    for (const listing of s.listings) {
      const sigma = appraisalSigma(s);
      const oldWay = pessimisticRetail(listing, sigma) * (1 - businessPolicy(s).minBuyMargin);
      expect(acquisitionCeiling(s, listing)).toBeCloseTo(oldWay, 6);
    }
  });
});
