import { MS_PER_GAME_WEEK } from './balance';
import { BALANCE } from './balance';
import {
  BOOK_LINES,
  WEEKS_IN_VIEW,
  lastWeek,
  lineActive,
  lineMargin,
  marginTrend,
  recentWeeks,
  weekMargin,
  weekSoFar,
} from './books';
import { sellToWholesaler, setCash, takeLoan } from './actions';
import { hireServiceTech } from './actions';
import { repoThreshold } from './business';
import { generateCar } from './cars';
import { generateProspect } from './customers';
import {
  acceptFinance,
  advance,
  cloneState,
  cloneWeekLines,
  createInitialState,
  emptyWeekLines,
  listCar,
  weeklyExpenses,
} from './engine';
import { getModel } from './models';
import { haggleSkillFor } from './skills';
import { repoFee } from './upgrades';
import type { GameState, Note, WeekLines, WeekRecord } from './types';

/**
 * The weekly books.
 *
 * The load-bearing test is the last one: the filed weeks have to add up to the
 * lifetime profit they were carved out of. Everything else here is a property of
 * a small pure function, but that one is the promise the readout makes — a trend
 * chart summarising a number it does not agree with is worse than no chart.
 */

/** A trading lot, running unattended, for as many game weeks as asked. */
function tradingFor(weeks: number, seed = 909): GameState {
  let s = cloneState(createInitialState(seed, 0));
  s.stage = 'smallUsed';
  s.cash = 300_000;
  s.upgrades = { autoBuy: 1, autoList: 1, autoRecon: 1, salesDesk: 1, collections: 3, lot: 2 };
  s.dealPolicy = 'auto';
  s.listings = [];
  return advance(s, weeks * MS_PER_GAME_WEEK + 2_000);
}

function week(revenue: number, profit: number, endedAt = 0): WeekRecord {
  return { endedAt, revenue, profit, lines: null };
}

/**
 * A franchise store with every line running at once: metal, paper, cover and
 * the bays. The only fixture that can exercise all five, because plans and the
 * shop do not exist below the big lot and the franchises are where both do.
 */
function fullHouse(weeks: number, seed = 616): GameState {
  let s = cloneState(createInitialState(seed, 0));
  s.stage = 'midsizeFranchise';
  s.cash = 40_000_000;
  s.upgrades = {
    autoBuy: 1,
    autoList: 1,
    autoRecon: 1,
    salesDesk: 1,
    collections: 5,
    lot: 2,
    serviceBays: 3,
  };
  s.dealPolicy = 'auto';
  s.listings = [];
  s = hireServiceTech(s, 1);
  s = hireServiceTech(s, 2);
  return advance(s, weeks * MS_PER_GAME_WEEK + 2_000);
}

const sumLines = (lines: WeekLines | null, key: 'revenue' | 'profit') =>
  lines ? BOOK_LINES.reduce((n, id) => n + lines[id][key], 0) : 0;

