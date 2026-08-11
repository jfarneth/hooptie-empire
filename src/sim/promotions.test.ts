import { BALANCE } from './balance';
import { retailValue } from './economy';
import { advance, cloneState, createInitialState } from './engine';
import {
  expirePromotions,
  livePromotions,
  promotionDuration,
  promotionRemaining,
  promotionTrafficMultiplier,
  startPromotion,
} from './promotions';
import type { GameState } from './types';

/**
 * Promotions are a timed multiplier that lives on the save, which puts them in
 * the same category as a note's due date: the thing they must never do is stop
 * counting while the app is closed, or start counting twice.
 */

describe('a promotion is a clock on the save', () => {
  it('starts a new business on a grand opening', () => {
    const s = createInitialState(1, 0);
    const live = livePromotions(s);
    expect(live.length).toBe(1);
    expect(live[0].id).toBe('grandOpening');
    expect(promotionRemaining(s, live[0])).toBe(promotionDuration('grandOpening'));
    expect(promotionTrafficMultiplier(s)).toBe(BALANCE.promotions.grandOpening.trafficMultiplier);
  });

  it('runs out on the tick it is due and never comes back', () => {
    const s0 = createInitialState(2, 0);
    const length = promotionDuration('grandOpening');

    const during = advance(s0, length - 2_000);
    expect(livePromotions(during).length).toBe(1);
    expect(promotionTrafficMultiplier(during)).toBeGreaterThan(1);

    const after = advance(during, 3_000);
    expect(livePromotions(after).length).toBe(0);
    expect(after.promotions.length).toBe(0);
    expect(promotionTrafficMultiplier(after)).toBe(1);

    // And it stays gone rather than being re-granted by anything downstream.
    expect(livePromotions(advance(after, 30 * 60 * 1000)).length).toBe(0);
  });

  /**
   * The reason `endsAt` is stamped rather than derived. Offline catch-up runs
   * the same fixed slices as live play, so a promotion has to burn exactly as
   * much clock in one 8h call as it does in 28,800 one-second ones.
   */
  it('burns the same clock offline as it does on screen', () => {
    const seed = 909;
    const short = promotionDuration('grandOpening') / 4;

    let stepped = createInitialState(seed, 0);
    for (let i = 0; i < short / 1000; i++) stepped = advance(stepped, 1_000);
    const jumped = advance(createInitialState(seed, 0), short);

    expect(promotionRemaining(stepped, livePromotions(stepped)[0])).toBe(
      promotionRemaining(jumped, livePromotions(jumped)[0]),
    );
  });

  it('says so in the ledger, both when it opens and when it ends', () => {
    const s0 = createInitialState(3, 0);
    expect(s0.events.filter((e) => e.kind === 'promotion').length).toBe(1);

    const after = advance(s0, promotionDuration('grandOpening') + 1_000);
    const promo = after.events.filter((e) => e.kind === 'promotion');
    expect(promo.length).toBeGreaterThanOrEqual(1);
    expect(promo[promo.length - 1].label).toMatch(/over/i);
  });

  it('is deep-cloned, so history cannot be mutated backwards', () => {
    const s = createInitialState(4, 0);
    const copy = cloneState(s);
    copy.promotions[0].endsAt += 999_999;
    copy.promotions.push({ id: 'grandOpening', startedAt: 0, endsAt: 1 });

    expect(s.promotions.length).toBe(1);
    expect(s.promotions[0].endsAt).toBe(promotionDuration('grandOpening'));
  });
});

describe('starting one', () => {
  it('extends the one already running rather than stacking a second', () => {
    const s = createInitialState(5, 0);
    const before = promotionTrafficMultiplier(s);

    const advanced = advance(s, 5 * 60 * 1000);
    startPromotion(advanced, 'grandOpening');

    expect(advanced.promotions.length).toBe(1);
    // Same boost, later finish — not twice the boost.
    expect(promotionTrafficMultiplier(advanced)).toBe(before);
    expect(advanced.promotions[0].endsAt).toBe(advanced.t + promotionDuration('grandOpening'));
  });

  it('never shortens one that has longer left to run', () => {
    const s = createInitialState(6, 0);
    const endsAt = s.promotions[0].endsAt;
    const advanced = advance(s, 60_000);
    // Pretend the console just cut the duration to nearly nothing.
    advanced.promotions[0].endsAt = endsAt;
    startPromotion(advanced, 'grandOpening');
    expect(advanced.promotions[0].endsAt).toBeGreaterThanOrEqual(endsAt);
  });

  it('reports what expired so the caller can log it', () => {
    const s = createInitialState(7, 0);
    expect(expirePromotions(s).length).toBe(0);
    s.t = s.promotions[0].endsAt;
    expect(expirePromotions(s).map((d) => d.id)).toEqual(['grandOpening']);
    expect(s.promotions.length).toBe(0);
  });
});

