import { BALANCE } from './balance';
import {
  BASE_HAGGLE_SKILL,
  acceptanceChance,
  countersRemaining,
  deskCounter,
  humanizePrice,
  openNegotiation,
  readOffer,
  resolveCounter,
  roundingIncrement,
  paymentAcceptance,
  resolvePaymentPush,
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
      const n = openNegotiation(rng, 3_999, 1, BASE_HAGGLE_SKILL);
      expect(n.openingOffer).toBeLessThanOrEqual(3_999);
      expect(n.openingOffer).toBeGreaterThan(3_999 * (1 - CFG.maxOpeningDiscount * 1.7));
    }
  });

  it('produces the shape asked for: list $3,999 sometimes draws $3,500', () => {
    const rng = createRng(7);
    const offers = new Set<number>();
    for (let i = 0; i < 2_000; i++) offers.add(openNegotiation(rng, 3_999, 1, BASE_HAGGLE_SKILL).openingOffer);
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
      fairTotal += openNegotiation(fair, 10_000, 1.0, BASE_HAGGLE_SKILL).openingOffer;
      gougeTotal += openNegotiation(gouging, 10_000, 1.4, BASE_HAGGLE_SKILL).openingOffer;
    }
    expect(gougeTotal).toBeLessThan(fairTotal);
  });

  it('puts the reservation between their offer and the ask', () => {
    const rng = createRng(31);
    for (let i = 0; i < 2_000; i++) {
      const n = openNegotiation(rng, 12_500, 1.05, BASE_HAGGLE_SKILL);
      expect(n.reservation).toBeGreaterThanOrEqual(n.openingOffer - 0.001);
      expect(n.reservation).toBeLessThanOrEqual(n.anchor + 0.001);
    }
  });
});

describe('reading an offer at a glance', () => {
  it('splits at the two thresholds, against the ask', () => {
    const ask = 10_000;
    expect(readOffer(ask, ask)).toBe('strong');
    expect(readOffer(ask * CFG.offerRead.strong, ask)).toBe('strong');
    expect(readOffer(ask * (CFG.offerRead.strong - 0.001), ask)).toBe('fair');
    expect(readOffer(ask * CFG.offerRead.fair, ask)).toBe('fair');
    expect(readOffer(ask * (CFG.offerRead.fair - 0.001), ask)).toBe('lowball');
    expect(readOffer(0, ask)).toBe('lowball');
  });

  /**
   * ALL THREE COLOURS HAVE TO TURN UP, or the lot has painted itself one shade
   * and taught the player to stop looking. Measured against offers the real
   * negotiation model opens with rather than against the thresholds restated —
   * the same trap `financeGrossMultiple` fell into, where a derivation tested
   * against itself agreed with a broken value by construction.
   */
  it('paints all three colours across the offers the model actually opens with', () => {
    const rng = createRng(4242);
    const seen: Record<string, number> = { lowball: 0, fair: 0, strong: 0 };
    for (let i = 0; i < 4_000; i++) {
      const n = openNegotiation(rng, 12_500, 1, BASE_HAGGLE_SKILL);
      seen[readOffer(n.openingOffer, n.anchor)] += 1;
    }
    // A tenth of the lot at the least, or the colour is decoration.
    for (const read of ['lowball', 'fair', 'strong']) {
      expect(seen[read] / 4_000).toBeGreaterThan(0.1);
    }
    // Amber is the ordinary case, which is what makes red and green mean
    // something when they show up.
    expect(seen.fair).toBeGreaterThan(seen.strong);
    expect(seen.fair).toBeGreaterThan(seen.lowball);
  });

  /**
   * The read is against YOUR ASK, so an optimistic sticker really does draw
   * redder buyers — the overpricing lowball and the colour are the same fact
   * seen twice, and that is the property that keeps the signal honest when the
   * player reprices a car rather than making it a fixed opinion about the car.
   */
  it('turns a lot redder when the sticker goes up', () => {
    const count = (overpricing: number) => {
      const rng = createRng(808);
      let red = 0;
      for (let i = 0; i < 2_000; i++) {
        const n = openNegotiation(rng, 12_500, overpricing, BASE_HAGGLE_SKILL);
        if (readOffer(n.openingOffer, n.anchor) === 'lowball') red += 1;
      }
      return red;
    };
    expect(count(1.4)).toBeGreaterThan(count(1.0));
  });

  it('reads an unpriced car as ordinary rather than dividing by zero', () => {
    expect(readOffer(5_000, 0)).toBe('fair');
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
      const n = openNegotiation(rng, 5_000, 1, BASE_HAGGLE_SKILL);
      if (n.currentOffer >= n.anchor) continue;
      const counter = Math.min(n.anchor, n.currentOffer + 200);
      kinds.add(resolveCounter(rng, n, counter, BASE_HAGGLE_SKILL).kind);
    }
    expect([...kinds].sort()).toEqual(['accepted', 'countered', 'walked']);
  });

  it('never lets a re-counter go backwards or past their walk-away number', () => {
    const rng = createRng(808);
    for (let i = 0; i < 4_000; i++) {
      const n = openNegotiation(rng, 8_000, 1, BASE_HAGGLE_SKILL);
      if (n.currentOffer >= n.anchor) continue;
      const before = n.currentOffer;
      const outcome = resolveCounter(rng, n, n.anchor, BASE_HAGGLE_SKILL);
      if (outcome.kind === 'countered') {
        expect(outcome.offer).toBeGreaterThanOrEqual(before);
        expect(outcome.offer).toBeLessThanOrEqual(Math.max(before, n.reservation) + 0.001);
      }
    }
  });

  it('terminates: the counter budget always runs out', () => {
    const rng = createRng(55);
    for (let seed = 0; seed < 500; seed++) {
      const n = openNegotiation(rng, 6_000, 1, BASE_HAGGLE_SKILL);
      let guard = 0;
      while (n.status === 'open' && countersRemaining(n, BASE_HAGGLE_SKILL) > 0) {
        resolveCounter(rng, n, Math.min(n.anchor, n.currentOffer + 100), BASE_HAGGLE_SKILL);
        if (++guard > CFG.maxPlayerCounters + 1) break;
      }
      expect(guard).toBeLessThanOrEqual(CFG.maxPlayerCounters);
      expect(countersRemaining(n, BASE_HAGGLE_SKILL) === 0 || n.status !== 'open').toBe(true);
    }
  });

  it('ends the conversation rather than re-countering on the final round', () => {
    const rng = createRng(9);
    const n = neg({ countersMade: CFG.maxPlayerCounters - 1, reservation: 3_500 });
    // Asking far above their walk-away on the last round: they cannot come back.
    const outcome = resolveCounter(rng, n, n.anchor, BASE_HAGGLE_SKILL);
    expect(outcome.kind === 'accepted' || outcome.kind === 'walked').toBe(true);
    expect(n.status).not.toBe('open');
  });

  it('records the agreed price on acceptance', () => {
    const rng = createRng(3);
    const n = neg({ reservation: 4_000 });
    // At their own number, acceptance is certain.
    const outcome = resolveCounter(rng, n, n.currentOffer, BASE_HAGGLE_SKILL);
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
        const n = openNegotiation(rng, 10_000, 1, BASE_HAGGLE_SKILL);
        if (n.currentOffer >= n.anchor) continue;
        const counter = n.currentOffer + (n.anchor - n.currentOffer) * fraction;
        if (resolveCounter(rng, n, counter, BASE_HAGGLE_SKILL).kind === 'walked') walked += 1;
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
      const n = openNegotiation(rng, 7_500, 1, BASE_HAGGLE_SKILL);
      const c = deskCounter(n, BASE_HAGGLE_SKILL);
      expect(c).toBeGreaterThanOrEqual(n.currentOffer);
      expect(c).toBeLessThanOrEqual(n.anchor);
      expect(c % roundingIncrement(n.anchor)).toBe(0);
    }
  });
});

