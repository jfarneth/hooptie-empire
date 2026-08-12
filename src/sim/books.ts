import { BALANCE } from './balance';
import type { GameState, WeekRecord } from './types';

/**
 * The weekly books.
 *
 * Cash is a level and profit is a rate, and the HUD only ever showed the level.
 * That is a genuine blind spot rather than a missing feature: a week that bought
 * six cars and sold none reads as a catastrophe on the cash line and is just
 * inventory, and a week that sold the lot down at a loss reads as a triumph. The
 * only way to tell those apart is to match what came in against what it cost,
 * which is what a closed week is.
 *
 * Everything here is a pure read over `state.weeks`. The filing is done by
 * `closeTheWeek` on the bill beat — see engine.ts — so nothing in this module
 * can disagree with the ledger it is summarising.
 */

/**
 * Net margin on a week: what was left, over what came in.
 *
 * `null` on a week with no revenue at all, which is a real state — a lot with
 * nothing listed still pays rent — and one that has no percentage. Reporting it
 * as -100%, or as 0%, would both be inventing a denominator.
 */
export function weekMargin(week: WeekRecord | null | undefined): number | null {
  if (!week || week.revenue <= 0) return null;
  return week.profit / week.revenue;
}

/** The most recent CLOSED week, or null before the first bill has fallen due. */
export function lastWeek(state: Pick<GameState, 'weeks'>): WeekRecord | null {
  const weeks = state.weeks ?? [];
  return weeks.length > 0 ? weeks[weeks.length - 1] : null;
}

/**
 * The last `count` closed weeks, oldest first.
 *
 * Fewer than asked for is normal and is left as-is rather than padded: a chart
 * that padded a young business with flat zeroes would be drawing a trend that
 * did not happen.
 */
export function recentWeeks(state: Pick<GameState, 'weeks'>, count: number): WeekRecord[] {
  const weeks = state.weeks ?? [];
  return weeks.slice(Math.max(0, weeks.length - count));
}

/**
 * The week currently being traded, as far as it has got.
 *
 * Deliberately NOT what the headline reports — "last week's performance" means
 * a week that finished, and a Tuesday-morning margin computed over four sales
 * swings wildly enough to be noise. It earns its place in the popup, where it
 * sits after the closed weeks as an explicit part-week.
 */
export function weekSoFar(state: Pick<GameState, 'weeks' | 'weekRevenue' | 'weekProfitAt' | 'stats' | 't'>): WeekRecord {
  return {
    endedAt: state.t,
    revenue: Math.round(state.weekRevenue ?? 0),
    profit: Math.round(state.stats.lifetimeProfit - (state.weekProfitAt ?? 0)),
  };
}

/**
 * How the trend is going: the last week against the average of the ones before
 * it in view.
 *
 * Returns `null` when there is not enough history to say anything, which is the
 * honest answer for the first fortnight rather than an arrow pointing at noise.
 */
export function marginTrend(state: Pick<GameState, 'weeks'>, count = 8): number | null {
  const weeks = recentWeeks(state, count).filter((w) => w.revenue > 0);
  if (weeks.length < 3) return null;

  const latest = weekMargin(weeks[weeks.length - 1]);
  if (latest === null) return null;

  const earlier = weeks.slice(0, -1);
  const mean = earlier.reduce((n, w) => n + (weekMargin(w) ?? 0), 0) / earlier.length;
  return latest - mean;
}

/** How many weeks the trend readout shows. The save keeps more; see `weekHistory`. */
export const WEEKS_IN_VIEW = 8;

/** Sanity: the view can never ask for more than the save keeps. */
export const WEEKS_KEPT = BALANCE.weekHistory;
