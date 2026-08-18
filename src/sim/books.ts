import { BALANCE } from './balance';
import type { BookLine, GameState, LineResult, WeekRecord } from './types';

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
export function weekSoFar(
  state: Pick<GameState, 'weeks' | 'weekRevenue' | 'weekLines' | 'weekProfitAt' | 'stats' | 't'>,
): WeekRecord {
  return {
    endedAt: state.t,
    revenue: Math.round(state.weekRevenue ?? 0),
    profit: Math.round(state.stats.lifetimeProfit - (state.weekProfitAt ?? 0)),
    lines: state.weekLines ?? null,
  };
}

/**
 * The six business lines, in the order they read on screen: the four things
 * the business sells, the group's cheques, then the cost of having a business
 * at all.
 */
export const BOOK_LINES: BookLine[] = ['metal', 'paper', 'plans', 'shop', 'empire', 'overhead'];

/**
 * What each line is called, and what is in it.
 *
 * THE SPLIT IS BY DEAL TYPE: metal is the cash car business, paper is the
 * finance business whole — down payments and collections in, the cars it
 * financed and the repossessions it worked out. Each line is a complete P&L a
 * player could act on. It used to split by asset class instead (every car's
 * cost on metal, paper as pure collections), which made metal read as a huge
 * loss and paper as a 99% margin at any store that wrote paper — internally
 * consistent, and no use to anybody deciding anything.
 *
 * The `note` is not decoration — every one of these lines has something in it
 * the player would otherwise have to guess at: floorplan is charged to the
 * cars, the technicians to the bays, and a financed car's whole cost lands on
 * the book the day it is signed.
 */
export const BOOK_LINE_COPY: Record<BookLine, { name: string; note: string }> = {
  metal: { name: 'Metal', note: 'cash sales, less what those cars cost, floorplan and commission' },
  paper: {
    name: 'The book',
    note: 'down payments and weekly collections, less the cars financed out and the cost of repossessions',
  },
  plans: { name: 'Cover', note: 'service plans sold, less the claims paid on them' },
  shop: { name: 'Service bay', note: 'labour billed, less the technicians who billed it' },
  empire: {
    name: 'The group',
    note: 'cheques from stores you left running, after their own costs and rent',
  },
  overhead: { name: 'Overhead', note: 'rent, the payroll and the shark' },
};

/**
 * A line's own margin, on the same rule `weekMargin` follows: `null` where there
 * is no denominator.
 *
 * Overhead never has one — it takes nothing and only spends — and neither does a
 * quiet week on any other line. Reporting either as -100% would be inventing a
 * denominator, which is the same mistake in a smaller box.
 */
export function lineMargin(line: LineResult | undefined): number | null {
  if (!line || line.revenue <= 0) return null;
  return line.profit / line.revenue;
}

/**
 * True when this line has ever done anything in the week being shown.
 *
 * A curbstone has no finance desk, no plan desk and no bays, so three of the
 * five tiles would be a permanent row of zeroes — the same argument that keeps
 * the admin tab out of a shipped build and an empty promotion tray off the
 * screen. Read off the WEEK rather than off the stage on purpose: a business
 * that has just walked down the ladder still owes claims on cover it sold
 * upstairs, and that money is real whether or not the store can sell any more
 * of it.
 */
export function lineActive(line: LineResult | undefined): boolean {
  return !!line && (line.revenue !== 0 || line.profit !== 0);
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
