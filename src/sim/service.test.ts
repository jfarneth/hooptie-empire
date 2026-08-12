import { BALANCE, MS_PER_GAME_WEEK } from './balance';
import { generateCar } from './cars';
import { advance, cloneState, createInitialState } from './engine';
import { getModel } from './models';
import { createRng } from './rng';
import {
  SERVICE_PLAN_BANDS,
  activePlans,
  attachChance,
  claimCostMultiplier,
  conditionRisk,
  expectedLossRatio,
  expectedPlanPayout,
  hasServiceDept,
  maybeSellPlan,
  meanClaimCost,
  planBandIsOff,
  planBandMultiplier,
  planExposure,
  planPrice,
  pruneClosedPlans,
  sellsServicePlans,
  stepDuePlans,
  voidPlansForCar,
} from './service';
import { STAGES } from './stages';
import type { Car, GameState, Prospect, ServiceContract } from './types';

/**
 * The plan desk.
 *
 * The load-bearing test in here is `the realised loss ratio is the one the
 * balance file claims` — everything else is a property, but that one is the
 * product. It measures thousands of whole contracts through the same functions
 * the engine calls, because the number the game delivers and the number the
 * derivation predicts have already come apart once in this codebase (see the
 * `financeGrossMultiple` note in CLAUDE.md) and the only defence that worked was
 * measuring the thing rather than restating the arithmetic.
 */

function carOfCondition(condition: number, mileage = 90_000): Car {
  const state = { nextId: 1 };
  const rng = createRng(7);
  const car = generateCar(state, rng, getModel('comet'), 0);
  return { ...car, condition, mileage, rarity: 'common' };
}

/** A walk-up whose only job is to carry a name and a contract length. */
function prospectWithTerm(weeks: number): Prospect {
  return {
    id: 'pros_1',
    carId: 'car_1',
    name: 'Test Buyer',
    tier: 'C',
    negotiation: {} as Prospect['negotiation'],
    downPayment: 0,
    financeTerms: { amountFinanced: 0, apr: 0.2, weeklyPayment: 0, weeks },
    arrivedAt: 0,
    claimed: false,
    expiresAt: 0,
  };
}

/** Run one contract to the end of its term and report what it cost. */
function runToTerm(contract: ServiceContract, rng: { s: number }, costMult: number): number {
  let now = contract.openedAt;
  let guard = 0;
  while (contract.status === 'active' && guard++ < 500) {
    now += MS_PER_GAME_WEEK;
    stepDuePlans([contract], now, rng, costMult);
  }
  return contract.paidOut;
}

function contractFor(car: Car, weeks: number, band = 3): ServiceContract {
  return {
    id: 'plan_1',
    carId: car.id,
    carLabel: 'test',
    customerName: 'Test Buyer',
    price: planPrice(car, weeks, band),
    expectedPayout: Math.round(expectedPlanPayout(car, weeks)),
    paidOut: 0,
    claims: 0,
    weeksTotal: weeks,
    weeksRemaining: weeks,
    nextCheckAt: 0,
    status: 'active',
    openedAt: 0,
  };
}

describe('pricing cover', () => {
  it('charges more for a rougher car', () => {
    const clean = planPrice(carOfCondition(0.9), 24, 3);
    const middling = planPrice(carOfCondition(0.55), 24, 3);
    const rough = planPrice(carOfCondition(0.2), 24, 3);

    expect(rough).toBeGreaterThan(middling);
    expect(middling).toBeGreaterThan(clean);
    // The inversion is the point of the product, and it is worth being a real
    // spread rather than a rounding difference: cover on a beater is meaningfully
    // dearer than cover on a clean car, because it will be claimed on.
    expect(rough / clean).toBeGreaterThan(1.5);
  });

  it('charges more for a longer term', () => {
    const short = planPrice(carOfCondition(0.6), 18, 3);
    const long = planPrice(carOfCondition(0.6), 36, 3);
    // Twice the weeks is twice the exposure, so twice the price, because claim
    // odds are per week and nothing about them decays.
    expect(long / short).toBeCloseTo(2, 1);
  });

  it('scales with the band, and sells nothing at all when the desk is closed', () => {
    const car = carOfCondition(0.6);
    const standard = planPrice(car, 24, 3);
    for (let band = 1; band <= SERVICE_PLAN_BANDS.length; band++) {
      const expected = standard * (SERVICE_PLAN_BANDS[band - 1].multiplier / 1);
      expect(planPrice(car, 24, band)).toBeCloseTo(expected, -1);
    }
    expect(planBandIsOff(0)).toBe(true);
    expect(planBandMultiplier(0)).toBe(0);
    expect(planPrice(car, 24, 0)).toBe(0);
  });

  it('prices repairs off the car in front of it, not the model in the catalogue', () => {
    // Two identical models, one with 200,000 miles on it. A gearbox for the
    // tired one is not a gearbox for the fresh one, and cover that ignored that
    // would be unsellable at the bottom of the ladder — the same regression
    // recon cost has already paid for once.
    const fresh = carOfCondition(0.6, 20_000);
    const tired = carOfCondition(0.6, 220_000);
    expect(meanClaimCost(tired)).toBeLessThan(meanClaimCost(fresh));
  });

  it('reads condition risk the right way round', () => {
    expect(conditionRisk(1)).toBeCloseTo(BALANCE.service.riskAtClean, 5);
    expect(conditionRisk(0)).toBeCloseTo(BALANCE.service.riskAtRough, 5);
    expect(conditionRisk(0.5)).toBeGreaterThan(conditionRisk(0.9));
  });
});

