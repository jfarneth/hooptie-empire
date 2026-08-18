import { buyProperty, moveToStage, purchaseUpgrade, sellKeptStore, stageMovePreview } from './actions';
import { BALANCE, MS_PER_GAME_WEEK } from './balance';
import { empireChequePerWeek, keptAt, keptChequePerWeek, selloffValue } from './empire';
import { advance, cloneState, createInitialState, weeklyExpenses } from './engine';
import { retirementPreview } from './prestige';
import { hireTech } from './shop';
import { getStage } from './stages';
import { UPGRADES, level } from './upgrades';
import type { GameState } from './types';

/**
 * The empire: stores kept running under managers.
 *
 * The rules under test are the ones that would be exploits or traps if they
 * broke. Keeping must release NOBODY (or the confirmation lies), resuming must
 * be FREE and restore the office (or the walk-down loop the deeds are priced
 * for does not exist), the cheque must land on the group's line at managed net
 * less rent (or the deed's value to a kept store evaporates), and the default
 * move must stay byte-identical to the old one (or every existing save's
 * expectations quietly change).
 */

function goingConcern(stageId: 'smallUsed' | 'largeUsed' | 'midsizeFranchise' = 'smallUsed'): GameState {
  const s = cloneState(createInitialState(55, 0));
  s.stage = stageId;
  s.cash = 500_000_000;
  s.upgrades = { salesDesk: 1, autoBuy: 1, autoList: 1, scout: 2, collections: 3, lot: 1 };
  return s;
}

describe('keeping a store', () => {
  it('needs somebody to run it: no desk, no keep', () => {
    const s = goingConcern();
    delete s.upgrades.salesDesk;
    const preview = stageMovePreview(s, 'largeUsed', { keepCurrent: true });
    expect(preview.canKeep).toBe(false);
    expect(preview.keeping).toBe(false);

    const after = moveToStage(s, 'largeUsed', { keepCurrent: true });
    expect(after.empire).toEqual([]);
  });

  it('stores the office with the store and releases nobody', () => {
    const s = goingConcern();
    const preview = stageMovePreview(s, 'largeUsed', { keepCurrent: true });
    expect(preview.keeping).toBe(true);
    // Nobody is lost — that is the whole point of keeping.
    expect(preview.staffLost).toEqual([]);
    expect(preview.techsReleased).toBe(0);

    const after = moveToStage(s, 'largeUsed', { keepCurrent: true });
    const kept = keptAt(after, 'smallUsed')!;
    expect(kept).toBeDefined();
    // The office stays with the store — except the collections desk, which
    // follows the paper and therefore the player.
    expect(kept.upgrades.salesDesk).toBe(1);
    expect(kept.upgrades.autoBuy).toBe(1);
    expect(kept.upgrades.collections).toBeUndefined();
    expect(level(after, 'collections')).toBe(3);
    // The new store still starts from scratch.
    expect(level(after, 'salesDesk')).toBe(0);
  });

  it('keeps the technicians with the store they work at', () => {
    const s = goingConcern('midsizeFranchise');
    s.upgrades.serviceBays = 2;
    hireTech(s, 4);
    hireTech(s, 1);
    s.shop.techs[0].xp = 1_234;

    const after = moveToStage(s, 'premiumFranchise', { keepCurrent: true });
    expect(after.shop.techs).toEqual([]);
    const kept = keptAt(after, 'midsizeFranchise')!;
    expect(kept.techs).toHaveLength(2);
    expect(kept.techs[0].xp).toBe(1_234);
  });

  it('still liquidates the lot — keeping the store is not keeping the stock', () => {
    let s = goingConcern();
    s.cash = 5_000_000;
    s = advance(s, 20 * 60 * 1000);
    const held = s.cars.filter((c) => c.status !== 'sold').length;
    expect(held).toBeGreaterThan(0);

    const after = moveToStage(s, 'largeUsed', { keepCurrent: true });
    expect(after.cars.filter((c) => c.status !== 'sold')).toEqual([]);
  });
});

describe('the cheque', () => {
  it('pays managed net less rent on the bill beat, on the group line', () => {
    let s = goingConcern();
    s = moveToStage(s, 'largeUsed', { keepCurrent: true });
    s.listings = [];
    s.upgrades = {}; // nothing running at the new store: the cheque is the only income

    const expected = getStage('smallUsed').managedNetPerWeek - getStage('smallUsed').rentPerWeek;
    expect(keptChequePerWeek(s, 'smallUsed')).toBe(expected);
    expect(expected).toBeGreaterThan(0);

    const linesBefore = { ...s.weekLines.empire };
    s = advance(s, MS_PER_GAME_WEEK + 2_000);
    expect(s.weekLines.empire.revenue - linesBefore.revenue + (s.weeks[0]?.lines?.empire.revenue ?? 0)).toBeGreaterThanOrEqual(0);
    // The filed week carries the cheque on the group's line, to the dollar.
    const filed = s.weeks[s.weeks.length - 1].lines!;
    expect(filed.empire.revenue).toBe(expected);
    expect(filed.empire.profit).toBe(expected);
  });

  it('pays the rent back the day you own the ground', () => {
    let s = goingConcern();
    // Buy the small lot's deed while standing there, then leave and keep it.
    s = buyProperty(s);
    s = moveToStage(s, 'largeUsed', { keepCurrent: true });

    expect(keptChequePerWeek(s, 'smallUsed')).toBe(getStage('smallUsed').managedNetPerWeek);
    expect(keptChequePerWeek(s, 'smallUsed') - (getStage('smallUsed').managedNetPerWeek - getStage('smallUsed').rentPerWeek)).toBe(
      getStage('smallUsed').rentPerWeek,
    );
  });

  it('pays nothing at all with the A/B constant zeroed', () => {
    const knobs = BALANCE.empire as { chequeScale: number };
    const prev = knobs.chequeScale;
    knobs.chequeScale = 0;
    try {
      let s = goingConcern();
      s = moveToStage(s, 'largeUsed', { keepCurrent: true });
      expect(empireChequePerWeek(s)).toBe(0);
      const cash = s.cash;
      s.listings = [];
      s.upgrades = {};
      const after = advance(s, MS_PER_GAME_WEEK + 2_000);
      // Only the new store's own bill moved the till; the empire added nothing.
      expect(after.cash - cash).toBeLessThanOrEqual(0);
    } finally {
      knobs.chequeScale = prev;
    }
  });
});

