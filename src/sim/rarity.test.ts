import { BALANCE } from './balance';
import { reconCost, reconValueGain, type ReconMods } from './cars';
import { bhphPrice, retailValue, wholesaleValue } from './economy';
import { advance, createInitialState, cloneState } from './engine';
import {
  RARITY_ORDER,
  baseTrim,
  rarityRank,
  rarityValueMult,
  rollRarity,
} from './rarity';
import { createRng, nextFloat } from './rng';
import { migrate } from './save';
import { getStage } from './stages';
import type { Car, GameState, Listing, Rarity, StageId } from './types';

/**
 * Trim grades.
 *
 * The whole feature is two facts that have to hold together: a rarer car is
 * worth more, and the seller does not charge for it. Either one alone is
 * nothing — scale both and rarity is worth exactly zero, scale neither and it is
 * paint. So the tests that matter here are the ones that pin the *gap*, and
 * they are deliberately written against the real engine in absolute dollars.
 */

const SHOP: ReconMods = { maxLift: BALANCE.reconMaxLift, costMult: 1, speedMult: 1 };

function makeCar(over: Partial<Car> = {}): Car {
  return {
    id: 'car_1',
    modelId: 'civet',
    colorIndex: 0,
    rarity: 'common',
    mileage: 96_000,
    condition: 0.66,
    costBasis: 0,
    acquiredAt: 0,
    status: 'ready',
    reconRemainingMs: 0,
    reconTotalMs: 0,
    reconTargetCondition: 0.66,
    askPrice: 0,
    listedAt: null,
    repoCount: 0,
    ...over,
  };
}

// --------------------------------------------------------------- the ladder

describe('the rarity table', () => {
  it('ranks every grade exactly once, worst to best', () => {
    expect(RARITY_ORDER).toEqual(['common', 'rare', 'epic', 'legendary']);
    expect(RARITY_ORDER.map(rarityRank)).toEqual([0, 1, 2, 3]);
  });

  it('is worth ten percent of the car more at each step', () => {
    expect(rarityValueMult('common')).toBeCloseTo(1.0, 10);
    expect(rarityValueMult('rare')).toBeCloseTo(1.1, 10);
    expect(rarityValueMult('epic')).toBeCloseTo(1.2, 10);
    expect(rarityValueMult('legendary')).toBeCloseTo(1.3, 10);
  });

  /**
   * Save data outlives a build. A car carrying a grade this version has never
   * heard of must render and price as stock rather than throwing or returning
   * NaN, which is what an unguarded `indexOf` would do.
   */
  it('reads an unknown grade as stock rather than blowing up', () => {
    expect(rarityRank('chrome' as Rarity)).toBe(0);
    expect(rarityValueMult('chrome' as Rarity)).toBe(1);
  });
});

describe('rollRarity', () => {
  /**
   * Direct on the roll rather than on generated cars: legendary is one in a
   * thousand, so a meaningful sample is 200,000 draws and building 200,000 full
   * cars to check a probability is pure waste.
   */
  it('lands on the shipped 90 / 9 / 0.9 / 0.1 split', () => {
    const rng = createRng(20260811);
    const n = 200_000;
    const seen: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (let i = 0; i < n; i++) seen[rollRarity(rng)] += 1;

    // ±15% relative on the two common grades, ±40% on legendary — at p=0.001
    // the sampling sd is ~7% of the mean, so this is a wide-open door that a
    // genuinely wrong threshold still cannot walk through.
    expect(seen.common / n).toBeGreaterThan(0.88);
    expect(seen.common / n).toBeLessThan(0.92);
    expect(seen.rare / n).toBeGreaterThan(0.09 * 0.85);
    expect(seen.rare / n).toBeLessThan(0.09 * 1.15);
    expect(seen.epic / n).toBeGreaterThan(0.009 * 0.8);
    expect(seen.epic / n).toBeLessThan(0.009 * 1.2);
    expect(seen.legendary / n).toBeGreaterThan(0.001 * 0.6);
    expect(seen.legendary / n).toBeLessThan(0.001 * 1.4);
  });

  it('consumes exactly one draw whatever it returns', () => {
    // A conditional second draw would make the stream depend on its own output,
    // and offline catch-up would stop reproducing. 500 rolls must leave the
    // generator exactly where 500 plain draws would — which can only be true if
    // every branch costs the same.
    const rolled = createRng(99);
    for (let i = 0; i < 500; i++) rollRarity(rolled);

    const drawn = createRng(99);
    for (let i = 0; i < 500; i++) nextFloat(drawn);

    expect(rolled.s).toBe(drawn.s);
  });
});

