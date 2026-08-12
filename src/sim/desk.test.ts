import { claimDeal, moveToStage, purchaseUpgrade, releaseDeal, setDealPolicy, takeCashDeal } from './actions';
import { BALANCE, TICK_MS } from './balance';
import { businessDefaults, repoThreshold } from './business';
import { generateCar } from './cars';
import { generateProspect } from './customers';
import { getModel } from './models';
import { advance, cloneState, createInitialState, expectedCollections } from './engine';
import { dealFloorLadder, type DealSide } from './margins';
import { activeNotes, overCapacityFactor } from './notes';
import { haggleSkillFor } from './skills';
import { migrate } from './save';
import { STAGES, getStage } from './stages';
import { weeklyExpenses } from './engine';
import { UPGRADES, collectionsCapacity, weeklyWage } from './upgrades';
import type { CreditTier, GameState, StageId } from './types';

/**
 * The commission desk: staff close the walk-ups you do not grab in time, and
 * take the stage's cut of the profit on every deal THEY close.
 *
 * Two behaviours carry the whole feature, and both are here because they are
 * exactly the kind that a green suite can silently lose:
 *
 *  - The grace window. The desk used to close instantly; the 20s wait is the
 *    entire incentive for attended play, and a regression to instant would
 *    change nothing else any test looks at.
 *  - Who pays. The player's tap keeps every dollar; the staff's close pays the
 *    cut. Collapse the two paths and either hand play is quietly taxed or the
 *    overnight prints money again — the bug this whole mechanic exists to fix.
 */

/** A curbstone lot with a hired partner, a listed car, and a fresh walk-up. */
function lotWithWalkUp(over: { stage?: StageId; claim?: boolean; costBasis?: number } = {}) {
  let s: GameState = cloneState(createInitialState(777, 0));
  if (over.stage && over.stage !== 'curbstone') {
    s = { ...s, cash: 400_000_000 };
    s = moveToStage(s, over.stage);
    s = { ...s, cash: 100_000 };
  }
  // Enough to hire the desk — a curbstone game opens with $3,000 and the
  // partner costs $6,000, and canBuyUpgrade declines silently.
  s = { ...s, cash: 60_000 };
  s = purchaseUpgrade(s, 'salesDesk');
  if (!s.upgrades.salesDesk) throw new Error('fixture failed to hire the desk');
  s = setDealPolicy(s, 'auto');
  s = cloneState(s);

  // A car on the lot at a known cost basis, listed at retail.
  //
  // Built from a named model rather than lifted off `s.listings[0]`, which was
  // fine only for as long as nothing used the `stage` override: moving stores
  // clears the feed, so the moment one did, the fixture read a car off an empty
  // array. Nothing here depends on which model it is — the prices are pinned
  // below — so a fixed one is strictly better than whatever the seed dealt.
  const car = {
    ...generateCar(s, s.rng, getModel('civet'), s.t),
    id: 'car_test',
    // $4,000 against a $7,000 buyer is a 43% deal, which clears every stop a
    // curbstone lot has. The floor tests raise it so the fixture lands in the
    // middle of the ladder and can exercise both sides of a refusal.
    costBasis: over.costBasis ?? 4_000,
    status: 'listed' as const,
    askPrice: 8_000,
    condition: 0.7,
    mileage: 90_000,
  };
  s.cars.push(car);

  const prospect = generateProspect(s, s.rng, car, 0, haggleSkillFor(s), s.t);
  // Pin the negotiation so the price the deal closes at is known exactly:
  // opening offer IS the current offer, and it is at the anchor so the desk
  // closes without countering (its counter path is covered by engine tests).
  prospect.negotiation.currentOffer = 7_000;
  prospect.negotiation.anchor = 7_000;
  prospect.negotiation.countersMade = 1;
  prospect.expiresAt = s.t + 10 * 60_000;
  if (over.claim) prospect.claimed = true;
  s.prospects.push(prospect);

  return { s, prospect, car };
}

const GRACE_TICKS = Math.ceil(BALANCE.desk.graceMs / TICK_MS);