describe('resuming', () => {
  it('is free, restores the office and the crew, and stops the cheque', () => {
    let s = goingConcern('midsizeFranchise');
    s.upgrades.serviceBays = 2;
    hireTech(s, 3);
    s = moveToStage(s, 'premiumFranchise', { keepCurrent: true });
    // Grow the desk that travels, so the merge on return is observable.
    while (level(s, 'collections') < 4) s = purchaseUpgrade(s, 'collections');

    const cashBefore = s.cash;
    const back = moveToStage(s, 'midsizeFranchise');

    // Free: no entry price. The lot at premium had nothing on it to liquidate.
    expect(back.stage).toBe('midsizeFranchise');
    expect(cashBefore - back.cash).toBe(0);
    // The office is back, the travelling desk kept its growth, the crew kept
    // their experience, and the store left the empire.
    expect(level(back, 'salesDesk')).toBe(1);
    expect(level(back, 'serviceBays')).toBe(2);
    expect(level(back, 'collections')).toBe(4);
    expect(back.shop.techs).toHaveLength(1);
    expect(keptAt(back, 'midsizeFranchise')).toBeUndefined();
  });

  /**
   * THE WALK-DOWN LOOP, whole: keep the franchise, drive down, buy the house,
   * drive back for free. This is the play the property prices were set for and
   * the reason resuming exists — priced under the old rules the return trip
   * costs the franchise entry again, which is what made the loop feel like a
   * punishment rather than a strategy.
   */
  it('makes the deed run a round trip instead of a round price', () => {
    let s = goingConcern('midsizeFranchise');
    s = moveToStage(s, 'curbstone', { keepCurrent: true });
    expect(keptAt(s, 'midsizeFranchise')).toBeDefined();

    s = buyProperty(s);
    expect(s.properties.map((p) => p.stage)).toEqual(['curbstone']);
    expect(s.prestige.points).toBe(getStage('curbstone').propertyPoints);

    const cashBefore = s.cash;
    s = moveToStage(s, 'midsizeFranchise');
    expect(s.stage).toBe('midsizeFranchise');
    expect(cashBefore - s.cash).toBe(0);
    expect(level(s, 'salesDesk')).toBe(1);
  });
});

describe('selling a kept store off', () => {
  it('pays the goodwill price once, on the group line, and goes dark', () => {
    let s = goingConcern();
    s = moveToStage(s, 'largeUsed', { keepCurrent: true });

    const price = selloffValue('smallUsed');
    expect(price).toBe(Math.round(getStage('smallUsed').managedNetPerWeek * BALANCE.empire.selloffWeeks));

    const cash = s.cash;
    const profit = s.stats.lifetimeProfit;
    const sold = sellKeptStore(s, 'smallUsed');
    expect(sold.cash - cash).toBe(price);
    expect(sold.stats.lifetimeProfit - profit).toBe(price);
    expect(sold.weekLines.empire.revenue).toBeGreaterThanOrEqual(price);
    expect(keptAt(sold, 'smallUsed')).toBeUndefined();

    // Once. A store already sold is not for sale.
    expect(sellKeptStore(sold, 'smallUsed')).toBe(sold);
  });
});

describe('the empire and the rest of the game', () => {
  it('joins the retirement sale at the goodwill price', () => {
    let s = goingConcern();
    s = moveToStage(s, 'largeUsed', { keepCurrent: true });
    const sale = retirementPreview(s);
    expect(sale.keptCount).toBe(1);
    expect(sale.keptValue).toBe(selloffValue('smallUsed'));
    expect(sale.gross).toBe(sale.cash + sale.lotValue + sale.bookValue + sale.propertyValue + sale.keptValue);
  });

  it('does not share kept offices between a state and its clone', () => {
    let s = goingConcern();
    s = moveToStage(s, 'largeUsed', { keepCurrent: true });
    const copy = cloneState(s);
    copy.empire[0].upgrades.salesDesk = 99;
    copy.empire[0].techs.push({ id: 'x', name: 'x', grade: 0, xp: 0, hiredAt: 0, jobId: null });
    expect(keptAt(s, 'smallUsed')!.upgrades.salesDesk).toBe(1);
    expect(keptAt(s, 'smallUsed')!.techs).toHaveLength(0);
  });

  it('leaves the default move exactly as it always was', () => {
    const s = goingConcern();
    const after = moveToStage(s, 'largeUsed');
    expect(after.empire).toEqual([]);
    expect(level(after, 'salesDesk')).toBe(0);
    // Every abandoned line is named, exactly as before the empire existed.
    const preview = stageMovePreview(s, 'largeUsed');
    const named = preview.staffLost.map((x) => x.name).sort();
    const lost = UPGRADES.filter((u) => !u.carriesOnMove && level(s, u.id) > 0)
      .map((u) => u.name)
      .sort();
    expect(named).toEqual(lost);
  });
});
