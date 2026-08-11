import { claimDeal, moveToStage, purchaseUpgrade, releaseDeal, setDealPolicy, takeCashDeal } from './actions';
import { BALANCE, TICK_MS } from './balance';
import { businessDefaults, repoThreshold } from './business';
import { generateCar } from './cars';
import { generateProspect } from './customers';
import { getModel } from './models';
import { advance, cloneState, createInitialState, expectedCollections } from './engine';
import { stateFinanceScale, stateMarginScale, zOfMargin } from './margins';
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
function lotWithWalkUp(over: { stage?: StageId; claim?: boolean } = {}) {
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
    costBasis: 4_000,
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
 * The fixture's deal in σ. The car cost $4,000 and the buyer is standing at
 * $7,000, so this is a 42.9% margin — a good deal at a curbstone lot and about
 * +1.8σ on its scale. Derived rather than written down, because the scale moves
 * with any tuning pass on the ask band and a hard-coded 1.8 would rot into a
 * test that passes for the wrong reason.
 */
function cashZ(s: GameState, car: { costBasis: number }, price: number): number {
  return zOfMargin(stateMarginScale(s, getStage(s.stage)), (price - car.costBasis) / price);
}

/** The same deal as the finance desk prices it: expected collections, not sticker. */
function financeZ(s: GameState, car: { costBasis: number }, prospect: any): number {
  const capFactor = overCapacityFactor(activeNotes(s.notes).length, collectionsCapacity(s));
  const ev =
    prospect.downPayment +
    expectedCollections(
      prospect.financeTerms.weeks,
      prospect.financeTerms.weeklyPayment,
      BALANCE.creditTiers[prospect.tier as CreditTier].missChance * capFactor,
      repoThreshold(s),
    ).expectedCollected;
  // Measured against the FINANCE scale, not the cash one. A contract grosses the
  // window price and then collects part of it, so the same σ position is a
  // different margin on the two sides of the desk; reading paper off the cash
  // scale is precisely the bug `financeMarginScale` exists to prevent.
  const stage = getStage(s.stage);
  return zOfMargin(stateFinanceScale(s, stage, stateMarginScale(s, stage)), (ev - car.costBasis) / ev);
}

describe('the house minimum on a sale', () => {
  it('signs a deal that clears the floor', () => {
    const { s, car, prospect } = lotWithWalkUp();
    s.business = { ...businessDefaults(), minCashMarginZ: cashZ(s, car, 7_000) - 0.5 };

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
    const { s, car, prospect } = lotWithWalkUp();
    s.business = { ...businessDefaults(), minCashMarginZ: cashZ(s, car, 7_000) + 0.5 };

    const after = advance(s, BALANCE.desk.graceMs * 4);
    expect(after.stats.carsSold).toBe(s.stats.carsSold);
    expect(after.stats.walkaways).toBe(s.stats.walkaways);
    expect(after.prospects.some((p) => p.id === prospect.id)).toBe(true);
  });

  it('still lets the player close by hand what the desk refused', () => {
    const { s, car, prospect } = lotWithWalkUp();
    s.business = { ...businessDefaults(), minCashMarginZ: BALANCE.business.marginZMax };

    // The desk has had four windows to take it and has not.
    const waited = advance(s, BALANCE.desk.graceMs * 4);
    expect(waited.stats.carsSold).toBe(s.stats.carsSold);

    // The house rules govern what runs WITHOUT you. A tap is still a tap.
    const sold = takeCashDeal(waited, prospect.id);
    expect(sold.stats.carsSold).toBe(s.stats.carsSold + 1);
    expect(sold.cash).toBe(waited.cash + 7_000);
    // And nobody took a cut, because nobody at the desk closed it.
    expect(sold.stats.commissionPaid).toBe(waited.stats.commissionPaid);
    expect(car.costBasis).toBe(4_000);
  });

  /**
   * A floor nothing can reach must not turn the desk into a machine for losing
   * customers. It counters to try to LIFT a deal over the line, so a deal that
   * could never clear is one it should not engage with at all — no counter, no
   * walk-away, over a run long enough for hundreds of walk-ups.
   */
  it('does not counter on deals it could never sign', () => {
    const run = (z: number) => {
      let s = cloneState(createInitialState(4242, 0));
      s.upgrades = { salesDesk: 1, autoList: 1, autoBuy: 1, driveway: 3, advertising: 3 };
      s.cash = 200_000;
      s.business = { ...businessDefaults(), minCashMarginZ: z };
      s = setDealPolicy(s, 'cash');
      return advance(s, 45 * 60_000).stats;
    };

    const open = run(BALANCE.business.marginZOff);
    const shut = run(BALANCE.business.marginZMax);

    expect(open.walkaways).toBeGreaterThan(0);
    expect(open.carsSold).toBeGreaterThan(0);
    // Nothing at a curbstone lot clears +3σ, so the desk never opened its mouth.
    expect(shut.walkaways).toBe(0);
    expect(shut.carsSold).toBe(0);
  });

  it('gets steadily pickier as the floor rises, rather than switching off at some step', () => {
    const sold = [BALANCE.business.marginZOff, -1, 0, 1, 2].map((z) => {
      let s = cloneState(createInitialState(808, 0));
      s.upgrades = { salesDesk: 1, autoList: 1, autoBuy: 1, driveway: 3, advertising: 3 };
      s.cash = 200_000;
      s.business = { ...businessDefaults(), minCashMarginZ: z };
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
    s.business = { ...businessDefaults(), minFinanceMarginZ: financeZ(s, car, prospect) - 0.5 };

    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    expect(after.stats.financeDeals).toBe(s.stats.financeDeals + 1);
  });

  it('refuses paper it will not collect on, and sells the car instead', () => {
    const { s, car, prospect } = lotWithWalkUp({ stage: 'smallUsed' });
    s.dealPolicy = 'finance';
    // Paper is out of reach; cash is not.
    s.business = {
      ...businessDefaults(),
      minFinanceMarginZ: financeZ(s, car, prospect) + 0.5,
      minCashMarginZ: BALANCE.business.marginZOff,
    };

    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    expect(after.stats.financeDeals).toBe(s.stats.financeDeals);
    // A rule the paper fails is not a reason to lose the customer.
    expect(after.stats.cashDeals).toBe(s.stats.cashDeals + 1);
  });

  it('holds the deal when neither side of it clears', () => {
    const { s, car, prospect } = lotWithWalkUp({ stage: 'smallUsed' });
    s.dealPolicy = 'auto';
    // Both floors set just above what THIS deal delivers, rather than at the top
    // of the scale. The fixture's car is deliberately cheap against its retail,
    // so a nominal +3σ is a floor it can clear on paper — which is the finance
    // scale behaving correctly and would make a top-of-scale assertion a test of
    // the fixture rather than of the rule.
    s.business = {
      ...businessDefaults(),
      minCashMarginZ: cashZ(s, car, 7_000) + 0.5,
      minFinanceMarginZ: financeZ(s, car, prospect) + 0.5,
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