describe('baseTrim', () => {
  it('strips the grade and changes nothing else', () => {
    const car = makeCar({ rarity: 'legendary', mileage: 41_000, condition: 0.8 });
    const stock = baseTrim(car);
    expect(stock.rarity).toBe('common');
    expect({ ...stock, rarity: 'legendary' }).toEqual(car);
  });

  it('hands back the same object for a car that has nothing to strip', () => {
    // Nine listings in ten take this path; allocating a copy each time would be
    // a per-tick cost for no reason.
    const car = makeCar();
    expect(baseTrim(car)).toBe(car);
  });
});

// -------------------------------------------------------------- what it pays

describe('what a grade is worth', () => {
  it('scales every price the same way, in dollars', () => {
    const common = makeCar();
    const rare = makeCar({ rarity: 'rare' });

    // Absolute, not relative to a helper: a Nakato Civet at 96k miles and 66%
    // condition retails for $8,145 stock and $8,960 in Sport trim.
    expect(retailValue(common)).toBe(8_145);
    expect(retailValue(rare)).toBe(8_960);

    expect(retailValue(rare) / retailValue(common)).toBeCloseTo(1.1, 3);
    expect(wholesaleValue(rare) / wholesaleValue(common)).toBeCloseTo(1.1, 3);
    expect(bhphPrice(rare, 1.5) / bhphPrice(common, 1.5)).toBeCloseTo(1.1, 3);
  });

  /**
   * Recon has to stay grade-neutral as an investment. Cost and value gain both
   * index to `conditionFreeValue`, so both scale — a lift kit does not make
   * bodywork a better or worse idea, and if this ratio ever moves it means the
   * multiplier landed in only one of the two.
   */
  it('leaves reconditioning exactly as good a deal as it was', () => {
    const common = makeCar({ condition: 0.4 });
    const legendary = makeCar({ condition: 0.4, rarity: 'legendary' });

    expect(reconCost(legendary, SHOP) / reconCost(common, SHOP)).toBeCloseTo(1.3, 2);
    expect(reconValueGain(legendary, SHOP) / reconValueGain(common, SHOP)).toBeCloseTo(1.3, 2);

    const roi = (c: Car) => reconValueGain(c, SHOP) / reconCost(c, SHOP);
    expect(roi(legendary)).toBeCloseTo(roi(common), 2);
  });
});

// --------------------------------------------------------- the load-bearing one

/**
 * Collect every listing the real engine deals over a run, without buying any of
 * them.
 *
 * Cash at zero and no automation, so nothing is ever purchased and the sample is
 * the spawn distribution rather than whatever the retainer buyer left behind.
 * Scout is maxed only to make the feed deal faster — it does not touch price.
 */
function harvestListings(stage: StageId, seed: number, hours: number): Listing[] {
  let s: GameState = cloneState(createInitialState(seed, 0));
  s.stage = stage;
  s.cash = 0;
  s.upgrades = { scout: 3 };

  const seen = new Map<string, Listing>();
  const slices = (hours * 3_600_000) / 30_000;
  for (let i = 0; i < slices; i++) {
    s = advance(s, 30_000);
    for (const l of s.listings) if (!seen.has(l.id)) seen.set(l.id, l);
  }
  return [...seen.values()];
}