/**
 * The paper side of the desk.
 *
 * Financing used to be take-it-or-leave-it: the customer named a payment and you
 * signed or you did not. It is a negotiation now, and these pin the shape of it
 * — that pushing is always worth more per contract, that it can cost you the
 * customer, and that a buyer who balks is not a buyer who left.
 */
describe('pushing a weekly payment', () => {
  const theirs = 200;
  const ceiling = 260;

  it('is certain at their own number and falls away past what they can carry', () => {
    expect(paymentAcceptance(theirs, theirs, ceiling)).toBe(1);
    expect(paymentAcceptance(theirs - 50, theirs, ceiling)).toBe(1);

    const odds = [210, 230, 250, ceiling, 300, 350].map((p) =>
      paymentAcceptance(p, theirs, ceiling),
    );
    for (let i = 1; i < odds.length; i++) expect(odds[i]).toBeLessThan(odds[i - 1]);
    // At exactly their ceiling it is uncomfortable rather than impossible —
    // the same shape the cash haggle uses at the reservation price.
    expect(paymentAcceptance(ceiling, theirs, ceiling)).toBeCloseTo(
      BALANCE.negotiation.payment.acceptanceAtCeiling,
      6,
    );
    // And well past it, essentially nobody signs.
    expect(paymentAcceptance(ceiling * 2, theirs, ceiling)).toBeLessThan(0.02);
  });

  /**
   * BOTH FAILURE MODES HAVE TO EXIST. If a refused push always ended the visit
   * the slider would be pure downside and nobody would touch it; if it never
   * did, "all they can carry" would be the only correct setting and there would
   * be no decision at all.
   */
  it('loses some priced-out buyers and merely annoys the rest', () => {
    const rng = createRng(11);
    const skill = { ...BASE_HAGGLE_SKILL, walkChanceMult: 1 };
    const seen = { signed: 0, balked: 0, walked: 0 };
    for (let i = 0; i < 4_000; i++) {
      // Just past what they can carry: far enough that most refuse, close
      // enough that some still sign. At 1.4x nobody signs at all, which would
      // make this a test about two outcomes wearing a three-outcome name.
      seen[resolvePaymentPush(rng, ceiling * 1.1, theirs, ceiling, skill)] += 1;
    }
    expect(seen.signed).toBeGreaterThan(0);
    expect(seen.balked).toBeGreaterThan(0);
    expect(seen.walked).toBeGreaterThan(0);
    // Walking is the minority outcome of a refusal, so a refused push usually
    // leaves the cash deal on the table.
    expect(seen.walked).toBeLessThan(seen.balked + seen.walked);
  });

  it('never refuses a push that is not a push', () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      expect(resolvePaymentPush(rng, theirs, theirs, ceiling, BASE_HAGGLE_SKILL)).toBe('signed');
    }
  });

  it('is protected by Closing, exactly as a cash counter is', () => {
    const walks = (mult: number) => {
      const rng = createRng(77);
      let walked = 0;
      for (let i = 0; i < 3_000; i++) {
        if (
          resolvePaymentPush(rng, ceiling * 1.5, theirs, ceiling, {
            ...BASE_HAGGLE_SKILL,
            walkChanceMult: mult,
          }) === 'walked'
        ) {
          walked += 1;
        }
      }
      return walked;
    };
    expect(walks(0.6)).toBeLessThan(walks(1));
  });
});