describe('who takes a plan', () => {
  const bigLot: Pick<GameState, 'stage' | 'business'> = {
    stage: 'largeUsed',
    business: { servicePlanBand: 3 } as GameState['business'],
  };

  it('is offered from the big lot up and nowhere below it', () => {
    expect(sellsServicePlans({ stage: 'curbstone' })).toBe(false);
    expect(sellsServicePlans({ stage: 'smallUsed' })).toBe(false);
    expect(sellsServicePlans({ stage: 'largeUsed' })).toBe(true);
    expect(sellsServicePlans({ stage: 'premiumFranchise' })).toBe(true);
  });

  it('sells to fewer buyers as the price goes up', () => {
    const rates = [1, 2, 3, 4, 5].map((band) => attachChance(bigLot, band));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeLessThan(rates[i - 1]);
    }
    // The standard band is the one the shipped attach rate is quoted at.
    expect(attachChance(bigLot, 3)).toBeCloseTo(BALANCE.service.attachRate, 5);
  });

  it('gives the middle band the best expected dollars per car', () => {
    // The elasticity is chosen to put the optimum exactly here, so both ends of
    // the slider are a trade rather than one of them being a mistake. If a
    // retune moves `targetLossRatio` without moving `attachElasticity`, this is
    // the test that says so.
    const value = (band: number) =>
      attachChance(bigLot, band) *
      (SERVICE_PLAN_BANDS[band - 1].multiplier - BALANCE.service.targetLossRatio);
    const best = [1, 2, 3, 4, 5].reduce((a, b) => (value(b) > value(a) ? b : a));
    expect(best).toBe(3);
  });

  it('offers nothing where the store does not sell cover', () => {
    expect(attachChance({ ...bigLot, stage: 'smallUsed' }, 3)).toBe(0);
  });

  /**
   * THE A/B PROPERTY, and the reason every pacing baseline measured before this
   * landed still reproduces. `attachRate = 0` must skip the draw, not draw and
   * fail — a roll that always loses still moves the stream, and every number in
   * CLAUDE.md's ladder table would shift underneath it.
   */
  it('consumes no randomness at all when the feature is switched off', () => {
    const s = createInitialState(11, 0);
    s.stage = 'largeUsed';
    s.business = { ...s.business, servicePlanBand: 0 };
    const before = s.rng.s;
    const sold = maybeSellPlan(s, prospectWithTerm(24), carOfCondition(0.6), 'test', 0);
    expect(sold).toBeNull();
    expect(s.rng.s).toBe(before);

    // ...and the same when the store simply does not offer cover.
    s.stage = 'curbstone';
    const sold2 = maybeSellPlan(s, prospectWithTerm(24), carOfCondition(0.6), 'test', 3);
    expect(sold2).toBeNull();
    expect(s.rng.s).toBe(before);
  });
});

