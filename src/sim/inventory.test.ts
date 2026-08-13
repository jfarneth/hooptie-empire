import { BALANCE, MS_PER_GAME_DAY, MS_PER_GAME_WEEK } from './balance';
import { buyListing, startRecon, sellToWholesaler } from './actions';
import { advance, cloneState, createInitialState, weeklyExpenses } from './engine';
import { INVENTORY_SORTS, inventoryReport, inventoryTotals, type InventorySort } from './inventory';
import type { GameState } from './types';

/**
 * The ageing report.
 *
 * Two of these are load-bearing and the rest are properties of a pure sort. The
 * first is that the per-car carrying accruals add up to exactly the floorplan
 * line the ledger charged — the report's whole claim is that it can tell the
 * player where the money went, and a total that disagrees with the bill is a
 * confident lie. The second is that a car's ledger adds up to its own basis,
 * which is what stops the "paid / repairs" split drifting away from the number
 * profit is actually measured against.
 */

/** A trading lot, running unattended, for as many game weeks as asked. */
function tradingFor(weeks: number, seed = 404): GameState {
  let s = cloneState(createInitialState(seed, 0));
  s.stage = 'smallUsed';
  s.cash = 400_000;
  s.upgrades = { autoBuy: 1, autoList: 1, autoRecon: 1, salesDesk: 1, collections: 3, lot: 2 };
  s.dealPolicy = 'auto';
  s.listings = [];
  return advance(s, weeks * MS_PER_GAME_WEEK + 2_000);
}

/**
 * One car, bought by hand off the opening feed.
 *
 * The first listing of a new game is dealt rather than rolled — guaranteed
 * affordable — so this is the cheapest way to get a car onto a lot with none of
 * the automation running over it afterwards.
 */
function boughtOne(seed: number): { s: GameState; carId: string } {
  let s = cloneState(createInitialState(seed, 0));
  s.cash = 200_000;
  s = buyListing(s, s.listings[0].id);
  const car = s.cars.find((c) => c.status !== 'sold');
  expect(car).toBeDefined();
  return { s, carId: car!.id };
}

