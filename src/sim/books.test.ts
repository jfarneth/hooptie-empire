import { MS_PER_GAME_WEEK } from './balance';
import { BALANCE } from './balance';
import {
  WEEKS_IN_VIEW,
  lastWeek,
  marginTrend,
  recentWeeks,
  weekMargin,
  weekSoFar,
} from './books';
import { sellToWholesaler, setCash, takeLoan } from './actions';
import { advance, cloneState, createInitialState } from './engine';
import type { GameState, WeekRecord } from './types';

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
  return { endedAt, revenue, profit };
}

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
});
