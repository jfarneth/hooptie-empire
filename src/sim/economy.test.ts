import { reconCost, reconLift, reconValueGain, type ReconMods } from './cars';
import { BALANCE } from './balance';

/** A level-1 shop with no mechanic: the baseline these curves were tuned at. */
const SHOP: ReconMods = { maxLift: BALANCE.reconMaxLift, costMult: 1, speedMult: 1 };
import {
  conditionFactor,
  conditionFreeValue,
  mileageFactor,
  retailValue,
  weeklyPayment,
  wholesaleValue,
} from './economy';
import { CAR_MODELS } from './models';
import { createInitialState } from './engine';
import type { Car } from './types';

function makeCar(over: Partial<Car> = {}): Car {
  return {
    id: 'car_1',
    modelId: 'comet',
    colorIndex: 0,
    mileage: 150_000,
    condition: 0.5,
    costBasis: 2_000,
    acquiredAt: 0,
    status: 'ready',
    reconRemainingMs: 0,
    reconTotalMs: 0,
    reconTargetCondition: 0.5,
    askPrice: 0,
    listedAt: null,
    repoCount: 0,
    ...over,
  };
}

describe('valuation curves', () => {
  it('depreciates with miles but never to nothing', () => {
    expect(mileageFactor(0)).toBeCloseTo(1, 5);
    expect(mileageFactor(100_000)).toBeLessThan(mileageFactor(50_000));
    expect(mileageFactor(500_000)).toBeGreaterThan(0);
  });

  it('keeps a high-mileage beater tradeable rather than worthless', () => {
    // The linear-to-zero curve this replaced valued a 200k-mile car at ~10% of
    // base, which made the entire opening stage unplayable.
    expect(mileageFactor(200_000)).toBeGreaterThan(0.3);
  });

  it('values condition between the floor and full', () => {
    expect(conditionFactor(0)).toBeCloseTo(0.45, 5);
    expect(conditionFactor(1)).toBeCloseTo(1, 5);
    expect(conditionFactor(0.5)).toBeGreaterThan(conditionFactor(0.2));
  });

  it('prices wholesale below retail, always', () => {
    for (const model of CAR_MODELS) {
      const car = makeCar({ modelId: model.id });
      expect(wholesaleValue(car)).toBeLessThan(retailValue(car));
    }
  });

  it('discounts a repossessed car', () => {
    const clean = makeCar({ repoCount: 0 });
    const twice = makeCar({ repoCount: 2 });
    expect(retailValue(twice)).toBeLessThan(retailValue(clean));
  });

  it('factors condition cleanly out of value', () => {
    const car = makeCar({ condition: 0.6 });
    expect(retailValue(car)).toBeCloseTo(conditionFreeValue(car) * conditionFactor(0.6), 0);
  });
});

describe('reconditioning is a real choice, not a trap', () => {
  /**
   * Regression guard. Recon cost used to be indexed to the model's showroom
   * value while the value it added scaled with the car's actual worth, so on
   * every high-mileage car in stage 1 it cost far more than it returned and no
   * rational player would ever use the mechanic.
   */
  it('returns more value than it costs across the whole catalogue', () => {
    for (const model of CAR_MODELS) {
      for (const mileage of [30_000, 90_000, 150_000, 210_000, 260_000]) {
        for (const condition of [0.2, 0.4, 0.6]) {
          const car = makeCar({ modelId: model.id, mileage, condition });
          if (reconLift(car, SHOP) <= 0.02) continue;
          const cost = reconCost(car, SHOP);
          const gain = reconValueGain(car, SHOP);
          expect(gain).toBeGreaterThan(cost);
        }
      }
    }
  });

  it('scales cost with the car actually in front of you, not the model name', () => {
    const fresh = makeCar({ mileage: 20_000, condition: 0.4 });
    const tired = makeCar({ mileage: 240_000, condition: 0.4 });
    expect(reconCost(tired, SHOP)).toBeLessThan(reconCost(fresh, SHOP));
  });
});

describe('installment math', () => {
  it('produces a payment that amortizes the balance', () => {
    const payment = weeklyPayment(5_000, 0.229, 24);
    expect(payment).toBeGreaterThan(5_000 / 24);
    expect(payment * 24).toBeGreaterThan(5_000);
  });
});

describe('cold open', () => {
  it('puts cars on the feed before the player has waited for anything', () => {
    const s = createInitialState(99, 0);
    expect(s.listings.length).toBeGreaterThanOrEqual(3);
  });

  it('always deals an affordable opening car, on every seed', () => {
    // An opening screen with nothing buyable on it is a dead start. This used to
    // happen on roughly one seed in eight before the first listing was dealt
    // rather than rolled.
    for (let seed = 1; seed <= 300; seed++) {
      const s = createInitialState(seed, 0);
      expect(s.listings.some((l) => l.price <= s.cash)).toBe(true);
    }
  });

  it('makes the opening car worth flipping', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const s = createInitialState(seed, 0);
      const starter = s.listings.find((l) => l.price <= s.cash)!;
      expect(retailValue(starter.car)).toBeGreaterThan(starter.price);
    }
  });
});
