import { claimDeal, moveToStage, purchaseUpgrade, releaseDeal, setDealPolicy, takeCashDeal } from './actions';
import { BALANCE, TICK_MS } from './balance';
import { generateProspect } from './customers';
import { advance, cloneState, createInitialState } from './engine';
import { haggleSkillFor } from './skills';
import { migrate } from './save';
import { STAGES, getStage } from './stages';
import { weeklyExpenses } from './engine';
import { UPGRADES, weeklyWage } from './upgrades';
import type { GameState, StageId } from './types';

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
  const car = {
    ...s.listings[0].car,
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