describe('what a plan costs the house', () => {
  /**
   * The measurement the whole feature rests on.
   *
   * Whole contracts, run to term, through the same `planPrice` and
   * `stepDuePlans` the engine uses. Priced against a real car so the derivation
   * is exercised end to end rather than against a convenient round number.
   */
  function measure(costMult: number, samples = 6_000) {
    const rng = createRng(4242);
    const terms = BALANCE.termWeeks;
    let ratioSum = 0;
    let zero = 0;
    let overPrice = 0;
    let worst = 0;

    for (let i = 0; i < samples; i++) {
      // Spread across the term table and across the condition range, so the
      // figure is the book's ratio and not one car's.
      const weeks = terms[i % terms.length];
      const condition = 0.15 + ((i * 37) % 80) / 100;
      const contract = contractFor(carOfCondition(condition), weeks);
      const paid = runToTerm(contract, rng, costMult);
      const ratio = paid / contract.price;

      ratioSum += ratio;
      if (paid === 0) zero += 1;
      if (ratio > 1) overPrice += 1;
      worst = Math.max(worst, ratio);
    }

    return {
      lossRatio: ratioSum / samples,
      zeroShare: zero / samples,
      overPriceShare: overPrice / samples,
      worst,
    };
  }

  it('loses the share of the premium the balance file says it loses', () => {
    const { lossRatio } = measure(1);
    // Measured 65.1%. The band is tight on purpose: this number IS the product,
    // and `capRecovery` exists to hold it here. Widen the band and the constant
    // stops being guarded by anything.
    expect(lossRatio).toBeGreaterThan(BALANCE.service.targetLossRatio - 0.02);
    expect(lossRatio).toBeLessThan(BALANCE.service.targetLossRatio + 0.02);
  });

  it('halves its losses once the house does its own repairs', () => {
    const { lossRatio } = measure(BALANCE.service.shopClaimMultiplier);
    // 50%, so margin goes 35% -> 50%: the fifteen points the service department
    // is sold on.
    expect(lossRatio).toBeGreaterThan(BALANCE.service.shopLossRatio - 0.02);
    expect(lossRatio).toBeLessThan(BALANCE.service.shopLossRatio + 0.02);
  });

  /**
   * The guard on the number every readout quotes.
   *
   * `shopClaimMultiplier` is the lever and `shopLossRatio` is what it delivers,
   * and the two are NOT related by multiplication: cheaper claims hit the 150%
   * cap less often, so cutting a repair bill by 37% improves the loss ratio by
   * 23%. The panel quoted the product for exactly one build and told the player
   * the house keeps 59% of a plan when it keeps 50%. This is what stops that
   * coming back.
   */
  it('states the shop discount as the ratio it delivers, not as the lever times the target', () => {
    const naive = BALANCE.service.targetLossRatio * BALANCE.service.shopClaimMultiplier;
    expect(BALANCE.service.shopLossRatio).toBeGreaterThan(naive + 0.05);

    const withShop = { stage: 'lowCostFranchise' as const, upgrades: { serviceBays: 2 } };
    const without = { stage: 'largeUsed' as const, upgrades: {} };
    expect(expectedLossRatio(withShop)).toBe(BALANCE.service.shopLossRatio);
    expect(expectedLossRatio(without)).toBe(BALANCE.service.targetLossRatio);
  });

  it('is lumpy, not an interest rate', () => {
    const { zeroShare, overPriceShare, worst } = measure(1);
    // A quarter of plans are never claimed on at all — the customer paid for
    // cover they did not use, which is most of where the margin comes from.
    expect(zeroShare).toBeGreaterThan(0.2);
    expect(zeroShare).toBeLessThan(0.35);
    // And a third cost more than they sold for. If this ever collapses toward
    // zero the product has quietly become a flat fee, which is the failure mode
    // worth having a test for.
    expect(overPriceShare).toBeGreaterThan(0.25);
    // Nothing, ever, gets past the cap.
    expect(worst).toBeLessThanOrEqual(BALANCE.service.payoutCap + 1e-9);
  });

  it('stops paying at the cap, mid-claim if it has to', () => {
    const car = carOfCondition(0.3);
    const contract = contractFor(car, 36);
    // Force it to the edge and then let a claim land on it.
    contract.paidOut = Math.round(contract.price * BALANCE.service.payoutCap) - 10;
    const rng = createRng(3);
    runToTerm(contract, rng, 1);
    expect(contract.paidOut).toBeLessThanOrEqual(contract.price * BALANCE.service.payoutCap);
  });

  it('runs its term and then stops costing anything', () => {
    const contract = contractFor(carOfCondition(0.4), 18);
    const rng = createRng(9);
    runToTerm(contract, rng, 1);
    expect(contract.status).toBe('expired');
    expect(contract.weeksRemaining).toBe(0);

    const paidAtTerm = contract.paidOut;
    // Another year of ticks must cost nothing — an expired plan is not a plan.
    let now = 100 * MS_PER_GAME_WEEK;
    for (let i = 0; i < 52; i++) {
      now += MS_PER_GAME_WEEK;
      stepDuePlans([contract], now, rng, 1);
    }
    expect(contract.paidOut).toBe(paidAtTerm);
  });
});

describe('the plan follows the car', () => {
  it('is torn up when the car is repossessed', () => {
    const contracts: ServiceContract[] = [contractFor(carOfCondition(0.5), 24)];
    contracts[0].carId = 'car_7';

    const voided = voidPlansForCar(contracts, 'car_7');
    expect(voided).toHaveLength(1);
    expect(contracts[0].status).toBe('void');

    // And it costs nothing from here on, which is the whole reason to do it: the
    // house is not paying to repair a car sitting on its own lot for somebody
    // who stopped paying for it.
    const rng = createRng(5);
    const before = contracts[0].paidOut;
    let now = MS_PER_GAME_WEEK;
    for (let i = 0; i < 40; i++) {
      now += MS_PER_GAME_WEEK;
      stepDuePlans(contracts, now, rng, 1);
    }
    expect(contracts[0].paidOut).toBe(before);
  });

  it('leaves the cover on other customers alone', () => {
    const mine = contractFor(carOfCondition(0.5), 24);
    mine.carId = 'car_1';
    const theirs = contractFor(carOfCondition(0.5), 24);
    theirs.carId = 'car_2';

    voidPlansForCar([mine, theirs], 'car_1');
    expect(mine.status).toBe('void');
    expect(theirs.status).toBe('active');
  });
});

