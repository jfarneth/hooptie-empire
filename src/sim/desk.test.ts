import {
  claimDeal,
  moveToStage,
  purchaseUpgrade,
  pushedTerms,
  releaseDeal,
  setDealPolicy,
  takeCashDeal,
} from './actions';
import { BALANCE, TICK_MS } from './balance';
import {
  OFFER_FLOOR_LEVELS,
  PAYMENT_PUSH_LEVELS,
  businessDefaults,
} from './business';
import { generateCar } from './cars';
import { generateProspect } from './customers';
import { getModel } from './models';
import { advance, cloneState, createInitialState, expectedCollections } from './engine';
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

describe('the house minimum on a cash offer', () => {
  /**
   * The rule is HOW CLOSE TO THE ASK, not a margin. It replaced a per-store
   * ladder of minimum margins, and the change is the point: a share of your own
   * sticker means the same thing at every rung, so these tests need no per-stage
   * fixture arithmetic at all — which is exactly the simplification the old
   * `levelClearing`/`levelRefusing` helpers existed to work around.
   */
  it('signs an offer that clears the floor', () => {
    const { s, prospect } = lotWithWalkUp();
    const live = s.prospects.find((p) => p.id === prospect.id)!;
    // Right at the sticker, so every stop on the ladder is satisfied.
    live.negotiation.currentOffer = live.negotiation.anchor;
    live.negotiation.countersMade = 1;
    s.business = { ...businessDefaults(), offerFloorLevel: OFFER_FLOOR_LEVELS };

    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    expect(after.stats.carsSold).toBe(s.stats.carsSold + 1);
  });

  /**
   * A REFUSAL IS NOT A WALK-AWAY. The buyer is not thrown off the lot and
   * nothing is logged against the negotiation — the business simply declines to
   * take the money, and they leave when their own patience runs out. Getting
   * this wrong would make a strict floor read as a broken negotiator, and would
   * quietly poison the walk-away rate the harness reports.
   */
  it('leaves an offer under the floor alone, without walking the buyer', () => {
    const { s, prospect } = lotWithWalkUp();
    const live = s.prospects.find((p) => p.id === prospect.id)!;
    // A deep lowball, and the desk has already had its counter.
    live.negotiation.currentOffer = Math.round(live.negotiation.anchor * 0.6);
    live.negotiation.countersMade = 1;
    s.business = { ...businessDefaults(), offerFloorLevel: OFFER_FLOOR_LEVELS };

    const after = advance(s, BALANCE.desk.graceMs * 4);
    expect(after.stats.carsSold).toBe(s.stats.carsSold);
    expect(after.stats.walkaways).toBe(s.stats.walkaways);
    expect(after.prospects.some((p) => p.id === prospect.id)).toBe(true);
  });

  it('still lets the player close by hand what the desk refused', () => {
    const { s, prospect } = lotWithWalkUp();
    const live = s.prospects.find((p) => p.id === prospect.id)!;
    live.negotiation.currentOffer = Math.round(live.negotiation.anchor * 0.6);
    live.negotiation.countersMade = 1;
    const offer = live.negotiation.currentOffer;
    s.business = { ...businessDefaults(), offerFloorLevel: OFFER_FLOOR_LEVELS };

    const waited = advance(s, BALANCE.desk.graceMs * 4);
    expect(waited.stats.carsSold).toBe(s.stats.carsSold);

    // The house rules govern what runs WITHOUT you. A tap is still a tap.
    const sold = takeCashDeal(waited, prospect.id);
    expect(sold.stats.carsSold).toBe(s.stats.carsSold + 1);
    expect(sold.cash).toBe(waited.cash + offer);
    // And nobody took a cut, because nobody at the desk closed it.
    expect(sold.stats.commissionPaid).toBe(waited.stats.commissionPaid);
  });

  /**
   * IT SELLS UNDER COST IF YOU PRICE IT THERE, which is the whole reason this
   * stopped being a margin rule. The desk's job is to hold out for the sticker;
   * whether the sticker is above what the car owes is the pricing desk's
   * business, and a lot priced to clear is a lot that clears.
   */
  it('will sign a deal that loses money, when the ask is under cost', () => {
    const { s, car, prospect } = lotWithWalkUp({ costBasis: 9_000 });
    const live = s.prospects.find((p) => p.id === prospect.id)!;
    live.negotiation.currentOffer = live.negotiation.anchor;
    live.negotiation.countersMade = 1;
    // Strictest cash rule there is — and it still signs, because the rule is
    // about the ask and not about the margin.
    s.business = { ...businessDefaults(), offerFloorLevel: OFFER_FLOOR_LEVELS };
    expect(live.negotiation.anchor).toBeLessThan(car.costBasis);

    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    expect(after.stats.carsSold).toBe(s.stats.carsSold + 1);
    expect(after.stats.lifetimeProfit).toBeLessThan(s.stats.lifetimeProfit);
  });

  /**
   * Pooled across seeds, because "pickier" is a property of the RULE and not of
   * any one afternoon. On a single seed a stricter desk can genuinely sell more
   * — it refuses a lowball, that buyer leaves, and a better one walks up to the
   * same car — so a per-seed monotonic assertion measures the traffic model's
   * variance rather than the floor.
   */
  it('gets steadily pickier as the floor rises, rather than switching off at some step', () => {
    const sold = [0, 1, 2, 3, 4, 5].map((offerFloorLevel) => {
      let total = 0;
      for (const seed of [808, 809, 810, 811]) {
        let s = cloneState(createInitialState(seed, 0));
        s.upgrades = { salesDesk: 1, autoList: 1, autoBuy: 1, driveway: 3, advertising: 3 };
        s.cash = 200_000;
        s.business = { ...businessDefaults(), offerFloorLevel };
        s = setDealPolicy(s, 'cash');
        total += advance(s, 45 * 60_000).stats.carsSold;
      }
      return total;
    });

    for (let i = 1; i < sold.length; i++) expect(sold[i]).toBeLessThanOrEqual(sold[i - 1]);
    expect(sold[0]).toBeGreaterThan(sold[sold.length - 1]);
  });
});