describe('a week is closed on the bill beat', () => {
  it('files one week per game week, and no more', () => {
    for (const n of [1, 3, 6]) {
      expect(tradingFor(n).weeks.length).toBe(n);
    }
  });

  it('files nothing at all before the first bill falls due', () => {
    const s = advance(cloneState(createInitialState(4, 0)), MS_PER_GAME_WEEK - 5_000);
    expect(s.weeks).toHaveLength(0);
    expect(lastWeek(s)).toBeNull();
  });

  it('keeps a bounded history', () => {
    const s = tradingFor(BALANCE.weekHistory + 5);
    expect(s.weeks.length).toBe(BALANCE.weekHistory);
    // The OLDEST go, so the chart is the recent past.
    for (let i = 1; i < s.weeks.length; i++) {
      expect(s.weeks[i].endedAt).toBeGreaterThan(s.weeks[i - 1].endedAt);
    }
  });

  it('starts the next week from zero', () => {
    const s = tradingFor(2);
    // Closed exactly on the beat, so almost nothing has been taken since.
    expect(s.weekRevenue).toBeLessThan(s.weeks[s.weeks.length - 1].revenue);
    expect(s.weekProfitAt).toBeCloseTo(s.stats.lifetimeProfit - weekSoFar(s).profit, 2);
  });

  /**
   * THE PROMISE THE READOUT MAKES.
   *
   * Profit per week is a subtraction off `lifetimeProfit` rather than a second
   * running total, precisely so the two can never drift — and this is what says
   * so. Every filed week plus the part-week in progress has to reconstruct the
   * lifetime figure exactly, or the chart is summarising a different business
   * from the one the ledger describes.
   */
  it('adds up to the lifetime profit it was carved out of', () => {
    const s = tradingFor(6);
    const filed = s.weeks.reduce((n, w) => n + w.profit, 0);
    const sinceLastBill = weekSoFar(s).profit;
    expect(filed + sinceLastBill).toBeCloseTo(Math.round(s.stats.lifetimeProfit), 0);
  });

  /**
   * And revenue is money IN, not the change in cash. A week that bought six cars
   * and sold none has spent heavily and taken nothing, and reporting the cash
   * delta as revenue would show it as a catastrophic negative — which is the
   * whole confusion this readout exists to end.
   */
  it('counts what customers paid, not what the till did', () => {
    const s = tradingFor(4);
    for (const w of s.weeks) expect(w.revenue).toBeGreaterThanOrEqual(0);
    // A trading lot takes real money.
    expect(s.weeks.some((w) => w.revenue > 0)).toBe(true);
    // And the total taken is at least what the sales stats say was collected on
    // paper, which is only one of the several ways money arrives.
    const taken = s.weeks.reduce((n, w) => n + w.revenue, 0) + weekSoFar(s).revenue;
    expect(taken).toBeGreaterThan(s.stats.totalCollected);
  });

  /**
   * Borrowing is not a good week, and neither is the admin console. Both put
   * money in the till, and revenue that could not tell them from a customer
   * would report the best week the business ever had every time it took a loan.
   *
   * Driven through the real actions rather than by poking `cash`: the first cut
   * of this test moved the balance by hand, which exercises no code at all and
   * therefore passes whatever `bookRevenue` does.
   */
  it('does not count the shark\'s money, or the admin console\'s, as revenue', () => {
    const s = tradingFor(1);

    const borrowed = takeLoan(s);
    expect(borrowed.cash).toBeGreaterThan(s.cash);
    expect(borrowed.weekRevenue).toBe(s.weekRevenue);

    const conjured = setCash(s, s.cash + 250_000);
    expect(conjured.cash).toBeGreaterThan(s.cash);
    expect(conjured.weekRevenue).toBe(s.weekRevenue);
  });

  /** ...and a customer's money always is. */
  it('counts a wholesaler cheque, which is still somebody paying for a car', () => {
    const s = tradingFor(1);
    const car = s.cars.find((c) => c.status !== 'sold');
    expect(car).toBeDefined();
    const after = sellToWholesaler(s, car!.id);
    expect(after.weekRevenue).toBeGreaterThan(s.weekRevenue);
  });
});