describe('the seller does not charge for the trim', () => {
  /**
   * THIS IS THE TEST THE FEATURE LIVES OR DIES ON, and it is deliberately not
   * written by asking the code what it thinks the answer is.
   *
   * CLAUDE.md carries two entries about tests that computed their expectation
   * from the thing under test and therefore agreed with a broken value by
   * construction. So: spawn from the real engine, and assert the ask against
   * the ONE number that is supposed to be independent of grade — the stock-trim
   * wholesale the stage's band is defined against. If `spawnListing` ever stops
   * calling `baseTrim`, a rare car's ask becomes 1.1x its band and roughly a
   * quarter of them land outside it. Mutation-tested by deleting that call.
   */
  it('prices every grade inside the same band, measured off the real feed', () => {
    const stage = getStage('smallUsed');
    const listings = harvestListings('smallUsed', 4242, 26);

    const byGrade = new Map<Rarity, Listing[]>();
    for (const l of listings) {
      const bucket = byGrade.get(l.car.rarity) ?? [];
      bucket.push(l);
      byGrade.set(l.car.rarity, bucket);
    }

    // A sample big enough for the claim to mean something at rare and above.
    expect(listings.length).toBeGreaterThan(3_000);
    expect((byGrade.get('rare') ?? []).length).toBeGreaterThan(150);
    expect((byGrade.get('epic') ?? []).length).toBeGreaterThan(10);

    const ratioOf = (l: Listing) => l.price / wholesaleValue(baseTrim(l.car));

    // Every single listing, of every grade, sits inside the stage's ask band.
    for (const l of listings) {
      expect(ratioOf(l)).toBeGreaterThanOrEqual(stage.sourcing.askMin - 0.01);
      expect(ratioOf(l)).toBeLessThanOrEqual(stage.sourcing.askMax + 0.01);
    }

    // And the mean ask is the same for a Sport car as for a stock one: the
    // seller is genuinely blind to the trim rather than merely under-charging.
    const mean = (ls: Listing[]) => ls.reduce((sum, l) => sum + ratioOf(l), 0) / ls.length;
    const common = mean(byGrade.get('common') ?? []);
    const rare = mean(byGrade.get('rare') ?? []);
    expect(rare).toBeCloseTo(common, 1);
  });

  /**
   * The other half, stated as money rather than as a ratio: the same car in
   * better trim costs the same and sells for more, so the margin is wider by
   * the whole of the premium.
   */
  it('hands the whole premium to whoever spots it', () => {
    const listings = harvestListings('smallUsed', 90210, 26);

    const marginOf = (l: Listing) => (retailValue(l.car) - l.price) / retailValue(l.car);
    const meanMargin = (r: Rarity) => {
      const ls = listings.filter((l) => l.car.rarity === r);
      return ls.reduce((sum, l) => sum + marginOf(l), 0) / ls.length;
    };

    const common = meanMargin('common');
    const rare = meanMargin('rare');

    // Margin on retail is 1 - wholesaleOfRetail x ask / grade, so a step up is
    // worth `wholesaleOfRetail x ask x (1 - 1/1.1)` — six to seven points at
    // this stage's mid band. Anything under four points means the ask is
    // tracking the trim.
    expect(rare - common).toBeGreaterThan(0.04);
    expect(rare - common).toBeLessThan(0.10);
  });
});

// ------------------------------------------------------------------ the save

describe('the v10 save', () => {
  it('is dealt stock trim rather than rerolled', () => {
    // Re-rolling would either inflate somebody's inventory overnight or hand
    // them a neon car they never bought. Common reproduces the pre-rarity game
    // to the dollar, which is the only honest answer.
    const state = createInitialState(11, 0);
    const withStock = advance(state, 30 * 60_000);

    const v10: any = JSON.parse(JSON.stringify(withStock));
    for (const car of v10.cars) delete car.rarity;
    for (const listing of v10.listings) delete listing.car.rarity;

    const migrated = migrate(v10, 10);

    expect(migrated.cars.length).toBe(withStock.cars.length);
    for (const car of migrated.cars) expect(car.rarity).toBe('common');
    for (const listing of migrated.listings) expect(listing.car.rarity).toBe('common');
    expect(() => advance(migrated, 5 * 60_000)).not.toThrow();
  });
});
