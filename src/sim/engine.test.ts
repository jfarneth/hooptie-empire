import { moveToStage, purchaseUpgrade, setDealPolicy } from './actions';
import { TICK_MS } from './balance';
import { advance, createInitialState } from './engine';
import { canBuyUpgrade, carCapacity } from './upgrades';
import { SKILL_IDS } from './skills';
import type { GameState } from './types';

/**
 * The keystone property of the whole project.
 *
 * Offline progress is not a separate estimate — it is the same fixed-step loop
 * run more times. These tests are what let the game promise that eight hours
 * away produced exactly what eight hours of watching would have.
 */

function run(state: GameState, sliceMs: number, slices: number): GameState {
  let s = state;
  for (let i = 0; i < slices; i++) s = advance(s, sliceMs);
  return s;
}

/** Compare everything that matters, ignoring nothing that does. */
function fingerprint(s: GameState) {
  return {
    t: s.t,
    rng: s.rng.s,
    cash: Math.round(s.cash * 100),
    nextId: s.nextId,
    // Rarity is drawn inside generateCar, so it is part of what the tick
    // consumes from the stream — a draw that moved or went conditional shows up
    // here rather than as a mystery divergence months later.
    cars: s.cars.map(
      (c) => `${c.id}:${c.status}:${c.condition.toFixed(4)}:${c.costBasis}:${c.rarity}`,
    ),
    notes: s.notes.map((n) => `${n.id}:${n.status}:${n.principal.toFixed(4)}:${n.paymentsRemaining}`),
    // The tick amortizes the shark's loan, so the schedule is part of the
    // fingerprint — a slice-size bug here would double- or skip-charge it.
    loan: s.loan ? `${s.loan.paymentAmount}:${s.loan.paymentsRemaining}` : 'none',
    listings: s.listings.map((l) => `${l.id}:${l.price}`),
    // Negotiation fields are included deliberately: a prospect's haggle is
    // nested mutable state, so this is what catches a missed clone in
    // cloneState leaking mutations backwards through history.
    prospects: s.prospects.map(
      (p) =>
        `${p.id}:${p.negotiation.currentOffer}:${p.negotiation.status}:` +
        `${p.negotiation.countersMade}:${p.negotiation.reservation.toFixed(2)}:` +
        // The desk's grace window counts from arrivedAt and skips claimed
        // prospects, so both are inputs to what the tick does next.
        `${p.arrivedAt}:${p.claimed}`,
    ),
    // Skills are a record of nested objects, so like prospects they are what
    // would catch a missed clone in cloneState.
    skills: SKILL_IDS.map((id) => `${id}:${s.skills[id].level}:${s.skills[id].xp}`),
    // The house rules are nested and mutable too. Nothing inside a tick writes
    // them, so this is a tripwire rather than an active guard here — the guard
    // that bites is the clone-isolation test in business.test.ts.
    business: s.business,
    // Promotions ARE written by the tick — it expires them — so a missed clone
    // or an off-by-one in the expiry sweep shows up right here.
    promotions: s.promotions.map((p) => `${p.id}:${p.startedAt}:${p.endsAt}`),
    stats: s.stats,
  };
}

describe('advance() tick-size invariance', () => {
  it('produces identical state whether stepped in 1s or 1h slices', () => {
    const seed = 12345;
    const hour = 60 * 60 * 1000;

    const bySecond = run(createInitialState(seed, 0), 1_000, 3_600);
    const byHour = advance(createInitialState(seed, 0), hour);

    expect(fingerprint(bySecond)).toEqual(fingerprint(byHour));
  });

  it('is invariant across ragged slice sizes that do not divide the tick', () => {
    const seed = 987;
    const total = 30 * 60 * 1000;

    const even = advance(createInitialState(seed, 0), total);

    // 250ms slices exercise the sub-tick accumulator: three out of four calls
    // must do no work at all and carry the remainder forward.
    const ragged = run(createInitialState(seed, 0), 250, total / 250);

    expect(fingerprint(ragged)).toEqual(fingerprint(even));
  });

  it('carries sub-tick time instead of dropping it', () => {
    const s0 = createInitialState(1, 0);
    const s1 = advance(s0, TICK_MS - 1);
    expect(s1.t).toBe(0);
    expect(s1.accumulatorMs).toBe(TICK_MS - 1);

    const s2 = advance(s1, 1);
    expect(s2.t).toBe(TICK_MS);
    expect(s2.accumulatorMs).toBe(0);
  });
});

describe('advance() purity', () => {
  it('does not mutate the state it was given', () => {
    const s0 = createInitialState(42, 0);
    const before = JSON.stringify(s0);
    advance(s0, 10 * 60 * 1000);
    expect(JSON.stringify(s0)).toBe(before);
  });

  it('returns a state whose arrays are not shared with the input', () => {
    const s0 = createInitialState(42, 0);
    const s1 = advance(s0, 60_000);
    expect(s1.cars).not.toBe(s0.cars);
    expect(s1.listings).not.toBe(s0.listings);
    expect(s1.rng).not.toBe(s0.rng);
  });
});

