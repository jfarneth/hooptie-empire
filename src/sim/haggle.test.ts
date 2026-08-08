import { BALANCE } from './balance';
import {
  acceptanceChance,
  countersRemaining,
  deskCounter,
  humanizePrice,
  openNegotiation,
  resolveCounter,
  roundingIncrement,
} from './haggle';
import { createRng } from './rng';
import type { Negotiation } from './types';

const CFG = BALANCE.negotiation;

function neg(over: Partial<Negotiation> = {}): Negotiation {
  return {
    anchor: 4_000,
    openingOffer: 3_500,
    currentOffer: 3_500,
    reservation: 3_750,
    room: 0.5,
    aggression: 0.5,
    countersMade: 0,
    lastCounter: null,
    status: 'open',
    tellIndex: 2,
    ...over,
  };
}

describe('human-looking numbers', () => {
  it('scales the increment with the price', () => {
    expect(roundingIncrement(3_999)).toBe(100);
    expect(roundingIncrement(18_000)).toBe(500);
    expect(roundingIncrement(45_000)).toBe(1_000);
  });

  it('lands offers on round money the overwhelming majority of the time', () => {
    const rng = createRng(4242);
    let round = 0;
    const runs = 4_000;
    for (let i = 0; i < runs; i++) {
      if (humanizePrice(rng, 3_487, 100) % 100 === 0) round += 1;
    }
    const share = round / runs;
    expect(share).toBeGreaterThan(0.8);
    // Not *always* round — the occasional odd number is what makes the round
    // ones read as a deliberate human choice rather than engine output.
    expect(share).toBeLessThan(0.95);
  });

  it('floors rather than rounding up, the way people actually lowball', () => {
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) {
      expect(humanizePrice(rng, 3_490, 100)).toBeLessThanOrEqual(3_490);
    }
  });
});

describe('opening offers', () => {
  it('never exceeds the ask and never goes absurdly low', () => {
    const rng = createRng(99);
    for (let i = 0; i < 3_000; i++) {
      const n = openNegotiation(rng, 3_999, 1);
      expect(n.openingOffer).toBeLessThanOrEqual(3_999);
      expect(n.openingOffer).toBeGreaterThan(3_999 * (1 - CFG.maxOpeningDiscount * 1.7));
    }
  });

  it('produces the shape asked for: list $3,999 sometimes draws $3,500', () => {
    const rng = createRng(7);
    const offers = new Set<number>();
    for (let i = 0; i < 2_000; i++) offers.add(openNegotiation(rng, 3_999, 1).openingOffer);
    expect(offers.has(3_500)).toBe(true);
    // Full-price buyers exist too.
    expect(offers.has(3_999)).toBe(true);
  });

  it('draws a harder lowball when the car is priced over market', () => {
    const fair = createRng(5);
    const gouging = createRng(5);
    let fairTotal = 0;
    let gougeTotal = 0;
    for (let i = 0; i < 2_000; i++) {
      fairTotal += openNegotiation(fair, 10_000, 1.0).openingOffer;
      gougeTotal += openNegotiation(gouging, 10_000, 1.4).openingOffer;
    }
    expect(gougeTotal).toBeLessThan(fairTotal);
  });

  it('puts the reservation between their offer and the ask', () => {
    const rng = createRng(31);
    for (let i = 0; i < 2_000; i++) {
      const n = openNegotiation(rng, 12_500, 1.05);
      expect(n.reservation).toBeGreaterThanOrEqual(n.openingOffer - 0.001);
      expect(n.reservation).toBeLessThanOrEqual(n.anchor + 0.001);
    }
  });
});

describe('acceptance odds', () => {
  it('always closes at or below what they already offered', () => {
    const n = neg();
    expect(acceptanceChance(n, n.currentOffer)).toBe(1);
    expect(acceptanceChance(n, n.currentOffer - 500)).toBe(1);
  });

  it('never rewards asking for more', () => {
    // Monotonicity is the property that makes the slider readable: sliding right
    // must never improve your odds.
    const n = neg();
    let previous = Infinity;
    for (let price = n.currentOffer; price <= n.anchor + 500; price += 10) {
      const p = acceptanceChance(n, price);
      expect(p).toBeLessThanOrEqual(previous + 1e-9);
      previous = p;
    }
  });

  it('is a coin-flip-ish at exactly their walk-away number, and continuous there', () => {
    const n = neg();
    expect(acceptanceChance(n, n.reservation)).toBeCloseTo(CFG.acceptanceAtReservation, 6);
    expect(acceptanceChance(n, n.reservation + 0.01)).toBeCloseTo(CFG.acceptanceAtReservation, 3);
  });

  it('collapses well past the reservation without ever going negative', () => {
    const n = neg();
    const p = acceptanceChance(n, n.anchor);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(0.3);
  });

  it('handles a buyer with no room at all', () => {
    const n = neg({ reservation: 3_500 });
    expect(acceptanceChance(n, 3_500)).toBe(1);
    expect(acceptanceChance(n, 3_600)).toBeLessThan(CFG.acceptanceAtReservation);
    expect(acceptanceChance(n, 3_600)).toBeGreaterThan(0);
  });
});