describe('the grace window', () => {
  it('leaves a fresh walk-up alone until it has aged the full window', () => {
    const { s, prospect } = lotWithWalkUp();
    // One tick short of the window: the buyer is still standing there.
    const early = advance(s, BALANCE.desk.graceMs - TICK_MS);
    expect(early.prospects.some((p) => p.id === prospect.id)).toBe(true);
    expect(early.stats.carsSold).toBe(s.stats.carsSold);
  });

  it('closes the deal once the window lapses', () => {
    const { s, prospect } = lotWithWalkUp();
    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    expect(after.prospects.some((p) => p.id === prospect.id)).toBe(false);
    expect(after.stats.carsSold).toBe(s.stats.carsSold + 1);
  });

  it('never touches a claimed deal, however stale it gets', () => {
    const { s, prospect } = lotWithWalkUp({ claim: true });
    const after = advance(s, BALANCE.desk.graceMs * 6);
    // Still on the lot, still unsold: the sheet is open in front of the player.
    expect(after.prospects.some((p) => p.id === prospect.id)).toBe(true);
    expect(after.stats.carsSold).toBe(s.stats.carsSold);
  });

  it('moves in the moment a claim is released', () => {
    const { s, prospect } = lotWithWalkUp({ claim: true });
    let held = advance(s, BALANCE.desk.graceMs * 3);
    expect(held.prospects.some((p) => p.id === prospect.id)).toBe(true);

    held = releaseDeal(held, prospect.id);
    const after = advance(held, TICK_MS * GRACE_TICKS);
    expect(after.prospects.some((p) => p.id === prospect.id)).toBe(false);
    expect(after.stats.carsSold).toBe(s.stats.carsSold + 1);
  });

  it('claim and release are real actions with real no-ops', () => {
    const { s, prospect } = lotWithWalkUp();
    const claimed = claimDeal(s, prospect.id);
    expect(claimed.prospects.find((p) => p.id === prospect.id)?.claimed).toBe(true);
    // Claiming twice and releasing a stranger both leave state untouched.
    expect(claimDeal(claimed, prospect.id)).toBe(claimed);
    expect(releaseDeal(claimed, 'nobody')).toBe(claimed);
  });
});

describe('who pays the cut', () => {
  it('charges the partner’s cut, in dollars, when the desk closes', () => {
    const { s } = lotWithWalkUp();
    const cashBefore = s.cash;
    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);

    // $7,000 sale on a $4,000 car is $3,000 profit; the curbstone partner's cut
    // is 50% of profit = $1,500. Absolute, so a change to either the rate or
    // the base cannot hide inside this test.
    expect(after.stats.commissionPaid - s.stats.commissionPaid).toBe(1_500);
    expect(after.cash - cashBefore).toBe(7_000 - 1_500);
  });

  it('charges nothing when the player closes the same deal', () => {
    const { s, prospect } = lotWithWalkUp();
    const cashBefore = s.cash;
    const after = takeCashDeal(s, prospect.id);
    expect(after.stats.commissionPaid).toBe(s.stats.commissionPaid);
    expect(after.cash - cashBefore).toBe(7_000);
  });

  it('keeps lifetime profit honest about the cut', () => {
    const { s } = lotWithWalkUp();
    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    // The books: $3,000 gross on the car minus the $1,500 cut.
    expect(after.stats.lifetimeProfit - s.stats.lifetimeProfit).toBe(1_500);
  });

  it('takes no cut on a deal closed at a loss', () => {
    const { s, car } = lotWithWalkUp();
    car.costBasis = 9_000; // sold at 7,000: a $2,000 mistake, all yours
    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    expect(after.stats.carsSold).toBe(s.stats.carsSold + 1);
    expect(after.stats.commissionPaid).toBe(s.stats.commissionPaid);
  });

  it('cuts thinner as the ladder climbs', () => {
    // The pay structure IS the progression story: the partner takes half, the
    // managers take less at every rung above.
    const rates = STAGES.map((st) => st.desk.commission);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThan(rates[i - 1]);
    expect(getStage('curbstone').desk.commission).toBe(0.5);
  });
});