describe('what it actually does to the lot', () => {
  /**
   * A lot with cars already on it, priced at `askRatio` × retail, and nothing
   * automated.
   *
   * Built by hand rather than played into existence. The retainer buyer is
   * choosy enough that an automated curbstone can go ten minutes without buying
   * anything, which would make a traffic measurement a measurement of the ask
   * band instead. Here the stock is fixed, nobody buys or sells, and the only
   * thing that varies between the two runs is whether the promotion is on.
   */
  function stockedLot(seed: number, cars: number, askRatio: number, promotion: boolean): GameState {
    const s = cloneState(createInitialState(seed, 0));
    if (!promotion) s.promotions = [];
    s.upgrades = {};
    s.cars = [];
    // Rent is not what this measures, and a business at zero cash behaves no
    // differently for traffic — but the ledger noise is worth doing without.
    s.nextBillAt = Number.MAX_SAFE_INTEGER;

    for (let i = 0; i < cars; i++) {
      const car = { ...createInitialState(seed + i * 31 + 1, 0).listings[0].car };
      car.id = `car_${i}`;
      car.status = 'listed';
      car.askPrice = Math.round(retailValue(car) * askRatio);
      s.cars.push(car);
    }
    return s;
  }

  /**
   * Every distinct buyer who turned up over `ms`, counted by id.
   *
   * Sampled in 5s slices, which cannot miss one: a walk-up lives at least 0.7 ×
   * `prospectLifetimeMs`. Counting the standing population instead would
   * measure buyer patience as much as arrival rate.
   */
  function arrivals(start: GameState, ms: number): number {
    let s = start;
    const seen = new Set<string>();
    for (let elapsed = 0; elapsed < ms; elapsed += 5_000) {
      s = advance(s, 5_000);
      for (const p of s.prospects) seen.add(p.id);
    }
    return seen.size;
  }

  /**
   * The property that matters, and the one an accessor test cannot reach: the
   * multiplier has to arrive in `stepProspects`. Asserting on
   * `promotionTrafficMultiplier` alone would pass just as happily if the engine
   * ignored the number entirely.
   *
   * Summed over several seeds because one run's walk-ups are a Poisson draw.
   * The gap is a whole multiple, so the totals cannot cross.
   */
  it('brings more buyers through the door than the same lot without it', () => {
    const window = 10 * 60 * 1000; // well inside the promotion, so the whole slice is boosted
    let boosted = 0;
    let plain = 0;
    for (let seed = 0; seed < 6; seed++) {
      boosted += arrivals(stockedLot(400 + seed, 5, 1, true), window);
      plain += arrivals(stockedLot(400 + seed, 5, 1, false), window);
    }

    expect(plain).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThan(plain);
    // A doubled rate, throttled a little by one shopper at a time per car.
    expect(boosted / plain).toBeGreaterThan(1.3);
  });

  /**
   * A promotion multiplies a rate; it does not overrule the pricing model.
   * Above `maxViablePriceRatio` traffic is zero, and twice zero is zero — which
   * is what stops "run a promotion" being a way to sell a car at any price.
   */
  it('cannot sell a car priced out of the market', () => {
    const s = stockedLot(88, 5, 100, true);
    expect(s.cars.every((c) => c.status === 'listed')).toBe(true);

    expect(arrivals(s, 15 * 60 * 1000)).toBe(0);
    // Still running the whole time — it is the price that stopped it, not the
    // clock running out.
    expect(livePromotions(advance(s, 10 * 60 * 1000)).length).toBe(1);
  });
});