describe('how hard the desk pushes a financed buyer', () => {
  /**
   * The paper rule stopped being a floor and became a PUSH, because that is the
   * decision a finance office actually makes: the customer is buying a weekly
   * payment and the house is selling what the contract collects.
   */
  it('writes the contract at their own number when the rule is off', () => {
    const { s, prospect } = lotWithWalkUp({ stage: 'smallUsed' });
    s.dealPolicy = 'finance';
    s.business = { ...businessDefaults(), paymentPushLevel: 0 };
    const theirs = s.prospects.find((p) => p.id === prospect.id)!.financeTerms.weeklyPayment;

    const after = advance(s, BALANCE.desk.graceMs + TICK_MS);
    expect(after.stats.financeDeals).toBe(s.stats.financeDeals + 1);
    // Their payment, to the cent, and nobody was priced out.
    expect(after.notes[after.notes.length - 1].paymentAmount).toBeCloseTo(theirs, 2);
    expect(after.stats.walkaways).toBe(s.stats.walkaways);
  });

  /**
   * What the push does to a contract, exactly.
   *
   * The payment and the principal behind it scale together and nothing else
   * moves, which is what makes "for them it is the payment, for us it is total
   * collected" arithmetic rather than a slogan. Asserted here rather than over a
   * run because a run cannot say it cleanly — see the test below.
   */
  it('scales the payment and the principal together, and nothing else', () => {
    const { s, prospect } = lotWithWalkUp({ stage: 'smallUsed' });
    const live = s.prospects.find((p) => p.id === prospect.id)!;
    const base = live.financeTerms;

    const pushed = pushedTerms(live, 1.2);
    expect(pushed.payment).toBeCloseTo(base.weeklyPayment * 1.2, 1);
    expect(pushed.terms.amountFinanced).toBe(Math.round(base.amountFinanced * 1.2));
    // The term and the rate are the customer's and stay the customer's.
    expect(pushed.terms.weeks).toBe(base.weeks);
    expect(pushed.terms.apr).toBe(base.apr);
    // And a push of 1 is the identity, which is what makes the rule inert at
    // its default rather than merely gentle.
    expect(pushedTerms(live, 1).payment).toBe(base.weeklyPayment);
  });

  /**
   * And the same thing over real runs — but only against a push big enough to
   * be visible, which is a fact about measurement rather than about the rule.
   *
   * Moving the push changes what the RNG is spent on, so two settings are two
   * different runs: measured, the mean principal financed differs by 8% between
   * adjacent stops purely from the reshuffle, which swamps a 5% push entirely.
   * The exact claim is the unit test above; this is the end-to-end sanity check,
   * pooled across seeds and set against a stop where the signal clears the
   * noise.
   */
  it('writes visibly bigger contracts at a real push', () => {
    const meanPayment = (paymentPushLevel: number) => {
      let paid = 0;
      let count = 0;
      for (const seed of [4242, 4243, 4244]) {
        let s = cloneState(createInitialState(seed, 0));
        s.cash = 400_000_000;
        s = moveToStage(s, 'smallUsed');
        s.cash = 400_000;
        s.upgrades = { ...s.upgrades, salesDesk: 1, autoList: 1, autoBuy: 1, lot: 2, collections: 4 };
        s.business = { ...businessDefaults(), paymentPushLevel };
        s = setDealPolicy(s, 'finance');
        for (const n of advance(s, 60 * 60_000).notes) {
          if (n.originalPrincipal <= 0) continue;
          paid += n.paymentAmount;
          count += 1;
        }
      }
      expect(count).toBeGreaterThan(30);
      return paid / count;
    };

    expect(meanPayment(3)).toBeGreaterThan(meanPayment(0));
  });

  /**
   * AND SOME OF THEM LEAVE. A push that never cost anything would make "all
   * they can carry" the only correct setting, which is not a decision.
   */
  it('prices some buyers out entirely at the top of the ladder', () => {
    const walkaways = [0, PAYMENT_PUSH_LEVELS].map((paymentPushLevel) => {
      let s = cloneState(createInitialState(99, 0));
      s.cash = 400_000_000;
      s = moveToStage(s, 'smallUsed');
      s.cash = 400_000;
      s.upgrades = { ...s.upgrades, salesDesk: 1, autoList: 1, autoBuy: 1, lot: 2, collections: 4 };
      s.business = { ...businessDefaults(), paymentPushLevel };
      s = setDealPolicy(s, 'finance');
      return advance(s, 60 * 60_000).stats.walkaways;
    });

    expect(walkaways[0]).toBeLessThan(walkaways[1]);
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
