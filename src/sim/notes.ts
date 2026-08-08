import { BALANCE, MS_PER_GAME_WEEK } from './balance';
import { weeklyPayment } from './economy';
import { mintId } from './ids';
import { collectionsCapacity } from './upgrades';
import type { CreditTier, GameState, Millis, Note, Prospect } from './types';

/**
 * The note lifecycle. This is the mechanical heart of the game.
 *
 * A performing note collects far more than a cash sale would have. A defaulting
 * note hands back the car plus every dollar already collected, which is often
 * *also* better than a cash sale. The player's real job is not avoiding
 * defaults — it is knowing which outcome they are underwriting for.
 */

export function openNote(
  state: Pick<GameState, 'nextId'>,
  prospect: Prospect,
  carLabel: string,
  now: Millis,
): Note {
  const { amountFinanced, apr, weeklyPayment: payment, weeks } = prospect.financeTerms;
  return {
    id: mintId(state, 'note'),
    carId: prospect.carId,
    carLabel,
    customerName: prospect.name,
    customerTier: prospect.tier,
    originalPrincipal: amountFinanced,
    principal: amountFinanced,
    apr,
    paymentAmount: payment,
    paymentsTotal: weeks,
    paymentsRemaining: weeks,
    nextDueAt: now + MS_PER_GAME_WEEK,
    missedPayments: 0,
    collected: 0,
    status: 'current',
    openedAt: now,
  };
}

/** Notes the collections desk is currently responsible for. */
export function activeNotes(notes: Note[]): Note[] {
  return notes.filter((n) => n.status === 'current' || n.status === 'delinquent');
}

/**
 * Contracts the desk will still take. Zero means the finance desk is closed
 * until something on the book pays off or goes bad.
 *
 * This is a hard limit, not a target. The number was already on the HUD and on
 * the ledger; it just wasn't enforced, so a player who read it as a limit was
 * wrong and a player who ignored it was rewarded. Staffing the desk is now what
 * buys the right to write more paper.
 *
 * Clamped at zero rather than allowed to go negative, because a save from before
 * the cap can legitimately be sitting over the line. Those books shrink back
 * under it by attrition; nothing is torn up.
 */
export function bookRoom(state: GameState): number {
  return Math.max(0, collectionsCapacity(state) - activeNotes(state.notes).length);
}

/** True when the finance desk can write another contract right now. */
export function canWriteNote(state: GameState): boolean {
  return bookRoom(state) > 0;
}

/**
 * Multiplier applied to every borrower's miss chance once the portfolio outgrows
 * the collections desk. Growing the book without staffing it is a real and
 * punishing mistake, which is the point.
 *
 * With the cap enforced this only bites on a book that was already over the line
 * — a save written before the cap, or one that has since been carried across a
 * shrinking desk. It stays because degrading is the right way to meet that
 * state; the alternative is a rule that only applies to new games.
 */
export function overCapacityFactor(activeCount: number, capacity: number): number {
  if (activeCount <= capacity || capacity <= 0) return 1;
  const overage = (activeCount - capacity) / capacity;
  return 1 + overage * BALANCE.overCapacityMissPenalty;
}

/** Odds this borrower misses the payment that is due right now. */
export function missChance(note: Note, capacityFactor: number): number {
  const base = BALANCE.creditTiers[note.customerTier].missChance;
  const spiral = note.missedPayments > 0 ? BALANCE.delinquencyMissMultiplier : 1;
  return Math.min(0.95, base * spiral * capacityFactor);
}

export interface PaymentResult {
  paid: boolean;
  /** Cash collected this payment (0 when missed). */
  amount: number;
  /** True when this payment retired the contract. */
  closed: boolean;
  /** True when the missed payments crossed the repo threshold. */
  defaulted: boolean;
}

/**
 * Apply the payment that is due. Mutates the note and advances `nextDueAt` by a
 * game week whether or not the borrower paid — a missed week still passes.
 *
 * `repoAfter` is the player's repo trigger; it defaults to the house number so
 * callers that have no state to hand (the amortization tests, mostly) still
 * describe the shipped rule.
 */
export function applyDuePayment(
  note: Note,
  made: boolean,
  repoAfter: number = BALANCE.repoAfterMissedPayments,
): PaymentResult {
  note.nextDueAt += MS_PER_GAME_WEEK;

  if (!made) {
    note.missedPayments += 1;
    note.status = 'delinquent';
    const defaulted = note.missedPayments >= Math.max(1, repoAfter);
    if (defaulted) note.status = 'defaulted';
    return { paid: false, amount: 0, closed: false, defaulted };
  }

  // Simple interest on the outstanding balance, level payment against it.
  const weeklyRate = note.apr / 52;
  const interest = note.principal * weeklyRate;
  const payment = Math.min(note.paymentAmount, note.principal + interest);
  const towardPrincipal = payment - interest;

  note.principal = Math.max(0, note.principal - towardPrincipal);
  note.collected = Math.round((note.collected + payment) * 100) / 100;
  note.paymentsRemaining -= 1;
  note.missedPayments = 0;
  note.status = 'current';

  const closed = note.paymentsRemaining <= 0 || note.principal <= 0.5;
  if (closed) {
    note.status = 'paid';
    note.principal = 0;
    note.paymentsRemaining = 0;
  }

  return { paid: true, amount: payment, closed, defaulted: false };
}

/** What the player would collect if this note ran to term from here. */
export function remainingScheduled(note: Note): number {
  return Math.round(note.paymentAmount * note.paymentsRemaining);
}

/** Build the finance package a given credit tier will accept on a given price. */
export function buildTerms(
  tier: CreditTier,
  price: number,
  weeks: number,
  downJitter: number,
): Prospect['financeTerms'] {
  const cfg = BALANCE.creditTiers[tier];
  const downShare = Math.max(0.05, cfg.downShare * downJitter);
  const down = Math.round(price * downShare);
  const amountFinanced = Math.max(0, price - down);
  return {
    amountFinanced,
    apr: cfg.apr,
    weeklyPayment: weeklyPayment(amountFinanced, cfg.apr, weeks),
    weeks,
  };
}