describe('the payroll', () => {
  const deskDef = UPGRADES.find((u) => u.id === 'salesDesk')!;

  it('pays the business partner nothing a week', () => {
    // He works for the cut. A salary on top would double-charge the fiction —
    // and quietly re-arm the salaried overnight this feature exists to end.
    expect(getStage('curbstone').desk.salaried).toBe(false);
    expect(weeklyWage(deskDef, 'curbstone')).toBe(0);
  });

  it('pays the sales managers a real wage at every dealership stage', () => {
    for (const stage of STAGES.slice(1)) {
      expect(stage.desk.salaried).toBe(true);
      expect(weeklyWage(deskDef, stage.id)).toBeGreaterThan(0);
    }
  });

  it('keeps the partner off the weekly bill', () => {
    const { s } = lotWithWalkUp();
    const bill = weeklyExpenses(s);
    // Mechanic and buyer are not hired in this fixture, and the partner is
    // unsalaried, so the curbstone payroll line is exactly zero.
    expect(bill.payroll).toBe(0);
  });
});

describe('the v11 save', () => {
  it('gets its in-flight walk-ups closed old-style and its counter zeroed', () => {
    const live = advance(createInitialState(31, 0), 20 * 60_000);
    const v11: any = JSON.parse(JSON.stringify(live));
    for (const p of v11.prospects) {
      delete p.arrivedAt;
      delete p.claimed;
    }
    delete v11.stats.commissionPaid;

    const migrated = migrate(v11, 11);
    expect(migrated.stats.commissionPaid).toBe(0);
    for (const p of migrated.prospects) {
      // arrivedAt: 0 is an age far past any grace window — the desk treats a
      // migrated walk-up exactly as the old build did, closing it immediately,
      // rather than granting a fresh window to a buyer already standing there.
      expect(p.arrivedAt).toBe(0);
      expect(p.claimed).toBe(false);
    }
    expect(() => advance(migrated, 5 * 60_000)).not.toThrow();
  });
});

/**
 * WHAT THE DESK WILL SIGN.
 *
 * Two house rules on top of the standing order: the least margin the staff will
 * take on a cash sale, and the least they will take on paper. Both are set in
 * standard deviations off the store's average deal — see margins.ts for why a
 * percentage cannot mean the same thing at a curbstone and at a Valmont store —
 * and both ship at the "any deal" stop, which is what the desk did before they
 * existed.
 *
 * Three properties carry the feature and each is easy to lose to a refactor:
 * a refusal is not a walk-away, the rules never touch a deal the PLAYER closes,
 * and the finance rule is judged on what a contract collects rather than on
 * what it says.
 */
/**
 * WHERE THE FIXTURE'S DEAL LANDS ON THE STORE'S LADDER.
 *
 * The floors are hard numbers per store now, so a test that wants "a floor just
 * under this deal" has to go and find which stop that is rather than nudging a
 * σ position by half. Derived rather than written down for the same reason it
 * always was: retune the ladder and these follow, and a fixture that can no
 * longer exercise a refusal says so out loud instead of passing for the wrong
 * reason.
 */
function cashMargin(car: { costBasis: number }, price: number): number {
  return (price - car.costBasis) / price;
}

/** The same deal as the finance desk prices it: expected collections, not sticker. */
function financeMargin(s: GameState, car: { costBasis: number }, prospect: any): number {
  const capFactor = overCapacityFactor(activeNotes(s.notes).length, collectionsCapacity(s));
  const ev =
    prospect.downPayment +
    expectedCollections(
      prospect.financeTerms.weeks,
      prospect.financeTerms.weeklyPayment,
      BALANCE.creditTiers[prospect.tier as CreditTier].missChance * capFactor,
      repoThreshold(s),
    ).expectedCollected;
  // Measured as the engine measures it — against expected collections, not
  // against the sticker. Reading paper off the cash number is precisely the bug
  // the separate finance ladder exists to prevent.
  return (ev - car.costBasis) / ev;
}

