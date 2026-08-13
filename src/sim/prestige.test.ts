import { retire, takeLoan, payOffLoan } from './actions';
import { BALANCE, MS_PER_GAME_WEEK } from './balance';
import { advance, cloneState, createInitialState, weeklyExpenses } from './engine';
import { loanBalance, prestigeEdge, retirementPreview, sharkOffer } from './prestige';
import { SKILL_IDS } from './skills';
import type { GameState } from './types';

/**
 * Retirement and the shark.
 *
 * Two mechanics that form one system: the loan is the first way out of a stuck
 * run and retirement is the last one. The properties that matter are all about
 * what survives, what settles, and what can never be gamed — the confirmation
 * shows `retirementPreview` and `retire` pays exactly it, so most of these are
 * really tests that the two can never disagree.
 */

function richRun(): GameState {
  const s = cloneState(createInitialState(99, 1_000_000));
  s.stage = 'largeUsed';
  s.cash = 2_500_000;
  s.skills.buy.level = 7;
  s.skills.sell.level = 5;
  s.prestige = { count: 1, points: 2, history: [
    { n: 1, at: 500_000, hours: 10, stage: 'smallUsed', gross: 2_000_000, debt: 0, net: 2_000_000, points: 2 },
  ] };
  return s;
}

describe('retirement value', () => {
  it('sums cash, the lot at forced sale, and the book at the note-buyer rate', () => {
    const s = richRun();
    s.cars = advance({ ...s, upgrades: { autoBuy: 1 } }, 30 * 60_000).cars;
    s.notes = [{
      id: 'n1', carId: 'c1', carLabel: 'x', customerName: 'y', customerTier: 'C',
      originalPrincipal: 10_000,
      downPayment: 0, principal: 8_000, apr: 0.239, paymentAmount: 400,
      paymentsTotal: 24, paymentsRemaining: 20, nextDueAt: 999_999_999_999,
      missedPayments: 0, collected: 0, status: 'current', openedAt: 0,
    }];

    const p = retirementPreview(s);
    expect(p.bookValue).toBe(Math.round(8_000 * BALANCE.prestige.notesSaleRate));
    expect(p.gross).toBe(p.cash + p.lotValue + p.bookValue);
    expect(p.net).toBe(p.gross); // no loan
    expect(p.points).toBe(Math.floor(p.net / BALANCE.prestige.pointDollars));
  });

  it('settles the shark off the top, and floors the scoreboard at zero', () => {
    const s = richRun();
    s.cash = 40_000;
    s.loan = {
      originalPrincipal: 90_000,
      apr: 0.32, paymentAmount: 4_500,
      paymentsRemaining: 24, nextDueAt: 0, openedAt: 0,
    };
    const p = retirementPreview(s);
    expect(p.debt).toBe(4_500 * 24);
    expect(p.net).toBe(0); // underwater: 40k against 108k owed
    expect(p.points).toBe(0);
  });
});

describe('retire()', () => {
  it('starts a genuinely new game and carries only what it should', () => {
    const before = richRun();
    const after = retire(before);

    // A new game.
    expect(after.stage).toBe('curbstone');
    expect(after.cash).toBe(BALANCE.startingCash);
    expect(after.cars).toEqual([]);
    expect(after.notes).toEqual([]);
    expect(after.upgrades).toEqual({});
    expect(after.loan).toBeNull();

    // The inheritance, complete and exact.
    for (const id of SKILL_IDS) expect(after.skills[id].level).toBe(before.skills[id].level);
    expect(after.business).toEqual(before.business);
    expect(after.tuning).toEqual(before.tuning);
    expect(after.prestige.count).toBe(2);
    expect(after.prestige.history).toHaveLength(2);
  });

  it('increments the counter even on a worthless bail-out', () => {
    // The escape-hatch case: broke, in the hole to the shark, nothing to sell.
    const s = cloneState(createInitialState(7, 0));
    s.cash = -12_000;
    s.loan = {
      originalPrincipal: 20_000,
      apr: 0.32, paymentAmount: 1_000,
      paymentsRemaining: 18, nextDueAt: 0, openedAt: 0,
    };
    const after = retire(s);
    expect(after.prestige.count).toBe(1);
    expect(after.prestige.points).toBe(0);
    expect(after.prestige.history[0].net).toBe(0);
    expect(after.loan).toBeNull();
    expect(after.cash).toBe(BALANCE.startingCash);
  });

  it('banks points that make every later ask cheaper, capped', () => {
    const s = richRun();
    s.prestige.points = 10;
    expect(prestigeEdge(s)).toBeCloseTo(10 * BALANCE.prestige.edgePerPoint, 10);
    s.prestige.points = 10_000;
    expect(prestigeEdge(s)).toBe(BALANCE.prestige.edgeCap);

    // And the edge reaches the actual feed: same seed, same advance, cheaper
    // listings for the veteran. Identical RNG stream is part of the claim.
    const rookie = createInitialState(1234, 0);
    const veteran = cloneState(createInitialState(1234, 0));
    veteran.prestige.points = 50;
    const a = advance(rookie, 10 * 60_000);
    const b = advance(veteran, 10 * 60_000);
    expect(b.rng.s).toBe(a.rng.s);
    expect(b.listings.length).toBe(a.listings.length);
    const cheaper = b.listings.filter((l, i) => l.price < a.listings[i].price);
    expect(cheaper.length).toBe(a.listings.length);
  });
});