describe('resolving a counter', () => {
  it('accepts, re-counters, or walks — nothing else', () => {
    const rng = createRng(2024);
    const kinds = new Set<string>();
    for (let i = 0; i < 4_000; i++) {
      const n = openNegotiation(rng, 5_000, 1);
      if (n.currentOffer >= n.anchor) continue;
      const counter = Math.min(n.anchor, n.currentOffer + 200);
      kinds.add(resolveCounter(rng, n, counter).kind);
    }
    expect([...kinds].sort()).toEqual(['accepted', 'countered', 'walked']);
  });

  it('never lets a re-counter go backwards or past their walk-away number', () => {
    const rng = createRng(808);
    for (let i = 0; i < 4_000; i++) {
      const n = openNegotiation(rng, 8_000, 1);
      if (n.currentOffer >= n.anchor) continue;
      const before = n.currentOffer;
      const outcome = resolveCounter(rng, n, n.anchor);
      if (outcome.kind === 'countered') {
        expect(outcome.offer).toBeGreaterThanOrEqual(before);
        expect(outcome.offer).toBeLessThanOrEqual(Math.max(before, n.reservation) + 0.001);
      }
    }
  });

  it('terminates: the counter budget always runs out', () => {
    const rng = createRng(55);
    for (let seed = 0; seed < 500; seed++) {
      const n = openNegotiation(rng, 6_000, 1);
      let guard = 0;
      while (n.status === 'open' && countersRemaining(n) > 0) {
        resolveCounter(rng, n, Math.min(n.anchor, n.currentOffer + 100));
        if (++guard > CFG.maxPlayerCounters + 1) break;
      }
      expect(guard).toBeLessThanOrEqual(CFG.maxPlayerCounters);
      expect(countersRemaining(n) === 0 || n.status !== 'open').toBe(true);
    }
  });

  it('ends the conversation rather than re-countering on the final round', () => {
    const rng = createRng(9);
    const n = neg({ countersMade: CFG.maxPlayerCounters - 1, reservation: 3_500 });
    // Asking far above their walk-away on the last round: they cannot come back.
    const outcome = resolveCounter(rng, n, n.anchor);
    expect(outcome.kind === 'accepted' || outcome.kind === 'walked').toBe(true);
    expect(n.status).not.toBe('open');
  });

  it('records the agreed price on acceptance', () => {
    const rng = createRng(3);
    const n = neg({ reservation: 4_000 });
    // At their own number, acceptance is certain.
    const outcome = resolveCounter(rng, n, n.currentOffer);
    expect(outcome).toEqual({ kind: 'accepted', price: 3_500 });
    expect(n.currentOffer).toBe(3_500);
  });
});

describe('pushing harder loses more buyers', () => {
  it('walks away more often the more greedy the counter', () => {
    const measure = (fraction: number) => {
      const rng = createRng(1234);
      let walked = 0;
      const runs = 3_000;
      for (let i = 0; i < runs; i++) {
        const n = openNegotiation(rng, 10_000, 1);
        if (n.currentOffer >= n.anchor) continue;
        const counter = n.currentOffer + (n.anchor - n.currentOffer) * fraction;
        if (resolveCounter(rng, n, counter).kind === 'walked') walked += 1;
      }
      return walked / runs;
    };

    expect(measure(0.9)).toBeGreaterThan(measure(0.2));
  });
});

describe('sales desk counter', () => {
  it('lands between their offer and the ask, on the rounding grid', () => {
    const rng = createRng(64);
    for (let i = 0; i < 2_000; i++) {
      const n = openNegotiation(rng, 7_500, 1);
      const c = deskCounter(n);
      expect(c).toBeGreaterThanOrEqual(n.currentOffer);
      expect(c).toBeLessThanOrEqual(n.anchor);
      expect(c % roundingIncrement(n.anchor)).toBe(0);
    }
  });
});
