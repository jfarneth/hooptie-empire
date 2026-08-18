import { BALANCE, MS_PER_GAME_DAY } from './balance';
import { carLabel } from './cars';
import { getModel } from './models';
import { retailValue, wholesaleValue } from './economy';
import type { Car, CarStatus, GameState, Millis } from './types';

/**
 * The ageing report: what is on the lot, how long it has been there, and what
 * each unit has cost.
 *
 * Every figure here comes off the per-car ledger the engine writes — see the
 * note on `purchasePrice` in types.ts — and nothing is derived from age times a
 * live constant. That distinction is the whole reason the fields exist: a
 * carrying cost recomputed on read would silently restate money the business
 * has already paid the moment anybody moved the floorplan rate, which is
 * exactly the class of lie the stamped `endsAt` on a promotion exists to avoid.
 *
 * Pure, like books.ts, and for the same reason: the screen that shows this and
 * the harness that measures it must not be able to disagree about it.
 */

/**
 * Past this, a car is old stock and the game says so in a different colour.
 *
 * One definition, because two screens use it. Cars are listed for about a week
 * at every rung by design (`trafficPerCar`), so three weeks is a car that has
 * had three times the normal run at finding a buyer and has not found one —
 * that is a decision, not a wait.
 */
export const STALE_DAYS = 21;

export type InventorySort = 'age' | 'money' | 'margin' | 'carrying';

/** One car on the lot, with its whole cost history laid out. */
export interface InventoryLine {
  car: Car;
  /** "Halvorsen Pup · 206k" — the name and the odometer, as everything else says it. */
  label: string;
  /** Just the marque and model, for somewhere too narrow for the odometer. */
  modelName: string;
  status: CarStatus;
  /** Sim ms since you bought it. */
  ageMs: Millis;
  /** Days since you bought it. */
  daysHeld: number;
  /** Days since it went on sale, or null if it never has. */
  daysListed: number | null;

  /** What you handed the seller. */
  purchase: number;
  /** What the transporter cost. */
  freight: number;
  /** Everything spent reconditioning it. */
  recon: number;
  /** Floorplan interest charged against it so far. */
  carrying: number;
  /** Recovery fees, if it has been round the block. */
  recovery: number;
  /** Cash it has already given back — down payments and collections. */
  returned: number;

  /** Every dollar this car has taken out of the till, gross. */
  sunk: number;
  /** ...and net of everything a customer has handed back. THE number. */
  allIn: number;
  /**
   * The accounting basis: what `lifetimeProfit` will be charged when it sells.
   *
   * Deliberately not the same as `allIn`. Floorplan interest is an operating
   * expense charged the week it accrues, so it is money this car cost and is
   * NOT part of what the books will subtract at the sale — the report shows
   * both because a player deciding whether to dump a car wants the first, and a
   * player reconciling against the ledger wants the second.
   */
  basis: number;

  /** What it would fetch at the sticker, or at cash retail if it is not up yet. */
  exit: number;
  retail: number;
  /** True if `exit` is the current ask rather than a retail estimate. */
  listed: boolean;
  /** What the wholesaler would hand over today. The floor under the decision. */
  dumpValue: number;

  /** `exit − allIn`. What is left if it sells for what it is asking. */
  profit: number;
  /** That, over the exit price. Null on a car with no price at all. */
  margin: number | null;
  /** What another week on the lot will cost in floorplan interest. */
  weeklyCarry: number;
}

export interface InventoryTotals {
  units: number;
  purchase: number;
  freight: number;
  recon: number;
  carrying: number;
  recovery: number;
  returned: number;
  sunk: number;
  allIn: number;
  basis: number;
  /** What the whole lot would fetch at its current asks. */
  exit: number;
  /** What the whole lot would fetch from the wholesaler this afternoon. */
  dumpValue: number;
  /** Next week's floorplan line, in advance. */
  weeklyCarry: number;
  /** Longest-held unit, in days. */
  oldestDays: number;
  /** p50 dwell — the same figure `npm run sim` prints, on the player's screen. */
  medianDays: number;
  /** Units held past `STALE_DAYS`. */
  staleUnits: number;
  /** Units that would lose money at their own asking price. */
  underWaterUnits: number;
}

/** Everything on the lot, in whatever order was asked for. */
export function inventoryReport(state: GameState, sort: InventorySort = 'age'): InventoryLine[] {
  const lines = state.cars.filter((c) => c.status !== 'sold').map((car) => line(state, car));
  return sortLines(lines, sort);
}

/**
 * One car's line, on its own.
 *
 * Exported so the car sheet can quote the same figures the report does. Two
 * screens describing one car's cost from two derivations is exactly how the
 * "priced under market, it will move fast" bug got onto a sheet that also said
 * "42 days on the lot" — there is one derivation and this is it.
 */
export function inventoryLine(state: GameState, car: Car): InventoryLine {
  return line(state, car);
}