describe('reading a week', () => {
  it('is what was left over what came in', () => {
    expect(weekMargin(week(10_000, 2_500))).toBeCloseTo(0.25, 6);
    expect(weekMargin(week(10_000, -1_000))).toBeCloseTo(-0.1, 6);
  });

  /**
   * A week with no revenue has no percentage, and saying so is the point. A lot
   * with nothing listed still pays rent, so the profit is negative and the
   * margin is a division by zero — reporting that as -100%, or as 0%, would both
   * be inventing a denominator the week does not have.
   */
  it('refuses to invent a margin for a week that sold nothing', () => {
    expect(weekMargin(week(0, -4_000))).toBeNull();
    expect(weekMargin(null)).toBeNull();
    expect(weekMargin(undefined)).toBeNull();
  });

  it('reports the last closed week, never the one in progress', () => {
    const s = tradingFor(3);
    const last = lastWeek(s)!;
    expect(last).toBe(s.weeks[s.weeks.length - 1]);
    // The part-week is available separately, and is a different object.
    expect(weekSoFar(s)).not.toBe(last);
    expect(weekSoFar(s).endedAt).toBe(s.t);
  });

  it('hands back at most what it has, oldest first', () => {
    const s = tradingFor(3);
    expect(recentWeeks(s, WEEKS_IN_VIEW)).toHaveLength(3);
    expect(recentWeeks(s, 2)).toHaveLength(2);
    expect(recentWeeks(s, 2)[1]).toBe(s.weeks[s.weeks.length - 1]);
    // Never padded — a young business has a short chart, not a flat one.
    expect(recentWeeks({ weeks: [] }, 8)).toHaveLength(0);
  });
});

describe('the trend', () => {
  const withWeeks = (margins: number[]) => ({
    weeks: margins.map((m, i) => week(10_000, Math.round(10_000 * m), i)),
  });

  it('says nothing until there is something to say', () => {
    expect(marginTrend({ weeks: [] })).toBeNull();
    expect(marginTrend(withWeeks([0.2]))).toBeNull();
    expect(marginTrend(withWeeks([0.2, 0.3]))).toBeNull();
    expect(marginTrend(withWeeks([0.2, 0.3, 0.25]))).not.toBeNull();
  });

  it('compares the latest week against the ones before it', () => {
    // Flat at 20%, then a 30% week: half a point better than the mean of 0.2.
    expect(marginTrend(withWeeks([0.2, 0.2, 0.2, 0.3]))!).toBeCloseTo(0.1, 6);
    expect(marginTrend(withWeeks([0.3, 0.3, 0.3, 0.2]))!).toBeCloseTo(-0.1, 6);
  });

  it('ignores weeks that sold nothing rather than scoring them as zero', () => {
    const quiet = { weeks: [week(0, -500, 0), week(10_000, 2_000, 1), week(10_000, 2_000, 2), week(10_000, 3_000, 3)] };
    // The dead week is skipped, so this is 30% against a mean of 20%.
    expect(marginTrend(quiet)!).toBeCloseTo(0.1, 6);
  });
});

describe('the books on the state', () => {
  it('survive a clone without leaking backwards', () => {
    const s = tradingFor(2);
    const copy = cloneState(s);
    copy.weeks[0].profit = 999_999;
    copy.weeks.push(week(1, 1, 99));

    expect(s.weeks[0].profit).not.toBe(999_999);
    expect(s.weeks).toHaveLength(2);
  });

  /**
   * The lines are a nested block on a filed week and on the live one, so both
   * need a real copy. The live one is what would actually bite — the tick
   * writes to it on every sale — and a shared object would leak backwards
   * through history and corrupt offline catch-up.
   *
   * This is the clone-isolation test CLAUDE.md asks for on anything of this
   * shape, and it is the thing that catches a missed clone; the tick-invariance
   * fingerprint provably does not.
   */
  it('give the week lines a real copy, live and filed', () => {
    const s = fullHouse(2);
    const copy = cloneState(s);

    copy.weekLines.metal.profit = 123_456;
    expect(s.weekLines.metal.profit).not.toBe(123_456);

    expect(s.weeks[0].lines).not.toBeNull();
    copy.weeks[0].lines!.shop.revenue = 987_654;
    expect(s.weeks[0].lines!.shop.revenue).not.toBe(987_654);
  });
});

/**
 * The departmental split.
 *
 * THE LOAD-BEARING ONE IS THE FIRST. The week's headline profit is a
 * subtraction off `lifetimeProfit` and the five lines are running totals, which
 * is exactly the drift this file's older test exists to prevent one level up.
 * The only thing keeping them together is that `bookProfit` is the single door
 * `lifetimeProfit` moves through — so this is the test that goes red the moment
 * somebody writes `s.stats.lifetimeProfit += x` anywhere else, which is a thing
 * no reader would ever notice and no other test can see.
 */