describe('the book of plans', () => {
  it('reports what it could still cost at the worst', () => {
    const a = contractFor(carOfCondition(0.5), 24);
    const b = contractFor(carOfCondition(0.5), 24);
    b.paidOut = b.price;
    b.status = 'expired';

    // Only live plans are exposure, and only the room left under the cap.
    expect(planExposure([a, b])).toBe(Math.round(a.price * BALANCE.service.payoutCap));
    expect(activePlans([a, b])).toHaveLength(1);
  });

  it('keeps the history bounded', () => {
    const closed: ServiceContract[] = [];
    for (let i = 0; i < BALANCE.service.closedPlanHistory + 25; i++) {
      const c = contractFor(carOfCondition(0.5), 24);
      c.id = `plan_${i}`;
      c.status = 'expired';
      closed.push(c);
    }
    const live = contractFor(carOfCondition(0.5), 24);
    const pruned = pruneClosedPlans([...closed, live]);

    expect(pruned.filter((c) => c.status === 'active')).toHaveLength(1);
    expect(pruned.filter((c) => c.status !== 'active')).toHaveLength(
      BALANCE.service.closedPlanHistory,
    );
    // The OLDEST go, so the sheet's history is the recent past.
    expect(pruned[0].id).toBe(`plan_25`);
  });
});

describe('the shop discount', () => {
  it('applies only where there are bays, and only once they are bought', () => {
    const franchise = { stage: 'lowCostFranchise' as const, upgrades: {} };
    expect(hasServiceDept(franchise)).toBe(false);
    expect(claimCostMultiplier(franchise)).toBe(1);

    const withBays = { ...franchise, upgrades: { serviceBays: 1 } };
    expect(hasServiceDept(withBays)).toBe(true);
    expect(claimCostMultiplier(withBays)).toBe(BALANCE.service.shopClaimMultiplier);

    // A used lot cannot have bays however the save is edited — there is no
    // department to buy there, and the upgrade is gated to the franchises.
    expect(hasServiceDept({ stage: 'largeUsed', upgrades: { serviceBays: 3 } })).toBe(false);
  });
});

describe('plans on the state', () => {
  it('survives a clone without leaking backwards', () => {
    const s = createInitialState(3, 0);
    s.serviceContracts = [contractFor(carOfCondition(0.5), 24)];

    const copy = cloneState(s);
    copy.serviceContracts[0].paidOut = 99_999;
    copy.serviceContracts[0].status = 'void';

    expect(s.serviceContracts[0].paidOut).toBe(0);
    expect(s.serviceContracts[0].status).toBe('active');
  });

  it('a store that sells cover actually sells some', () => {
    // End to end through the real engine: a big lot with automation running
    // should have written plans and taken money for them.
    let s = createInitialState(21, 0);
    s.stage = 'largeUsed';
    s.cash = 400_000;
    s.upgrades = { autoBuy: 1, autoList: 1, autoRecon: 1, salesDesk: 1, collections: 3 };
    s.dealPolicy = 'auto';
    s.listings = [];

    s = advance(s, 60 * 60 * 1000);

    expect(s.stats.plansSold).toBeGreaterThan(0);
    expect(s.stats.planIncome).toBeGreaterThan(0);
    // Roughly one car in five, which is the shipped attach rate. Loose bounds:
    // this is a live run, not the distribution test above.
    const attach = s.stats.plansSold / Math.max(1, s.stats.carsSold);
    expect(attach).toBeGreaterThan(0.08);
    expect(attach).toBeLessThan(0.4);
  });

  it('is not offered at a store that does not sell cover', () => {
    let s = createInitialState(22, 0);
    s.cash = 40_000;
    s.upgrades = { autoBuy: 1, autoList: 1, salesDesk: 1 };
    s.dealPolicy = 'auto';

    s = advance(s, 60 * 60 * 1000);

    expect(s.stats.carsSold).toBeGreaterThan(0);
    expect(s.stats.plansSold).toBe(0);
    expect(s.serviceContracts).toHaveLength(0);
  });
});

describe('the stage table', () => {
  it('offers cover at every store from the big lot up', () => {
    const offering = STAGES.filter((s) => s.serviceContracts).map((s) => s.id);
    expect(offering).toEqual([
      'largeUsed',
      'lowCostFranchise',
      'midsizeFranchise',
      'premiumFranchise',
    ]);
  });
});
