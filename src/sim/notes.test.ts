import { repoCarryingValue } from './notes';
import { createInitialState } from './engine';
import { generateCar } from './cars';
import { getModel } from './models';
import { createRng } from './rng';
import { repoFee } from './upgrades';
import { BALANCE, MS_PER_GAME_WEEK } from './balance';
import { totalOfPayments, weeklyPayment } from './economy';
import { expectedCollections } from './engine';
import { applyDuePayment, buildTerms, missChance, overCapacityFactor } from './notes';
import type { Note } from './types';

function makeNote(over: Partial<Note> = {}): Note {
  const principal = 5_000;
  const apr = 0.229;
  const weeks = 24;
  return {
    id: 'note_1',
    carId: 'car_1',
    carLabel: 'Renwick Comet · 180k',
    customerName: 'Test Customer',
    customerTier: 'C',
    originalPrincipal: principal,
    downPayment: 0,
    principal,
    apr,
    paymentAmount: weeklyPayment(principal, apr, weeks),
    paymentsTotal: weeks,
    paymentsRemaining: weeks,
    nextDueAt: MS_PER_GAME_WEEK,
    missedPayments: 0,
    collected: 0,
    status: 'current',
    openedAt: 0,
    ...over,
  };
}

describe('amortization', () => {
  it('retires the principal exactly over the scheduled term', () => {
    const note = makeNote();
    for (let i = 0; i < note.paymentsTotal; i++) applyDuePayment(note, true);

    expect(note.status).toBe('paid');
    expect(note.principal).toBe(0);
    expect(note.paymentsRemaining).toBe(0);
  });

  it('collects more than the amount financed, because interest is the product', () => {
    const note = makeNote();
    for (let i = 0; i < note.paymentsTotal; i++) applyDuePayment(note, true);
    expect(note.collected).toBeGreaterThan(note.originalPrincipal);
    expect(note.collected).toBeCloseTo(totalOfPayments(5_000, 0.229, 24), 0);
  });

  it('front-loads interest, so an early payoff leaves most principal standing', () => {
    const note = makeNote();
    applyDuePayment(note, true);
    const firstPrincipalReduction = note.originalPrincipal - note.principal;
    expect(firstPrincipalReduction).toBeLessThan(note.paymentAmount);
    expect(firstPrincipalReduction).toBeGreaterThan(0);
  });

  it('advances the due date by exactly one game week whether or not they paid', () => {
    const paid = makeNote();
    const due = paid.nextDueAt;
    applyDuePayment(paid, true);
    expect(paid.nextDueAt).toBe(due + MS_PER_GAME_WEEK);

    const missed = makeNote();
    applyDuePayment(missed, false);
    expect(missed.nextDueAt).toBe(due + MS_PER_GAME_WEEK);
  });

  it('handles a 0% contract without dividing by zero', () => {
    expect(weeklyPayment(5_200, 0, 26)).toBe(200);
  });
});

describe('delinquency and default', () => {
  it('flags delinquent on the first miss and defaults at the repo threshold', () => {
    const note = makeNote();
    applyDuePayment(note, false);
    expect(note.status).toBe('delinquent');
    expect(note.missedPayments).toBe(1);

    for (let i = 1; i < BALANCE.repoAfterMissedPayments; i++) {
      applyDuePayment(note, false);
    }
    expect(note.status).toBe('defaulted');
  });

  it('lets a borrower cure by paying, resetting the miss counter', () => {
    const note = makeNote();
    applyDuePayment(note, false);
    applyDuePayment(note, false);
    expect(note.missedPayments).toBe(2);

    applyDuePayment(note, true);
    expect(note.missedPayments).toBe(0);
    expect(note.status).toBe('current');
  });

  it('raises miss odds once a borrower is already behind', () => {
    const current = makeNote({ missedPayments: 0 });
    const behind = makeNote({ missedPayments: 1 });
    expect(missChance(behind, 1)).toBeGreaterThan(missChance(current, 1));
  });

  it('never lets miss chance reach certainty', () => {
    const note = makeNote({ customerTier: 'D', missedPayments: 2 });
    expect(missChance(note, 10)).toBeLessThanOrEqual(0.95);
  });
});

describe('collections capacity', () => {
  it('is neutral while the desk can handle the book', () => {
    expect(overCapacityFactor(8, 8)).toBe(1);
    expect(overCapacityFactor(3, 8)).toBe(1);
  });

  it('degrades once the book outgrows the desk', () => {
    expect(overCapacityFactor(16, 8)).toBeGreaterThan(1);
    expect(overCapacityFactor(24, 8)).toBeGreaterThan(overCapacityFactor(16, 8));
  });
});