describe('the business lines', () => {
  it('add up to the week they were carved out of', () => {
    const s = fullHouse(5);
    expect(s.weeks.length).toBe(5);

    for (const w of s.weeks) {
      expect(w.lines).not.toBeNull();
      // EXACTLY, on a filed week. `fileWeekLines` rounds the split to whole
      // dollars against the headline, so the five tiles on screen add up to the
      // number written above them with nothing left over.
      expect(sumLines(w.lines, 'profit')).toBe(w.profit);
      expect(sumLines(w.lines, 'revenue')).toBe(w.revenue);
    }

    // The week in progress is still accruing in cents, so it reconciles to the
    // one rounding its headline does and no further.
    const running = weekSoFar(s);
    expect(Math.abs(sumLines(running.lines, 'profit') - running.profit)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sumLines(running.lines, 'revenue') - running.revenue)).toBeLessThanOrEqual(0.5);
  });

  it('reconstruct the lifetime figure, line by line, across every week', () => {
    const s = fullHouse(6);
    const filed = s.weeks.reduce((n, w) => n + sumLines(w.lines, 'profit'), 0);
    const running = sumLines(weekSoFar(s).lines, 'profit');
    expect(filed + running).toBeCloseTo(s.stats.lifetimeProfit, 0);
  });

  it('runs all four earning lines at a franchise with bays', () => {
    const s = fullHouse(8);
    const totals = emptyWeekLines();
    for (const w of [...s.weeks, weekSoFar(s)]) {
      if (!w.lines) continue;
      for (const id of BOOK_LINES) {
        totals[id].revenue += w.lines[id].revenue;
        totals[id].profit += w.lines[id].profit;
      }
    }

    // Everything the store sells takes money...
    for (const id of ['metal', 'paper', 'plans', 'shop'] as const) {
      expect(totals[id].revenue).toBeGreaterThan(0);
    }
    // ...and overhead only ever spends. Rent does not have customers.
    expect(totals.overhead.revenue).toBe(0);
    expect(totals.overhead.profit).toBeLessThan(0);
  });

  /**
   * Floorplan on the cars and the technicians on the bays. Both are paid by one
   * cheque on the bill beat and both used to land in a single overheads lump —
   * which would leave a shop that bills a fortune and loses money on wages
   * reading as pure profit, the exact trap this split exists to make visible.
   */
  it('charges the technicians to the bays and the floorplan to the cars', () => {
    let s = fullHouse(3);

    /**
     * A QUIET TICK, deliberately arranged. Everything that could move a line
     * other than the bill is cleared first — no notes to collect, no plans to
     * claim on, no jobs to finish, no buyers on the lot — so the one tick the
     * bill falls on moves exactly three lines by exactly three known numbers.
     *
     * The first cut of this measured a whole week and asserted directions, and
     * it passed with the floorplan filed under overhead. A three-way split
     * needs all three pinned, and the only way to pin them is to make the bill
     * the only thing that happens.
     */
    s = advance(s, s.nextBillAt - s.t - 1_000);
    s.notes = [];
    s.serviceContracts = [];
    s.shop.jobs = [];
    s.shop.techs.forEach((t) => (t.jobId = null));
    s.prospects = [];

    // Read AFTER the advance, not before it: the lot the floorplan is charged
    // on is the lot as it stands when the bill falls, and a week of automated
    // buying moves it a long way.
    const bill = weeklyExpenses(s);
    expect(bill.shopPayroll).toBeGreaterThan(0);
    expect(bill.floorplan).toBeGreaterThan(0);

    const before = cloneWeekLines(s.weekLines);
    const filedBefore = s.weeks.length;
    s = advance(s, 1_000);
    expect(s.weeks.length).toBe(filedBefore + 1);
    const filed = s.weeks[s.weeks.length - 1].lines!;

    // Rent, the sales payroll and the shark — and nothing else, which is what
    // says the other two really did leave this line.
    expect(filed.overhead.profit - before.overhead.profit).toBeCloseTo(
      -(bill.total - bill.floorplan - bill.shopPayroll),
      0,
    );
    // Interest on unsold stock, on the cars.
    expect(filed.metal.profit - before.metal.profit).toBeCloseTo(-bill.floorplan, 0);
    // The technicians, on the bays that employ them.
    expect(filed.shop.profit - before.shop.profit).toBeCloseTo(-bill.shopPayroll, 0);
  });

  it('has no margin on a line that took nothing', () => {
    expect(lineMargin({ revenue: 0, profit: -900 })).toBeNull();
    expect(lineMargin(undefined)).toBeNull();
    expect(lineMargin({ revenue: 1_000, profit: 250 })).toBeCloseTo(0.25, 6);
  });

  it('treats a line that did nothing at all as absent', () => {
    expect(lineActive({ revenue: 0, profit: 0 })).toBe(false);
    expect(lineActive(undefined)).toBe(false);
    // A line that only ever cost money is still a line that happened.
    expect(lineActive({ revenue: 0, profit: -400 })).toBe(true);
  });

  /**
   * A curbstone has no finance desk, no plan desk and no bays, so three of the
   * five tiles would be a permanent row of zeroes.
   */
  it('leaves the lines a curbstone cannot run empty', () => {
    const s = tradingFor(3, 77);
    const totals = emptyWeekLines();
    for (const w of s.weeks) {
      if (!w.lines) continue;
      for (const id of BOOK_LINES) totals[id].profit += w.lines[id].profit;
    }
    expect(lineActive(totals.plans)).toBe(false);
    expect(lineActive(totals.shop)).toBe(false);
    expect(lineActive(totals.metal)).toBe(true);
    expect(lineActive(totals.overhead)).toBe(true);
  });
});