/** The strictest stop this margin still clears. 0 — "any deal" — when it clears none. */
function levelClearing(s: GameState, side: DealSide, margin: number): number {
  const ladder = dealFloorLadder(getStage(s.stage), side);
  let level = 0;
  for (let i = 0; i < ladder.length; i++) if (margin >= ladder[i]) level = i + 1;
  return level;
}

/** The most lenient stop this margin fails. Throws rather than quietly passing. */
function levelRefusing(s: GameState, side: DealSide, margin: number): number {
  const ladder = dealFloorLadder(getStage(s.stage), side);
  for (let i = 0; i < ladder.length; i++) if (margin < ladder[i]) return i + 1;
  throw new Error(
    `fixture deal (${(margin * 100).toFixed(1)}%) clears every ${side} stop at ${s.stage}; it cannot exercise a refusal`,
  );
}

describe('the grab window against a buyer\'s patience', () => {
  /**
   * THE ONE RELATIONSHIP THE GRACE WINDOW CANNOT BREAK, and it is a
   * relationship between two constants that live in different sections of
   * balance.ts and have never been edited together.
   *
   * The window is the player's chance to close a walk-up themselves and keep
   * the staff's cut, so longer is friendlier — right up until it outlasts the
   * buyer. `stepProspects` sweeps the expired before `stepAutomation` runs, so
   * a window at or past the least patient buyer's lifetime does not move who
   * closes the deal, it deletes the deal: nobody serves them, and offline that
   * is the whole night's takings for the impatient tail.
   *
   * At 30s against a floor of 31.5s there is one and a half seconds in it. That
   * is deliberate and it is the reason this test exists rather than a comment.
   */
  it('leaves the desk time to reach even the least patient buyer', () => {
    // Patience is flat now — see `generateProspect`'s `expiresAt`.
    const shortestPatience = BALANCE.prospectLifetimeMs;
    // Strictly less, and by at least the tick the desk needs to act on.
    expect(BALANCE.desk.graceMs + TICK_MS).toBeLessThanOrEqual(shortestPatience);
  });

  /**
   * And the same thing said in behaviour rather than in arithmetic, because the
   * inequality above is only correct as long as the sweep still runs before the
   * desk does. A buyer pinned to the shortest patience in the game has to end
   * up sold to, not swept.
   */
  it('still closes a walk-up who is on the shortest fuse in the game', () => {
    const { s, prospect } = lotWithWalkUp();
    const live = s.prospects.find((p) => p.id === prospect.id)!;
    live.expiresAt = live.arrivedAt + BALANCE.prospectLifetimeMs;

    const after = advance(s, BALANCE.prospectLifetimeMs);
    expect(after.stats.carsSold).toBe(s.stats.carsSold + 1);
    // By the desk, which is the half that would go quiet if the sweep won.
    expect(after.stats.commissionPaid).toBeGreaterThan(s.stats.commissionPaid);
  });
});

