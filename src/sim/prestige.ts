import { BALANCE } from './balance';
import { wholesaleValue } from './economy';
import { getStage, typicalCarPrice } from './stages';
import { weeklyPayment } from './economy';
import type { GameState, Loan } from './types';

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
 * shark at the door can always be sold for whatever it is worth, even nothing.
 * Points are linear in the net proceeds (one per `pointDollars`), so a deep run
 * is the way to earn and an early bail earns roughly zero, which keeps the
 * hatch from being a farm: the reset is its own reward. The points buy a
 * permanent buy-side edge — every ask, auction or invoice, a little cheaper —
 * because the fiction is that a dealer on their third empire knows where the
 * bodies are buried.
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
  /** Everything above, before the shark is paid. */
  gross: number;
  /** What the shark is owed. Settled off the top; he does not negotiate. */
  debt: number;
  /** What hits the scoreboard. Never negative. */
  net: number;
  /** Points this retirement would earn. */
  points: number;
  /** The edge after this retirement, for the confirmation to show. */
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
  const gross = cash + lotValue + bookValue;
  const net = Math.max(0, gross - debt);
  const points = Math.floor(net / BALANCE.prestige.pointDollars);

  return {
    cash,
    lotValue,
    lotCars: onLot.length,
    bookValue,
    bookNotes: openNotes.length,
    gross,
    debt,
    net,
    points,
    edgeAfter: Math.min(
      BALANCE.prestige.edgeCap,
      (state.prestige.points + points) * BALANCE.prestige.edgePerPoint,
    ),
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
