import { BALANCE } from './balance';
import { businessDefaults } from './business';
import { generateCar } from './cars';
import { generateProspect } from './customers';
import { advance, createInitialState } from './engine';
import { getModel } from './models';
import { expectedCollections } from './notes';
import { haggleSkillFor } from './skills';
import { retailValue } from './economy';
import { landedCost } from './market';
import {
  buyMarginRange,
  freightMoments,
  financeGrossMultiple,
  financeMarginScale,
  marginScale,
  stateMarginScale,
  zOfMargin,
} from './margins';
import { STAGES, getStage, stageRank } from './stages';
import type { StageId } from './types';

/**
 * The yardstick, and the ladder it keeps honest.
 *
 * `marginScale` claims to describe the margin distribution of a store's feed.
 * The sales floors are no longer denominated in its standard deviations — they
 * are hard numbers per store — but this is still what the panel quotes them
 * against, what sets the ends of the buy slider, and what the ladder's guard
 * test measures. If the claim is wrong, a stop the panel calls "about an
 * average deal" is nothing of the sort. The load-bearing test here is the one
 * that runs the real engine, collects the listings it actually spawns, and
 * checks the model against them. Everything above it is shape.
 */

describe('the deal-margin scale', () => {
  it('falls as the ladder climbs, in both average and spread', () => {
    const used = ['curbstone', 'smallUsed', 'largeUsed'] as const;
    const franchise = ['lowCostFranchise', 'midsizeFranchise', 'premiumFranchise'] as const;

    // Judgement stores are wide; invoice stores are narrow. That difference is
    // the character of the two halves of the ladder, and it is why the sales
    // floors have to be tabulated per store rather than shared.
    for (const id of used) {
      expect(marginScale(getStage(id)).sd).toBeGreaterThan(0.08);
    }
    for (const id of franchise) {
      expect(marginScale(getStage(id)).sd).toBeLessThan(0.03);
    }

    const premium = marginScale(getStage('premiumFranchise'));
    const curbstone = marginScale(getStage('curbstone'));
    expect(premium.mean).toBeLessThan(curbstone.mean);
    expect(premium.sd).toBeLessThan(curbstone.sd);
  });

  it('brackets what each store can actually produce', () => {
    for (const stage of STAGES) {
      const scale = marginScale(stage);
      // The band is symmetric about the mean and the mean is inside the
      // achievable range, or the whole scale is describing another game.
      expect(scale.worst).toBeLessThan(scale.mean);
      expect(scale.best).toBeGreaterThan(scale.mean);
    }
  });

  it('reaches below cost on the buy slider at every store, including the invoice ones', () => {
    for (const stage of STAGES) {
      const range = buyMarginRange(stage);
      // Negative at the bottom — the overpay allowance the buyer is allowed to
      // be given — and zero, the default, always inside it.
      expect(range.min).toBeLessThan(0);
      expect(range.max).toBeGreaterThan(0);
    }
    // At a franchise every car the store can source is profitable, so this range
    // reaches below break-even only because `buyMarginBelowCost` pulls it there.
    // Without it the buyer could not be set to break-even, let alone below it.
    expect(marginScale(getStage('premiumFranchise')).worst).toBeGreaterThan(0);
  });

  /**
   * The panel's verdict on a stop ("about an average deal here") is this
   * function and nothing else, so it has to measure from the store's own mean
   * in the store's own spread.
   */
  it('reads a margin as a distance from an ordinary deal at that store', () => {
    const scale = marginScale(getStage('smallUsed'));
    expect(zOfMargin(scale, scale.mean)).toBe(0);
    expect(zOfMargin(scale, scale.mean + scale.sd)).toBeCloseTo(1, 10);
    expect(zOfMargin(scale, scale.mean - 2 * scale.sd)).toBeCloseTo(-2, 10);
    // The same margin is a different verdict at a different store, which is the
    // whole reason the ladder behind it is per store.
    expect(zOfMargin(marginScale(getStage('premiumFranchise')), scale.mean)).toBeGreaterThan(3);
  });

  it('reads a store with no spread as z = 0 rather than dividing by zero', () => {
    const flat = { ...getStage('premiumFranchise') };
    flat.sourcing = { ...flat.sourcing, askMin: 1.2, askMax: 1.2, raritySellerCapture: 1 };
    const scale = marginScale(flat);
    expect(scale.sd).toBe(0);
    expect(Number.isFinite(zOfMargin(scale, 0.4))).toBe(true);
  });
});