/**
 * THE SPLIT IS BY DEAL TYPE. Metal is the cash car business; paper is the
 * finance business whole — down payments and collections in, the cars it
 * financed out, the commission its deals paid and the repossessions it worked.
 *
 * These are direction tests, and they exist because the reconciliation test
 * CANNOT catch a mislabel: the five lines sum to the same lifetime profit
 * whichever tile an entry lands on, so a financed car booked against metal
 * keeps every total green and quietly redraws both tiles into the old
 * asset-class split. Each one pins a delta to a line, to the dollar.
 */
describe('the split is by deal type', () => {
  /** A small lot with one listed car and a buyer standing at it. */
  function dealReady(seed = 2024): GameState {
    const s = cloneState(createInitialState(seed, 0));
    s.stage = 'smallUsed';
    s.cash = 100_000;
    s.listings = [];
    const car = generateCar(s, s.rng, getModel('civet'), s.t);
    car.costBasis = 6_000;
    s.cars.push(car);
    listCar(s, car);
    s.prospects.push(generateProspect(s, s.rng, car, 0, haggleSkillFor(s), s.t));
    return s;
  }

  it('books a financed car against the book, whole, and touches metal not at all', () => {
    const s = dealReady();
    const prospect = s.prospects[0];
    const basis = s.cars[0].costBasis;
    const before = cloneWeekLines(s.weekLines);

    expect(acceptFinance(s, prospect.id, 'player')).toBe(true);

    expect(s.weekLines.metal.revenue - before.metal.revenue).toBe(0);
    expect(s.weekLines.metal.profit - before.metal.profit).toBe(0);
    expect(s.weekLines.paper.revenue - before.paper.revenue).toBe(prospect.downPayment);
    expect(s.weekLines.paper.profit - before.paper.profit).toBeCloseTo(
      prospect.downPayment - basis,
      6,
    );
  });

  it("charges the desk's cut on a financed deal to the book, not the cars", () => {
    const s = dealReady(2025);
    const prospect = s.prospects[0];
    const basis = s.cars[0].costBasis;
    const before = cloneWeekLines(s.weekLines);

    expect(acceptFinance(s, prospect.id, 'desk')).toBe(true);

    // The window price is 1.5x retail here against a basis under wholesale, so
    // the deal has real profit at signing and the cut is real money.
    const cut = s.stats.commissionPaid;
    expect(cut).toBeGreaterThan(0);
    expect(s.weekLines.metal.profit - before.metal.profit).toBe(0);
    expect(s.weekLines.paper.profit - before.paper.profit).toBeCloseTo(
      prospect.downPayment - basis - cut,
      6,
    );
  });

  /**
   * A repossession returns the unit to the book's line: paper expensed the whole
   * basis at signing, so what the tow truck brings back is the paper desk's
   * income in kind — and from there the car is ordinary stock, priced into metal
   * through its carrying basis. Booked to metal instead, the paper tile would
   * understate the finance business by the carrying value of every car it ever
   * recovered, and metal would be credited for cars it never paid for.
   *
   * `missChance` caps at 0.95, so the default cannot be forced on one tick; the
   * loop walks week to week until it lands, snapshotting just before each due
   * beat. The note is due mid-week on purpose — the bill beat resets the running
   * lines at the week boundary, and a snapshot straddling it would measure
   * nothing.
   */
  it('returns a repossessed car through the book, priced at what is left in it', () => {
    let s = cloneState(createInitialState(31, 0));
    s.stage = 'smallUsed';
    s.cash = 60_000;
    s.listings = [];

    const car = generateCar(s, s.rng, getModel('civet'), s.t);
    car.status = 'sold';
    car.costBasis = 9_000;
    s.cars.push(car);

    const note: Note = {
      id: 'note_repo',
      carId: car.id,
      carLabel: 'Test Civet',
      customerName: 'About To Default',
      customerTier: 'D',
      originalPrincipal: 8_000,
      downPayment: 2_500,
      principal: 7_200,
      apr: 0.289,
      paymentAmount: 380,
      paymentsTotal: 24,
      paymentsRemaining: 18,
      // Mid-week, clear of the bill beat that resets the running lines.
      nextDueAt: s.t + MS_PER_GAME_WEEK / 2,
      missedPayments: repoThreshold(s) - 1,
      collected: 1_900,
      status: 'delinquent',
      openedAt: 0,
    };
    s.notes.push(note);

    // Walk the weekly beats until the default lands (delinquent D-tier misses
    // ~half the time), measuring only the tick the payment falls due on.
    let deltas: { metal: number; paper: number; paperRevenue: number } | null = null;
    let fee = 0;
    for (let i = 0; i < 40 && s.stats.reposCompleted === 0; i++) {
      const due = s.notes.find((n) => n.id === 'note_repo')!.nextDueAt;
      s = advance(s, due - s.t - 1_000);
      const before = cloneWeekLines(s.weekLines);
      fee = repoFee(s, s.cars.find((c) => c.id === car.id));
      s = advance(s, 2_000);
      if (s.stats.reposCompleted > 0) {
        deltas = {
          metal: s.weekLines.metal.profit - before.metal.profit,
          paper: s.weekLines.paper.profit - before.paper.profit,
          paperRevenue: s.weekLines.paper.revenue - before.paper.revenue,
        };
      }
    }

    expect(s.stats.reposCompleted).toBe(1);
    const recovered = s.cars.find((c) => c.id === car.id)!;
    expect(recovered.status).toBe('ready');

    // The write-back landed on paper — carrying value in, recovery fee out —
    // and metal did not move: the car re-enters the cash business only through
    // the basis its eventual resale will be priced against.
    expect(deltas!.metal).toBe(0);
    expect(deltas!.paper).toBeCloseTo(recovered.costBasis - fee, 0);
    // A repossession is not revenue; nobody paid for anything.
    expect(deltas!.paperRevenue).toBe(0);
  });
});