describe('determinism', () => {
  it('replays identically from the same seed', () => {
    const a = advance(createInitialState(777, 0), 20 * 60 * 1000);
    const b = advance(createInitialState(777, 0), 20 * 60 * 1000);
    expect(fingerprint(a)).toEqual(fingerprint(b));
  });

  it('diverges on a different seed', () => {
    const a = advance(createInitialState(1, 0), 20 * 60 * 1000);
    const b = advance(createInitialState(2, 0), 20 * 60 * 1000);
    expect(fingerprint(a)).not.toEqual(fingerprint(b));
  });
});

describe('sourcing feed', () => {
  it('fills up to the listing cap and stops', () => {
    const s = advance(createInitialState(5, 0), 10 * 60 * 1000);
    expect(s.listings.length).toBeGreaterThan(0);
    expect(s.listings.length).toBeLessThanOrEqual(4);
  });

  it('prices listings around wholesale, not retail', () => {
    const s = advance(createInitialState(6, 0), 5 * 60 * 1000);
    for (const listing of s.listings) {
      expect(listing.price).toBeGreaterThan(0);
      expect(listing.price).toBeLessThan(listing.car.costBasis + 60_000);
    }
  });
});

describe('offline catch-up performance', () => {
  it('simulates 8 hours well inside a frame budget a player would notice', () => {
    const start = Date.now();
    advance(createInitialState(31337, 0), 8 * 60 * 60 * 1000);
    const elapsed = Date.now() - start;
    // Generous ceiling: the point is to catch an accidental O(n^2), not to
    // benchmark the machine this happens to run on.
    expect(elapsed).toBeLessThan(4_000);
  });
});

/**
 * The lot is a hard limit.
 *
 * Every buying path is gated on capacity, but a repossession adds to inventory
 * without anybody choosing to — it was the one way to end up holding more cars
 * than the lot has stalls, which reads to a player as a bug because it is one:
 * the HUD says 18/18 and there are twenty cars on the tarmac.
 *
 * This is a property test on purpose. The bug was not in any single line, it was
 * in the absence of a check on one path, and the only reliable way to catch a
 * missing gate is to assert the invariant continuously over a run that actually
 * exercises it.
 */
describe('lot capacity is strict', () => {
  function busyLot(): GameState {
    let s = createInitialState(90210, 0);
    s = { ...s, cash: 400_000_000 };
    s = moveToStage(s, 'smallUsed');
    for (const id of ['autoBuy', 'autoList', 'autoRecon', 'salesDesk', 'collections']) {
      if (canBuyUpgrade(s, id)) s = purchaseUpgrade(s, id);
    }
    // Scout to the top, and that is load-bearing rather than flavour. The
    // retainer buyer is choosy — most of the feed is over its ceiling — so on a
    // four-slot feed the lot sits at capacity about 1% of the time, and whether
    // a repo happens to land in one of those slices comes down to the seed. It
    // did land, once, which is how this test passed for as long as it did; any
    // change that shifted the RNG stream by one draw took it red for a reason
    // that had nothing to do with the lot. A maxed feed keeps the lot pinned at
    // capacity 10-25% of the time instead, and every seed tried produces the
    // collision several times over.
    while (canBuyUpgrade(s, 'scout')) s = purchaseUpgrade(s, 'scout');
    // The desk has to be writing paper, or nothing is ever repossessed and the
    // whole point of this fixture goes untested.
    s = setDealPolicy(s, 'finance');
    return { ...s, cash: 250_000 };
  }

  it('never holds more cars than there are stalls, however many come back', () => {
    let s = busyLot();
    const held = (g: GameState) => g.cars.filter((c) => c.status !== 'sold').length;

    let sawFullLot = false;
    let reposOntoFullLot = 0;
    let auctioned = 0;

    for (let i = 0; i < 4_000; i++) {
      const wasFull = held(s) >= carCapacity(s);
      const before = { repos: s.stats.reposCompleted, cars: held(s) };

      s = advance(s, 5_000);

      expect(held(s)).toBeLessThanOrEqual(carCapacity(s));
      if (held(s) === carCapacity(s)) sawFullLot = true;

      if (s.stats.reposCompleted > before.repos && wasFull) {
        reposOntoFullLot += 1;
        // The car was taken but could not park, so the lot did not grow.
        expect(held(s)).toBeLessThanOrEqual(before.cars);
        if (s.events.some((e) => e.label.includes('straight to auction'))) auctioned += 1;
      }
    }

    // Without these the assertion above could pass on a run that never filled
    // the lot and never repossessed anything, which is the kind of test that
    // guards nothing.
    expect(sawFullLot).toBe(true);
    expect(s.stats.reposCompleted).toBeGreaterThan(0);
    expect(reposOntoFullLot).toBeGreaterThan(0);
    expect(auctioned).toBeGreaterThan(0);
  });
});