/** Reach is sold from the large lot up, so nothing below it ever pays freight. */
function canEverReach(id: StageId): boolean {
  return stageRank(id) >= stageRank('largeUsed');
}

describe('freight is inside the yardstick', () => {
  it('is zero for a local-only lot and real once reach is bought', () => {
    const stage = getStage('largeUsed');
    expect(freightMoments({ upgrades: {} }, stage)).toEqual({ mean: 0, sd: 0 });

    const national = freightMoments({ upgrades: { reach: 2 } }, stage);
    expect(national.mean).toBeGreaterThan(0);
    // And it is not a flat bill: one car drove itself here and the next came
    // across the country, which is variance the margin scale has to carry.
    expect(national.sd).toBeGreaterThan(0);
    expect(freightMoments({ upgrades: { reach: 1 } }, stage).mean).toBeLessThan(national.mean);
  });

  it('moves the whole scale down without changing its width', () => {
    const stage = getStage('premiumFranchise');
    const local = marginScale(stage);
    const shipped = marginScale(stage, { freight: { mean: 0.012, sd: 0 } });
    expect(shipped.mean).toBeCloseTo(local.mean - 0.012, 10);
    expect(shipped.sd).toBeCloseTo(local.sd, 10);
  });

  it('folds a career of buy-side edge in, so a prestiged dealer is quoted their own average', () => {
    const stage = getStage('curbstone');
    const fresh = { upgrades: {}, prestige: { points: 0, retirements: 0, bestRun: 0, lifetimeSold: 0 } };
    const veteran = { ...fresh, prestige: { ...fresh.prestige, points: 40 } };
    expect(stateMarginScale(veteran as any, stage).mean).toBeGreaterThan(
      stateMarginScale(fresh as any, stage).mean,
    );
  });
});

/**
 * PAPER IS NOT CASH, and the finance floor needs its own yardstick or two
 * thirds of its slider does nothing.
 *
 * A financed car leaves at the window price and then only part of the contract
 * is collected, so an ordinary piece of paper is worth far more than an ordinary
 * cash deal on the same car. Measured against the cash scale it sits well over
 * +1σ, which would have made every stop below that a no-op and had the panel
 * describe a routine subprime contract as "a steal".
 */