describe('the house minimum on a sale', () => {
  it('signs a deal that clears the floor', () => {
    const { s, car, prospect } = lotWithWalkUp();
    const cashFloorLevel = levelClearing(s, 'cash', cashMargin(car, 7_000));
    expect(cashFloorLevel).toBeGreaterThan(0);
    s.business = { ...businessDefaults(), cashFloorLevel };

    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    expect(after.stats.carsSold).toBe(s.stats.carsSold + 1);
    expect(after.prospects.some((p) => p.id === prospect.id)).toBe(false);
  });

  /**
   * A REFUSAL IS NOT A WALK-AWAY. The buyer is not thrown off the lot and
   * nothing is logged against the negotiation — the business simply declines to
   * take the money, and they leave when their own patience runs out. Getting
   * this wrong would make a strict floor read as a broken negotiator, and would
   * quietly poison the walk-away rate the harness reports.
   */
  it('leaves a deal under the floor alone, without walking the buyer', () => {
    // A thinner car, so the fixture's $7,000 deal lands mid-ladder and there is
    // a stop above it to refuse with. At $4,000 it clears everything a
    // curbstone lot has, which is the fixture being generous rather than the
    // rule being weak.
    const { s, car, prospect } = lotWithWalkUp({ costBasis: 5_500 });
    s.business = {
      ...businessDefaults(),
      cashFloorLevel: levelRefusing(s, 'cash', cashMargin(car, 7_000)),
    };

    const after = advance(s, BALANCE.desk.graceMs * 4);
    expect(after.stats.carsSold).toBe(s.stats.carsSold);
    expect(after.stats.walkaways).toBe(s.stats.walkaways);
    expect(after.prospects.some((p) => p.id === prospect.id)).toBe(true);
  });

  it('still lets the player close by hand what the desk refused', () => {
    const { s, car, prospect } = lotWithWalkUp({ costBasis: 5_500 });
    s.business = {
      ...businessDefaults(),
      cashFloorLevel: levelRefusing(s, 'cash', cashMargin(car, 7_000)),
    };

    // The desk has had four windows to take it and has not.
    const waited = advance(s, BALANCE.desk.graceMs * 4);
    expect(waited.stats.carsSold).toBe(s.stats.carsSold);

    // The house rules govern what runs WITHOUT you. A tap is still a tap.
    const sold = takeCashDeal(waited, prospect.id);
    expect(sold.stats.carsSold).toBe(s.stats.carsSold + 1);
    expect(sold.cash).toBe(waited.cash + 7_000);
    // And nobody took a cut, because nobody at the desk closed it.
    expect(sold.stats.commissionPaid).toBe(waited.stats.commissionPaid);
    expect(car.costBasis).toBe(5_500);
  });

  /**
   * A FLOOR IT COULD NEVER REACH MUST NOT MAKE THE DESK A MACHINE FOR LOSING
   * CUSTOMERS. Countering is what costs walk-aways, and it buys nothing when
   * even the asking price falls short — so a deal the rule could never sign is
   * one the desk should not open its mouth on at all.
   *
   * Pinned on the fixture rather than measured over a long run, and that is the
   * sharper test: the ladder's top stop is deliberately inside what a curbstone
   * lot can produce, so "nobody ever clears it" is no longer a thing any
   * setting means, and an aggregate assertion would be measuring the ask band.
   */
  it('does not counter on a deal it could never sign', () => {
    const setup = (cashFloorLevel: number) => {
      const { s, car, prospect } = lotWithWalkUp({ costBasis: 5_500 });
      // Undo the fixture's pin: the buyer is lowballing and the desk has not had
      // its turn, so the counter path is live.
      const live = s.prospects.find((p) => p.id === prospect.id)!;
      live.negotiation.currentOffer = 5_000;
      live.negotiation.countersMade = 0;
      s.business = { ...businessDefaults(), cashFloorLevel };
      const after = advance(s, BALANCE.desk.graceMs * 4);
      return { after, car, id: prospect.id };
    };

    const margin = cashMargin({ costBasis: 5_500 }, 7_000);
    const { s: probe } = lotWithWalkUp({ costBasis: 5_500 });
    const shut = setup(levelRefusing(probe, 'cash', margin));
    const open = setup(levelClearing(probe, 'cash', margin));

    // Out of reach even at the ask: no counter, no walk-away, no sale, and the
    // buyer still standing there.
    expect(shut.after.prospects.find((p) => p.id === shut.id)?.negotiation.countersMade).toBe(0);
    expect(shut.after.stats.walkaways).toBe(0);
    expect(shut.after.stats.carsSold).toBe(0);

    // And the same deal one stop down: the desk engages. Whether the counter
    // then lands is the negotiation's business — what this pins is that the
    // silence above is the rule and not a desk that never works.
    expect(
      open.after.prospects.find((p) => p.id === open.id)?.negotiation.countersMade ?? 0,
    ).toBeGreaterThan(0);
  });

  it('gets steadily pickier as the floor rises, rather than switching off at some step', () => {
    const sold = [0, 1, 3, 4, 5, 6].map((cashFloorLevel) => {
      let s = cloneState(createInitialState(808, 0));
      s.upgrades = { salesDesk: 1, autoList: 1, autoBuy: 1, driveway: 3, advertising: 3 };
      s.cash = 200_000;
      s.business = { ...businessDefaults(), cashFloorLevel };
      s = setDealPolicy(s, 'cash');
      return advance(s, 45 * 60_000).stats.carsSold;
    });

    for (let i = 1; i < sold.length; i++) expect(sold[i]).toBeLessThanOrEqual(sold[i - 1]);
    expect(sold[0]).toBeGreaterThan(sold[sold.length - 1]);
  });
});