describe('the per-car cost ledger', () => {
  it('splits a purchase into what the seller got and what the truck cost', () => {
    const s = tradingFor(1);
    const held = s.cars.filter((c) => c.status !== 'sold');
    expect(held.length).toBeGreaterThan(0);

    for (const car of held) {
      expect(car.purchasePrice).toBeGreaterThan(0);
      expect(car.freightPaid).toBeGreaterThanOrEqual(0);
      // A small lot buys locally — there is no reach upgrade below the big lot —
      // so nothing here should be carrying a transporter bill.
      expect(car.freightPaid).toBe(0);
    }
  });

  /**
   * THE SPLIT MUST RECONSTRUCT THE BASIS. `costBasis` is what `lifetimeProfit`
   * is charged at the sale, and the report's "paid + repairs" is the same money
   * described twice. If those two ever drift, one of the two screens showing
   * them is wrong and nothing else would say which.
   *
   * Repossessed units are excluded on purpose and not by oversight: a repo
   * rewrites the basis to what is LEFT in the car, which is deliberately not
   * the sum of what went in. That case is covered below.
   */
  it('adds a car up to the basis the books will charge', () => {
    const s = tradingFor(3);
    const held = s.cars.filter((c) => c.status !== 'sold' && c.repoCount === 0);
    expect(held.length).toBeGreaterThan(0);

    for (const car of held) {
      expect(car.purchasePrice + car.freightPaid + car.reconSpend).toBe(car.costBasis);
    }
  });

  it('books recon spend against the car it was done to', () => {
    const { s, carId } = boughtOne(11);
    const car = s.cars.find((c) => c.id === carId)!;

    const worked = startRecon(s, carId).cars.find((c) => c.id === carId)!;

    const spent = worked.costBasis - car.costBasis;
    expect(spent).toBeGreaterThan(0);
    // Both halves move together or neither does — see `chargeRecon`.
    expect(worked.reconSpend - car.reconSpend).toBe(spent);
    // And it did not land on the purchase price, which is a record of a deal
    // that happened once.
    expect(worked.purchasePrice).toBe(car.purchasePrice);
  });

  /**
   * THE LOAD-BEARING ONE. Every dollar of floorplan the ledger charged has to
   * be attributable to a car, or the report is quoting a cost the business
   * never paid — or worse, hiding one it did.
   *
   * Measured against `weeklyExpenses` rather than against a restatement of the
   * arithmetic, for the reason `financeGrossMultiple` was wrong for months: a
   * test that computes its expectation by redoing the sum under test cannot
   * fail.
   */
  it('accrues the whole floorplan bill against the cars that incurred it', () => {
    let s = cloneState(createInitialState(7, 0));
    s.stage = 'smallUsed';
    s.cash = 400_000;
    s.upgrades = { autoBuy: 1, autoList: 1, autoRecon: 1, lot: 2 };
    s.listings = [];
    // Up to the bill, but not through it: nothing has accrued yet.
    s = advance(s, MS_PER_GAME_WEEK - 5_000);
    expect(s.cars.every((c) => c.carryingCost === 0)).toBe(true);

    const due = weeklyExpenses(s).floorplan;
    expect(due).toBeGreaterThan(0);

    // Through exactly one bill. Nothing may leave the lot in the slice, or the
    // sum would be measuring a different set of cars than the bill did.
    const held = new Set(s.cars.filter((c) => c.status !== 'sold').map((c) => c.id));
    s = advance(s, 6_000);
    expect(new Set(s.cars.filter((c) => c.status !== 'sold').map((c) => c.id))).toEqual(held);

    const accrued = s.cars.reduce((n, c) => n + c.carryingCost, 0);
    // The per-car shares are unrounded so they sum to the rounded bill exactly.
    expect(Math.round(accrued)).toBe(due);
  });

  it('charges nothing to a car that is out with a customer', () => {
    const s = tradingFor(4);
    const sold = s.cars.filter((c) => c.status === 'sold');
    expect(sold.length).toBeGreaterThan(0);
    // Financed cars are the book's problem, not the floorplan's — the same rule
    // `weeklyExpenses` follows. What they accrued while they were on the lot
    // stays with them, so this is a ceiling rather than a zero.
    for (const car of sold) {
      expect(car.carryingCost).toBeLessThan(
        car.costBasis * BALANCE.expenses.floorplanWeeklyRate * 5,
      );
    }
  });

  it('records both halves of a round trip on a repossessed car', () => {
    const s = tradingFor(140, 88);
    const repod = s.cars.filter((c) => c.repoCount > 0);
    expect(repod.length).toBeGreaterThan(0);

    for (const car of repod) {
      expect(car.recoveryCost).toBeGreaterThan(0);
      expect(car.returned).toBeGreaterThan(0);
      // The basis is what is LEFT in the unit — everything that went in, less
      // everything the customer handed back, floored at zero — so it can never
      // exceed the money spent. That gap IS the report's reason to exist: the
      // basis cannot tell you a car cost $6,000 and gave $5,400 of it back.
      expect(car.costBasis).toBeLessThanOrEqual(
        car.purchasePrice + car.freightPaid + car.reconSpend + car.recoveryCost,
      );
    }

    const back = inventoryReport(s).filter((l) => l.car.repoCount > 0);
    for (const l of back) {
      expect(l.returned).toBeGreaterThan(0);
      expect(l.allIn).toBeLessThan(l.sunk);
    }
  });
});

