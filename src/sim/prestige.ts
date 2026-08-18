import { BALANCE } from './balance';
// Function-level circular import with empire.ts (it reads `ownsProperty` from
// here). Safe: both modules export only functions and neither touches the
// other at module-init time.
import { selloffValue } from './empire';
import { wholesaleValue } from './economy';
import { getStage, typicalCarPrice } from './stages';
import { weeklyPayment } from './economy';
import type { GameState, Loan, StageId } from './types';

/**
 * Retirement — selling the whole operation — and the shark who lends against it.
 *
 * Pure arithmetic, no mutation: `actions.ts` owns the retire and borrow actions,
 * the confirmation screens render what these functions return, and NOTHING in
 * the UI computes any of it itself. Same rule as `stageMovePreview`, for the
 * same reason: the confirmation must never promise a number the action does not
 * pay.
 *
 * The design in three sentences. Retirement is allowed from any store at any
 * moment, because it is the game's ultimate escape hatch — a dead run with a
 * shark at the door can always be sold for whatever it is worth, even nothing —
 * and it mints NO prestige: points come from buying the land under your stores
 * (`buyProperty`), which is the endgame the money is for. The points buy a
 * permanent buy-side edge — every ask, auction or invoice, a little cheaper —
 * because the fiction is that a dealer who owns the ground they trade from
 * knows where the bodies are buried.
 */

/**
 * The permanent buy-side discount this career has earned, as a share of every
 * ask price. Applied where listings are priced (`engine.ts`), capped so a long
 * career bends the curve rather than breaking it.
 */
export function prestigeEdge(state: Pick<GameState, 'prestige'>): number {
  const p = BALANCE.prestige;
  return Math.min(p.edgeCap, state.prestige.points * p.edgePerPoint);
}

/** Whether this career holds the deed to a store's land. */
export function ownsProperty(state: Pick<GameState, 'properties'>, stage: StageId): boolean {
  return state.properties.some((p) => p.stage === stage);
}

/** Everything the career's deeds cost, at the prices actually paid. */
export function propertyHolding(state: Pick<GameState, 'properties'>): number {
  return state.properties.reduce((sum, p) => sum + p.price, 0);
}

export interface PropertyPreview {
  /** What the land under this store costs today. */
  cost: number;
  /** Points a purchase would mint — zero if this stage has ever minted before. */
  points: number;
  owned: boolean;
  affordable: boolean;
  /** The rent line that dies with the purchase. What the deed is worth weekly. */
  rentPerWeek: number;
  /** The edge after the purchase, for the confirmation to show. */
  edgeAfter: number;
}

/**
 * What buying the land under the CURRENT store means. The one place it is
 * priced — the confirmation renders this and `buyProperty` pays it, the same
 * contract `stageMovePreview` and `retirementPreview` honour.
 */
export function propertyPreview(state: GameState): PropertyPreview {
  const stage = getStage(state.stage);
  const owned = ownsProperty(state, state.stage);
  const minted = state.prestige.propertyStages.includes(state.stage);
  const points = owned || minted ? 0 : stage.propertyPoints;
  return {
    cost: stage.propertyCost,
    points,
    owned,
    affordable: !owned && state.cash >= stage.propertyCost,
    rentPerWeek: stage.rentPerWeek,
    edgeAfter: Math.min(
      BALANCE.prestige.edgeCap,
      (state.prestige.points + points) * BALANCE.prestige.edgePerPoint,
    ),
  };
}

