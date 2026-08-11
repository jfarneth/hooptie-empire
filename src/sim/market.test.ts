import { buyListing } from './actions';
import { BALANCE } from './balance';
import { advance, cloneState, createInitialState } from './engine';
import { MARKET_TIERS, drawOrigin, freightCost, landedCost, reachLevel, supplyMultiplier } from './market';
import { sourcingModsFor } from './skills';
import type { GameState } from './types';

/**
 * How far the business buys from.
 *
 * This exists because the feed is a fixed number of listings per minute and the
 * lot is not: measured before it was built, every store above the small lot
 * plateaued at about 23 cars whatever its capacity, and a midsize franchise ran
 * 43% full with nothing worth buying on the feed 100% of the time. Paving
 * another row bought nothing at all.
 *
 * Three things have to stay true or the feature is either a trap or a freebie.
 */

function stateAt(stage: GameState['stage'], reach: number): GameState {
  const s = cloneState(createInitialState(9090, 0));
  s.stage = stage;
  s.cash = 50_000_000;
  s.listings = [];
  if (reach > 0) s.upgrades.reach = reach;
  return s;
}

describe('market reach', () => {
  it('is local until it is bought, and never past national', () => {
    expect(reachLevel({ upgrades: {} })).toBe(0);
    expect(reachLevel({ upgrades: { reach: 1 } })).toBe(1);
    // The admin console can push an upgrade past its table; the tier list is the
    // real limit and reading off the end of it would be undefined.
    expect(reachLevel({ upgrades: { reach: 99 } })).toBe(MARKET_TIERS.length - 1);
  });

  /**
   * REACH ONLY EVER ADDS. Local listings keep arriving at exactly the rate they
   * always did and each tier stacks on top, so buying it can never make a store
   * worse off and there is no wrong moment to buy it. Modelled as a multiplier
   * on the whole feed instead, it would have put freight on cars you would have
   * found in your own town.
   */
  it('adds supply on top of local rather than replacing it', () => {
    expect(supplyMultiplier({ upgrades: {} })).toBe(1);
    expect(supplyMultiplier({ upgrades: { reach: 1 } })).toBeGreaterThan(1);
    expect(supplyMultiplier({ upgrades: { reach: 2 } })).toBeGreaterThan(
      supplyMultiplier({ upgrades: { reach: 1 } }),
    );

    // And it lands where it has to land: listings arrive faster and the feed
    // holds more of them. An accessor test alone would pass happily if
    // `sourcingModsFor` ignored the number.
    const local = sourcingModsFor(stateAt('largeUsed', 0));
    const national = sourcingModsFor(stateAt('largeUsed', 2));
    expect(national.intervalMs).toBeLessThan(local.intervalMs);
    expect(national.slots).toBeGreaterThan(local.slots);
  });

  /**
   * FREIGHT IS FLAT PER CAR, and the curve that produces is the point. The same
   * transporter is a third of the margin on a $10,000 big-lot car and a seventh
   * of it on an $86,000 Valmont, so reach gets better as you climb — which is
   * where the empty lot actually hurts. Charged proportionally instead it was
   * measured at most of a franchise's entire margin, and the business lost
   * $145M with a full lot the whole way down.
   */
  it('charges a flat haulage bill, so distance costs less of a dearer car', () => {
    expect(freightCost('local', 40_000)).toBe(0);

    const cheap = freightCost('national', 12_000);
    const dear = freightCost('national', 90_000);
    expect(cheap).toBe(dear);
    expect(cheap / 12_000).toBeGreaterThan(dear / 90_000);

    expect(freightCost('national', 40_000)).toBeGreaterThan(freightCost('regional', 40_000));
    // Never more than the car is worth: a $900 beater on a $1,000 transporter is
    // nobody's business decision, and uncapped it would put negative-value cars
    // on the feed.
    expect(freightCost('national', 500)).toBeLessThanOrEqual(250);
  });

  /**
   * The truck is part of the price. Everything downstream reads `costBasis` —
   * floorplan, profit, the forced-sale haircut, the buyer's own ceiling — so
   * this is the one place distance has to become real money.
   */
  it('puts the freight in the cost basis when you buy', () => {
    let s = stateAt('largeUsed', 2);
    s = advance(s, 5 * 60 * 1000);
    const shipped = s.listings.find((l) => l.origin !== 'local');
    expect(shipped).toBeDefined();
    expect(shipped!.freight).toBeGreaterThan(0);

    const cashBefore = s.cash;
    const after = buyListing(s, shipped!.id);
    const bought = after.cars[after.cars.length - 1];

    expect(cashBefore - after.cash).toBe(landedCost(shipped!));
    expect(bought.costBasis).toBe(landedCost(shipped!));
    // And the sticker alone would have understated it.
    expect(bought.costBasis).toBeGreaterThan(shipped!.price);
  });

  /**
   * Inert until bought, all the way down to the RNG stream. This is what lets
   * `--set=balance.market.supplyScale=0` be a true A/B against an identical
   * stream rather than a reshuffle, and what makes every pacing number measured
   * before this landed still comparable.
   */
  it('consumes no randomness and changes no listing while the business is local', () => {
    const withFeature = advance(stateAt('largeUsed', 0), 10 * 60 * 1000);
    expect(withFeature.listings.every((l) => l.origin === 'local')).toBe(true);
    expect(withFeature.listings.every((l) => l.freight === 0)).toBe(true);

    // drawOrigin must not touch the generator at level 0.
    const rng = { s: 12345 };
    expect(drawOrigin(rng, { upgrades: {} })).toBe('local');
    expect(rng.s).toBe(12345);
  });

  it('brings cars in from further away once it is open', () => {
    const s = advance(stateAt('largeUsed', 2), 20 * 60 * 1000);
    const origins = new Set(s.listings.map((l) => l.origin));
    expect(s.listings.length).toBeGreaterThan(0);
    // Over twenty minutes on a national feed, something has travelled.
    expect(origins.size).toBeGreaterThan(1);
  });

  /**
   * The problem in one assertion: a store's stalls should be fillable from its
   * feed. Local-only, a big lot's feed cannot keep up with its capacity; with
   * reach open it can.
   */
  it('supplies enough cars to fill a lot the local market cannot', () => {
    const held = (s: GameState) => s.cars.filter((c) => c.status !== 'sold').length;
    // A fully paved premium lot — sixty-two stalls — and money to fill it, over a
    // window short enough that the FEED is what decides. Given unlimited time
    // even a local feed eventually fills any lot; the complaint was never that,
    // it was that the lot sits half empty for the whole run.
    const run = (reach: number) => {
      const s = stateAt('premiumFranchise', reach);
      s.upgrades.autoList = 1;
      s.upgrades.autoBuy = 1;
      s.upgrades.lot = 5;
      return held(advance(s, 15 * 60 * 1000));
    };

    const local = run(0);
    const national = run(2);
    expect(national).toBeGreaterThan(local * 1.4);
    expect(BALANCE.market.supplyScale).toBe(1);
  });
});