describe('the finance scale', () => {
  it('is silent where there is no finance desk', () => {
    expect(financeGrossMultiple(getStage('curbstone'))).toBe(1);
  });

  it('grosses more than cash retail, and narrows as it lifts', () => {
    const stage = getStage('smallUsed');
    const cash = marginScale(stage);
    const g = financeGrossMultiple(stage);
    const paper = financeMarginScale(cash, g);

    expect(g).toBeGreaterThan(1);
    // Below the window markup, because a contract is not collected in full.
    expect(g).toBeLessThan(stage.bhphMultiplier);
    expect(paper.mean).toBeGreaterThan(cash.mean);
    expect(paper.sd).toBeLessThan(cash.sd);
    expect(paper.grossOfRetail).toBeCloseTo(g, 10);
  });

  /**
   * The whole reason it is a separate scale: on the cash yardstick, an average
   * contract is already a "good deal", so the bottom half of the finance slider
   * would be dead and its middle would be a cliff.
   */
  it('puts an average contract at 0σ where the cash scale would call it a steal', () => {
    const stage = getStage('smallUsed');
    const cash = marginScale(stage);
    const paper = financeMarginScale(cash, financeGrossMultiple(stage));

    expect(zOfMargin(paper, paper.mean)).toBe(0);
    expect(zOfMargin(cash, paper.mean)).toBeGreaterThan(1);
  });

  it('is worth less when the desk is buried, and more when underwriting is bought', () => {
    const stage = getStage('smallUsed');
    const base = financeGrossMultiple(stage);
    expect(financeGrossMultiple(stage, { capacityFactor: 2 })).toBeLessThan(base);
    expect(financeGrossMultiple(stage, { underwritingLevel: 3 })).toBeGreaterThan(base);
    // The player's own repo trigger is in it too — more rope collects more.
    expect(financeGrossMultiple(stage, { repoTrigger: 6 })).toBeGreaterThan(
      financeGrossMultiple(stage, { repoTrigger: 1 }),
    );
  });

  /**
   * Against the game rather than against itself: the contracts the engine
   * actually writes, priced the way the desk prices them.
   */
  it('predicts what a walk-up contract is actually worth', () => {
    const stage = getStage('smallUsed');
    let s = createInitialState(31_337, 0);
    s = { ...s, stage: 'smallUsed', business: businessDefaults() };

    let total = 0;
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const car = generateCar(s, s.rng, getModel('civet'), s.t);
      const prospect = generateProspect(s, s.rng, car, 0, haggleSkillFor(s), s.t);
      const ev =
        prospect.downPayment +
        expectedCollections(
          prospect.financeTerms.weeks,
          prospect.financeTerms.weeklyPayment,
          BALANCE.creditTiers[prospect.tier].missChance,
          BALANCE.repoAfterMissedPayments,
        ).expectedCollected;
      total += ev / retailValue(car);
      n += 1;
    }

    expect(total / n).toBeCloseTo(financeGrossMultiple(stage), 1);
  });
});

/**
 * THE ONE THAT MATTERS.
 *
 * Everything above tests the model against itself. This runs the actual engine,
 * takes every listing it spawns, and prices them the way `marginScale` says a
 * reference deal is priced. A derivation that has drifted from the game — a
 * retuned ask band, a rarity capture that moved, a freight term that grew a
 * second call site — shows up here as a mean several points off, and nowhere
 * else at all.
 *
 * Mutation-tested: change `wholesaleOfRetail` in the derivation, or drop the
 * trim term, and this goes red while every other test in this file passes.
 */
describe('the model against the game', () => {
  function measureFeed(stageId: string, minutes: number): { mean: number; sd: number; n: number } {
    const margins: number[] = [];
    for (let seed = 0; seed < 6; seed++) {
      let s = createInitialState(9_000 + seed, 0);
      s = { ...s, stage: stageId as any, cash: 0, business: businessDefaults() };
      // Everything already on the feed was dealt by `createInitialState` at the
      // CURBSTONE — including the guaranteed-affordable opening listing, which
      // is dealt rather than rolled and is cheap by construction. Sampling those
      // as if this store had sourced them shifted the premium franchise's
      // measured mean by 0.8 points, which is half a standard deviation there.
      const seen = new Set<string>(s.listings.map((l) => l.id));
      // Advanced in slices so listings are sampled before they expire off the
      // feed. Nothing is ever bought — cash is zero and there is no automation —
      // so this is the population and not a selection out of it.
      for (let i = 0; i < minutes; i++) {
        s = advance(s, 60_000);
        for (const l of s.listings) {
          if (seen.has(l.id)) continue;
          seen.add(l.id);
          const retail = retailValue(l.car);
          if (retail > 0) margins.push((retail - landedCost(l)) / retail);
        }
      }
    }
    const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
    const variance = margins.reduce((a, b) => a + (b - mean) ** 2, 0) / margins.length;
    return { mean, sd: Math.sqrt(variance), n: margins.length };
  }

  for (const id of ['curbstone', 'largeUsed', 'premiumFranchise'] as const) {
    it(`predicts the feed at ${id} to within half a point`, () => {
      const measured = measureFeed(id, 40);
      const model = marginScale(getStage(id));

      expect(measured.n).toBeGreaterThan(150);
      expect(measured.mean).toBeCloseTo(model.mean, 2);
      expect(measured.sd).toBeCloseTo(model.sd, 2);
    });
  }
});