describe('expected value of paper', () => {
  it('matches a Monte Carlo run of the same rules', () => {
    const weeks = 24;
    const payment = 200;
    const baseMiss = 0.1;
    const model = expectedCollections(weeks, payment, baseMiss);

    // Independent simulation of the exact rules applyDuePayment implements.
    let totalCollected = 0;
    let defaults = 0;
    const runs = 20_000;
    let seed = 4242;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let r = 0; r < runs; r++) {
      let consecutive = 0;
      let dead = false;
      for (let w = 0; w < weeks && !dead; w++) {
        const p = consecutive > 0 ? baseMiss * BALANCE.delinquencyMissMultiplier : baseMiss;
        if (rand() < p) {
          consecutive += 1;
          if (consecutive >= BALANCE.repoAfterMissedPayments) {
            dead = true;
            defaults += 1;
          }
        } else {
          consecutive = 0;
          totalCollected += payment;
        }
      }
    }

    expect(model.expectedCollected).toBeCloseTo(totalCollected / runs, -2);
    expect(model.defaultProbability).toBeCloseTo(defaults / runs, 1);
  });

  it('rates a clean borrower above a deep subprime one on the same contract', () => {
    const a = expectedCollections(24, 200, BALANCE.creditTiers.A.missChance);
    const d = expectedCollections(24, 200, BALANCE.creditTiers.D.missChance);
    expect(a.expectedCollected).toBeGreaterThan(d.expectedCollected);
    expect(d.defaultProbability).toBeGreaterThan(a.defaultProbability);
  });
});

describe('deal structuring', () => {
  it('asks deep subprime for more money down than good credit', () => {
    const price = 9_000;
    const a = buildTerms('A', price, 24, 1);
    const d = buildTerms('D', price, 24, 1);
    expect(price - d.amountFinanced).toBeGreaterThan(price - a.amountFinanced);
    expect(d.apr).toBeGreaterThan(a.apr);
  });

  it('lowers the weekly payment as the term stretches', () => {
    const short = buildTerms('C', 9_000, 18, 1);
    const long = buildTerms('C', 9_000, 36, 1);
    expect(long.weeklyPayment).toBeLessThan(short.weeklyPayment);
  });
});

/**
 * What a recovered car is still worth to the business.
 *
 * The arithmetic on its own, away from the engine, because it is the sort of
 * formula that is easy to get subtly wrong and easy to state exactly.
 */
describe('the carrying value of a repossessed car', () => {
  const note = (downPayment: number, collected: number) =>
    ({ downPayment, collected }) as any;

  it('is what it cost, plus the recovery, less everything the customer paid', () => {
    // Bought and reconditioned for $5,000, $250 to get it back, $1,000 down and
    // $1,200 of weekly payments already collected.
    expect(repoCarryingValue(5_000, 250, note(1_000, 1_200))).toBe(3_050);
  });

  it('credits the down payment as well as the weekly money', () => {
    const withDown = repoCarryingValue(5_000, 250, note(1_000, 0));
    const without = repoCarryingValue(5_000, 250, note(0, 0));
    // Half the point of the fix: a borrower who put $1,000 down and then never
    // paid again has still returned $1,000 of the investment.
    expect(without - withDown).toBe(1_000);
  });

  it('adds the recovery fee to the unit that cost it', () => {
    expect(repoCarryingValue(5_000, 900, note(0, 0)) - repoCarryingValue(5_000, 250, note(0, 0))).toBe(
      650,
    );
  });

  it('floors at zero rather than going negative', () => {
    // This contract returned more than the car ever cost. The business has
    // nothing left in the unit — but a negative basis would pay it floorplan
    // interest and inflate the profit on the resale past the cash it produced.
    expect(repoCarryingValue(5_000, 250, note(2_000, 9_000))).toBe(0);
  });

  it('tolerates a contract written before down payments were stored', () => {
    expect(repoCarryingValue(5_000, 250, { collected: 500 } as any)).toBe(4_750);
  });
});

describe('what it costs to get the car back', () => {
  it('scales with the car, and never drops under the flat floor', () => {
    const s = createInitialState(5, 0);
    const cheap = { ...carFixture(), modelId: 'comet', mileage: 240_000 };
    const dear = { ...carFixture(), modelId: 'norwood', mileage: 5_000 };

    // A beater bottoms out on the floor; a big car costs a multiple of it.
    expect(repoFee(s, cheap)).toBe(BALANCE.repoFee);
    expect(repoFee(s, dear)).toBeGreaterThan(BALANCE.repoFee * 3);
    // No car to price — a contract whose unit has already gone still gets
    // chased, at the floor.
    expect(repoFee(s)).toBe(BALANCE.repoFee);
  });

  it('is still discounted by the recovery agent', () => {
    const bare = createInitialState(5, 0);
    const staffed = { ...bare, upgrades: { repoMan: 3 } };
    const car = { ...carFixture(), modelId: 'norwood', mileage: 5_000 };
    expect(repoFee(staffed, car)).toBeLessThan(repoFee(bare, car));
  });
});

/** A plain car to price a recovery against. */
function carFixture() {
  return generateCar({ nextId: 1 }, createRng(3), getModel('comet'), 0);
}