describe('the report', () => {
  it('shows what is on the lot and nothing that has left it', () => {
    const s = tradingFor(4);
    const lines = inventoryReport(s);
    expect(lines.length).toBe(s.cars.filter((c) => c.status !== 'sold').length);
    expect(lines.some((l) => l.status === 'sold')).toBe(false);
  });

  it('is empty on a lot with nothing on it', () => {
    const s = cloneState(createInitialState(3, 0));
    s.cars = [];
    expect(inventoryReport(s)).toEqual([]);
    const totals = inventoryTotals([]);
    expect(totals.units).toBe(0);
    expect(totals.medianDays).toBe(0);
    expect(totals.oldestDays).toBe(0);
  });

  it('puts the oldest car on top by default', () => {
    const s = tradingFor(5);
    const lines = inventoryReport(s);
    expect(lines.length).toBeGreaterThan(2);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].daysHeld).toBeLessThanOrEqual(lines[i - 1].daysHeld);
    }
    // The default really is the oldest-first ordering, not merely whatever the
    // engine happened to append in.
    expect(inventoryReport(s, 'age').map((l) => l.car.id)).toEqual(lines.map((l) => l.car.id));
  });

  it('orders every sort the way its label promises', () => {
    const s = tradingFor(6);
    const checks: Record<InventorySort, (a: number, b: number) => void> = {
      age: (a, b) => expect(a).toBeGreaterThanOrEqual(b),
      money: (a, b) => expect(a).toBeGreaterThanOrEqual(b),
      margin: (a, b) => expect(a).toBeLessThanOrEqual(b),
      carrying: (a, b) => expect(a).toBeGreaterThanOrEqual(b),
    };
    const value: Record<InventorySort, (l: ReturnType<typeof inventoryReport>[number]) => number> = {
      age: (l) => l.daysHeld,
      money: (l) => l.allIn,
      margin: (l) => l.margin ?? Number.POSITIVE_INFINITY,
      carrying: (l) => l.carrying,
    };

    for (const sort of INVENTORY_SORTS) {
      const lines = inventoryReport(s, sort);
      expect(lines.length).toBeGreaterThan(2);
      for (let i = 1; i < lines.length; i++) {
        checks[sort](value[sort](lines[i - 1]), value[sort](lines[i]));
      }
    }
  });

  it('holds the same cars whichever way it is sorted', () => {
    const s = tradingFor(5);
    const ids = (sort: InventorySort) =>
      inventoryReport(s, sort)
        .map((l) => l.car.id)
        .sort();
    const base = ids('age');
    expect(base.length).toBeGreaterThan(2);
    for (const sort of INVENTORY_SORTS) expect(ids(sort)).toEqual(base);
  });

  it('measures a listed car against its sticker and an unlisted one against retail', () => {
    const s = tradingFor(3);
    for (const l of inventoryReport(s)) {
      if (l.status === 'listed' && l.car.askPrice > 0) {
        expect(l.listed).toBe(true);
        expect(l.exit).toBe(l.car.askPrice);
      } else {
        expect(l.listed).toBe(false);
        expect(l.exit).toBe(l.retail);
      }
      expect(l.profit).toBe(l.exit - l.allIn);
      expect(l.margin).toBeCloseTo(l.profit / l.exit, 10);
    }
  });

  /**
   * `allIn` is the report's headline and it is NOT the basis — floorplan
   * interest is an operating expense charged the week it accrues, so it is
   * money the car cost and is not money the sale will be charged for. The
   * screen says both; this is what stops them being quietly conflated.
   */
  it('nets everything out and back into one number', () => {
    const s = tradingFor(6);
    for (const l of inventoryReport(s)) {
      expect(l.sunk).toBe(l.purchase + l.freight + l.recon + l.carrying + l.recovery);
      expect(l.allIn).toBe(l.sunk - l.returned);
      expect(l.basis).toBe(l.car.costBasis);
    }
  });

  it('totals every column the lines carry', () => {
    const s = tradingFor(5);
    const lines = inventoryReport(s);
    const t = inventoryTotals(lines);

    expect(t.units).toBe(lines.length);
    expect(t.allIn).toBeCloseTo(
      lines.reduce((n, l) => n + l.allIn, 0),
      6,
    );
    expect(t.carrying).toBeCloseTo(
      lines.reduce((n, l) => n + l.carrying, 0),
      6,
    );
    expect(t.oldestDays).toBe(Math.max(...lines.map((l) => l.daysHeld)));
    expect(t.underWaterUnits).toBe(lines.filter((l) => l.profit < 0).length);
    // Next week's floorplan, in advance, is the same number the bill will be.
    expect(Math.round(t.weeklyCarry)).toBe(weeklyExpenses(s).floorplan);
  });

  it('takes a car out of the report the moment it is wholesaled', () => {
    const s = tradingFor(4);
    const target = inventoryReport(s)[0];
    const after = sellToWholesaler(s, target.car.id);
    expect(inventoryReport(after).some((l) => l.car.id === target.car.id)).toBe(false);
  });

  it('counts days from the day it was bought, not from the day it was listed', () => {
    const started = boughtOne(21);
    const bought = started.s.cars.find((c) => c.id === started.carId)!.acquiredAt;

    const s = advance(started.s, 3 * MS_PER_GAME_DAY);
    const line = inventoryReport(s).find((l) => l.car.id === started.carId)!;
    expect(line.daysHeld).toBeCloseTo((s.t - bought) / MS_PER_GAME_DAY, 6);
    // A car that has never been listed has no listed age at all, rather than a
    // zero that would read as "went up today".
    if (line.car.listedAt === null) expect(line.daysListed).toBeNull();
  });
});