describe('the shark', () => {
  it('offers a chunky round figure that never mentions cars', () => {
    const offer = sharkOffer({ stage: 'largeUsed' });
    expect(offer.principal % 1_000).toBe(0);
    expect(offer.totalRepay).toBeGreaterThan(offer.principal); // the vig is real
    expect(offer.weeklyPayment * offer.termWeeks).toBe(offer.totalRepay);
  });

  it('lends once, collects weekly, and will drive the balance negative', () => {
    let s = cloneState(createInitialState(11, 0));
    s.stage = 'largeUsed';
    s.cash = 1_000;
    s = takeLoan(s);
    expect(s.loan).not.toBeNull();
    const withCash = s.cash;
    expect(withCash).toBeGreaterThan(1_000);

    // No seconds while one is out.
    expect(takeLoan(s)).toBe(s);

    // Drain the cash, then let two bill beats land: the shark still collects,
    // and his cut is the one charge allowed below zero.
    s = cloneState(s);
    s.cash = 100;
    s = advance(s, MS_PER_GAME_WEEK * 2 + 5_000);
    expect(s.cash).toBeLessThan(0);
    expect(s.loan!.paymentsRemaining).toBeLessThan(BALANCE.loan.termWeeks);
  });

  it('appears in the weekly expense breakdown so reserves budget for it', () => {
    let s = cloneState(createInitialState(12, 0));
    s.stage = 'largeUsed';
    s = takeLoan(s);
    const e = weeklyExpenses(s);
    expect(e.debtService).toBe(s.loan!.paymentAmount);
    expect(e.total).toBe(e.rent + e.payroll + e.floorplan + e.debtService);
  });

  it('lets a flush business pay him off early, vig included', () => {
    let s = cloneState(createInitialState(13, 0));
    s.stage = 'largeUsed';
    s = takeLoan(s);
    const owed = loanBalance(s.loan);
    s = cloneState(s);
    s.cash = owed + 500;
    s = payOffLoan(s);
    expect(s.loan).toBeNull();
    expect(s.cash).toBe(500);

    // And a broke one cannot: the payoff never digs the hole deeper.
    let broke = cloneState(createInitialState(14, 0));
    broke.stage = 'largeUsed';
    broke = takeLoan(broke);
    broke = cloneState(broke);
    broke.cash = 50;
    expect(payOffLoan(broke)).toBe(broke);
  });

  it('amortizes to exactly zero and disappears', () => {
    let s = cloneState(createInitialState(15, 0));
    s.stage = 'largeUsed';
    s = takeLoan(s);
    s = cloneState(s);
    s.cash = 10_000_000; // rich enough that overheads never confuse the ledger
    s = advance(s, MS_PER_GAME_WEEK * (BALANCE.loan.termWeeks + 2));
    expect(s.loan).toBeNull();
  });
});

describe('clone isolation', () => {
  it('does not share the prestige history or the loan between a state and its clone', () => {
    const s = richRun();
    s.loan = {
      originalPrincipal: 10_000,
      apr: 0.32, paymentAmount: 500,
      paymentsRemaining: 24, nextDueAt: 0, openedAt: 0,
    };
    const c = cloneState(s);
    c.prestige.history[0].net = 1;
    c.loan!.paymentsRemaining = 1;
    expect(s.prestige.history[0].net).toBe(2_000_000);
    expect(s.loan!.paymentsRemaining).toBe(24);
  });
});