export interface RetirementPreview {
  /** Cash on hand. Can be negative — the shark's payments dig below zero. */
  cash: number;
  /** The lot, at the forced-sale price. A retiring dealer is a forced seller. */
  lotValue: number;
  /** Cars that make up that figure. */
  lotCars: number;
  /** The book, sold to a note buyer at a discount on outstanding principal. */
  bookValue: number;
  bookNotes: number;
  /** The deeds, sold at what was paid for them. Land holds its value; it is
   *  the one asset a retiring dealer is not forced to discount. */
  propertyValue: number;
  propertyCount: number;
  /** Kept stores, sold to their managers at the standing goodwill price. */
  keptValue: number;
  keptCount: number;
  /** Everything above, before the shark is paid. */
  gross: number;
  /** What the shark is owed. Settled off the top; he does not negotiate. */
  debt: number;
  /** What hits the scoreboard. Never negative. */
  net: number;
  /**
   * Always zero now, and kept in the shape so the record stays honest: points
   * mint when property is BOUGHT, not when the empire is sold. Retirement is
   * the reset and the escape hatch; it stopped being the mint because a number
   * you earn by quitting is a number that argues against playing.
   */
  points: number;
  /** The edge after this retirement — unchanged, since retiring mints nothing. */
  edgeAfter: number;
}

/** What the shark is owed in full: every remaining payment, vig included. */
export function loanBalance(loan: Loan | null): number {
  return loan ? loan.paymentAmount * loan.paymentsRemaining : 0;
}

/**
 * What retiring right now is worth. The one place this is computed —
 * `retire()` pays exactly this and the confirmation shows exactly this.
 */
export function retirementPreview(state: GameState): RetirementPreview {
  const onLot = state.cars.filter((c) => c.status !== 'sold');
  // The wholesaler's price for a lot that must go today, same rate as a stage
  // move: a buyer of the whole dealership is not paying retail for the stock.
  const lotValue = onLot.reduce(
    (sum, car) => sum + Math.round(wholesaleValue(car) * BALANCE.forcedSaleRate),
    0,
  );

  const openNotes = state.notes.filter((n) => n.status !== 'paid' && n.status !== 'defaulted');
  // A note buyer pays cents on the dollar for BHPH paper, and he is right to.
  const bookValue = Math.round(
    openNotes.reduce((sum, n) => sum + n.principal, 0) * BALANCE.prestige.notesSaleRate,
  );

  const cash = Math.round(state.cash);
  const debt = loanBalance(state.loan);
  const propertyValue = propertyHolding(state);
  const keptValue = state.empire.reduce((sum, k) => sum + selloffValue(k.stage), 0);
  const gross = cash + lotValue + bookValue + propertyValue + keptValue;
  const net = Math.max(0, gross - debt);

  return {
    cash,
    lotValue,
    lotCars: onLot.length,
    bookValue,
    bookNotes: openNotes.length,
    propertyValue,
    propertyCount: state.properties.length,
    keptValue,
    keptCount: state.empire.length,
    gross,
    debt,
    net,
    points: 0,
    edgeAfter: prestigeEdge(state),
  };
}

export interface SharkOffer {
  principal: number;
  apr: number;
  termWeeks: number;
  weeklyPayment: number;
  /** Everything he will collect over the term. The vig, spelled out. */
  totalRepay: number;
}

/**
 * What the shark is offering at this store. Sized in cars under the hood —
 * enough to genuinely restart a dead lot — but presented as a flat figure,
 * rounded to something a man like this would actually say out loud. Take it or
 * leave it.
 */
export function sharkOffer(state: Pick<GameState, 'stage'>): SharkOffer {
  const raw = typicalCarPrice(getStage(state.stage)) * BALANCE.loan.carsOffered;
  // Rounded DOWN to a chunky figure. He does not do odd numbers, and he does
  // not round in your favour.
  const step = raw >= 200_000 ? 25_000 : raw >= 20_000 ? 5_000 : 1_000;
  const principal = Math.max(step, Math.floor(raw / step) * step);
  const payment = weeklyPayment(principal, BALANCE.loan.apr, BALANCE.loan.termWeeks);

  return {
    principal,
    apr: BALANCE.loan.apr,
    termWeeks: BALANCE.loan.termWeeks,
    weeklyPayment: payment,
    totalRepay: payment * BALANCE.loan.termWeeks,
  };
}