function line(state: GameState, car: Car): InventoryLine {
  const purchase = car.purchasePrice ?? 0;
  const freight = car.freightPaid ?? 0;
  const recon = car.reconSpend ?? 0;
  const carrying = car.carryingCost ?? 0;
  const recovery = car.recoveryCost ?? 0;
  const returned = car.returned ?? 0;

  const sunk = purchase + freight + recon + carrying + recovery;
  const allIn = sunk - returned;

  const retail = retailValue(car);
  const listed = car.status === 'listed' && car.askPrice > 0;
  const exit = listed ? car.askPrice : retail;
  const profit = exit - allIn;

  return {
    car,
    label: carLabel(car),
    modelName: getModel(car.modelId).name,
    status: car.status,
    ageMs: state.t - car.acquiredAt,
    daysHeld: (state.t - car.acquiredAt) / MS_PER_GAME_DAY,
    daysListed: car.listedAt === null ? null : (state.t - car.listedAt) / MS_PER_GAME_DAY,

    purchase,
    freight,
    recon,
    carrying,
    recovery,
    returned,

    sunk,
    allIn,
    basis: car.costBasis,

    exit,
    retail,
    listed,
    dumpValue: Math.round(wholesaleValue(car) * BALANCE.forcedSaleRate),

    profit,
    // A car with no value at all has no percentage, same rule `weekMargin`
    // follows: reporting a division by zero as -100% is inventing a denominator.
    margin: exit > 0 ? profit / exit : null,
    weeklyCarry: car.costBasis * BALANCE.expenses.floorplanWeeklyRate,
  };
}

const SORT_LABEL: Record<InventorySort, string> = {
  age: 'Oldest first',
  money: 'Most tied up',
  margin: 'Thinnest first',
  carrying: 'Costliest to keep',
};

/** What each sort is called on the button. Exported so the UI cannot invent a fifth. */
export function sortLabel(sort: InventorySort): string {
  return SORT_LABEL[sort];
}

export const INVENTORY_SORTS = Object.keys(SORT_LABEL) as InventorySort[];

/**
 * Ordering, with a stable tiebreak.
 *
 * The secondary key is always the car's age and then its id, so two identical
 * units do not swap places every time the screen redraws — the lot is a
 * four-times-a-second surface and a list that reshuffles under a finger is
 * unreadable. Same argument `layout.ts` makes about parking by hash rather than
 * filling in order.
 */
function sortLines(lines: InventoryLine[], sort: InventorySort): InventoryLine[] {
  const key = (l: InventoryLine): number => {
    switch (sort) {
      // Oldest first, so the top of the list is always the car most in need of
      // a decision. This is the default because it is the question the report
      // was built to answer.
      case 'age':
        return -l.ageMs;
      case 'money':
        return -l.allIn;
      // Ascending: the worst deal on the lot floats to the top, which is the
      // only way round that is any use. A car with no price sorts last rather
      // than best — it has no margin, not an infinite one.
      case 'margin':
        return l.margin ?? Number.POSITIVE_INFINITY;
      case 'carrying':
        return -l.carrying;
    }
  };

  return [...lines].sort(
    (a, b) =>
      key(a) - key(b) ||
      a.car.acquiredAt - b.car.acquiredAt ||
      (a.car.id < b.car.id ? -1 : a.car.id > b.car.id ? 1 : 0),
  );
}

export function inventoryTotals(lines: InventoryLine[]): InventoryTotals {
  const totals: InventoryTotals = {
    units: lines.length,
    purchase: 0,
    freight: 0,
    recon: 0,
    carrying: 0,
    recovery: 0,
    returned: 0,
    sunk: 0,
    allIn: 0,
    basis: 0,
    exit: 0,
    dumpValue: 0,
    weeklyCarry: 0,
    oldestDays: 0,
    medianDays: 0,
    staleUnits: 0,
    underWaterUnits: 0,
  };

  for (const l of lines) {
    totals.purchase += l.purchase;
    totals.freight += l.freight;
    totals.recon += l.recon;
    totals.carrying += l.carrying;
    totals.recovery += l.recovery;
    totals.returned += l.returned;
    totals.sunk += l.sunk;
    totals.allIn += l.allIn;
    totals.basis += l.basis;
    totals.exit += l.exit;
    totals.dumpValue += l.dumpValue;
    totals.weeklyCarry += l.weeklyCarry;
    if (l.daysHeld > totals.oldestDays) totals.oldestDays = l.daysHeld;
    if (l.daysHeld >= STALE_DAYS) totals.staleUnits += 1;
    if (l.profit < 0) totals.underWaterUnits += 1;
  }

  const days = lines.map((l) => l.daysHeld).sort((a, b) => a - b);
  totals.medianDays = days.length === 0 ? 0 : days[Math.floor(days.length / 2)];

  return totals;
}