describe('the house minimum on paper', () => {
  /**
   * JUDGED ON WHAT IT COLLECTS, NOT ON WHAT IT SAYS. A subprime contract has a
   * fat sticker and a thin expected value, so a floor set against the sticker
   * would be a second cash rule. Set against expected collections it is an
   * underwriting standard, which is the whole reason it is a separate slider.
   */
  it('writes the contract when the expected value clears the floor', () => {
    const { s, car, prospect } = lotWithWalkUp({ stage: 'smallUsed' });
    s.dealPolicy = 'finance';
    const financeFloorLevel = levelClearing(s, 'finance', financeMargin(s, car, prospect));
    expect(financeFloorLevel).toBeGreaterThan(0);
    s.business = { ...businessDefaults(), financeFloorLevel };

    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    expect(after.stats.financeDeals).toBe(s.stats.financeDeals + 1);
  });

  it('refuses paper it will not collect on, and sells the car instead', () => {
    // Thin enough that the store has a finance stop above the contract — at
    // $4,000 this fixture's paper clears every one of them, which is the car
    // being a steal rather than the rule being weak.
    const { s, car, prospect } = lotWithWalkUp({ stage: 'smallUsed', costBasis: 5_500 });
    s.dealPolicy = 'finance';
    // Paper is out of reach; cash is not.
    s.business = {
      ...businessDefaults(),
      financeFloorLevel: levelRefusing(s, 'finance', financeMargin(s, car, prospect)),
      cashFloorLevel: 0,
    };

    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    expect(after.stats.financeDeals).toBe(s.stats.financeDeals);
    // A rule the paper fails is not a reason to lose the customer.
    expect(after.stats.cashDeals).toBe(s.stats.cashDeals + 1);
  });

  it('holds the deal when neither side of it clears', () => {
    const { s, car, prospect } = lotWithWalkUp({ stage: 'smallUsed', costBasis: 5_500 });
    s.dealPolicy = 'auto';
    // Both floors set to the first stop THIS deal fails, rather than to the top
    // of each ladder. The two sides sit at different heights — the same car is
    // a 21% cash deal and a 48% contract — so a top-of-ladder assertion would
    // be testing the fixture rather than the rule.
    s.business = {
      ...businessDefaults(),
      cashFloorLevel: levelRefusing(s, 'cash', cashMargin(car, 7_000)),
      financeFloorLevel: levelRefusing(s, 'finance', financeMargin(s, car, prospect)),
    };

    // One window exactly. Longer and a SECOND walk-up can arrive at the same
    // car and be judged on its own merits — which it is entitled to be, and
    // which would make this assertion about traffic rather than about the rule.
    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    const still = after.prospects.find((p) => p.id === prospect.id);
    expect(still).toBeDefined();
    expect(still!.negotiation.status).not.toBe('walked');
    expect(after.stats.carsSold).toBe(s.stats.carsSold);
  });

  it('is inert at its default, on every stage', () => {
    for (const stage of ['curbstone', 'smallUsed'] as const) {
      const { s, prospect } = lotWithWalkUp({ stage });
      s.business = businessDefaults();
      const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
      expect(after.prospects.some((p) => p.id === prospect.id)).toBe(false);
      expect(after.stats.carsSold).toBe(s.stats.carsSold + 1);
    }
  });
});
