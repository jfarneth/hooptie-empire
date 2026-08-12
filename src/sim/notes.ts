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
    downPayment: prospect.downPayment,
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
  return Math.min(
    BALANCE.overCapacityMissPenaltyCap,
    1 + overage * BALANCE.overCapacityMissPenalty,
  );
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

/**
 * WHAT A REPOSSESSED CAR IS STILL WORTH TO THE BUSINESS, and therefore what it
 * goes back on the books at.
 *
 * A car that comes back is not the car that left. It left carrying what it cost
 * to buy and recondition; it comes back having already returned a down payment
 * and however many weekly payments the customer made, and having cost a recovery
 * fee to get. The carrying value is what is left of the investment:
 *
 *     purchase + recon + recovery fee − down payment − payments collected
 *
 * Using the ORIGINAL basis instead — which is what this did until it was found
 * in playtesting — is wrong twice over, and the second way is worse than the
 * first. It makes the deal sheet's margin read against money the customer has
 * already handed over, so a car that has paid for itself twice still looks like
 * a thin deal. And because `acceptFinance` already expensed the whole basis
 * against `lifetimeProfit` at signing, charging it again on the resale
 * double-counts it: measured over a 3h run with 25 repossessions, the books
 * understated profit by $200,678, about $8k a repo.
 *
 * FLOORED AT ZERO, and that floor is load-bearing rather than defensive. A note
 * that collected more than the car cost genuinely leaves a negative investment,
 * and a negative basis would pay the player floorplan interest on a car they
 * are holding. Zero says the true thing — the business has nothing left in this
 * unit, and every dollar it now sells for is profit.
 */
export function repoCarryingValue(
  costBasis: number,
  fee: number,
  note: Pick<Note, 'downPayment' | 'collected'>,
): number {
  const returned = (note.downPayment ?? 0) + (note.collected ?? 0);
  return Math.max(0, Math.round(costBasis + fee - returned));
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

/**
 * `repoAfter` widens the chain rather than being a constant, because the player
 * sets it. The deal sheet quotes this number as exact, so it has to be the
 * player's rule and not the house default the moment those differ.
 */
export function expectedCollections(
  weeks: number,
  paymentAmount: number,
  baseMissChance: number,
  repoAfter: number = BALANCE.repoAfterMissedPayments,
): { expectedCollected: number; defaultProbability: number } {
  const threshold = Math.max(1, Math.round(repoAfter));
  const pFresh = Math.min(0.95, baseMissChance);
  const pBehind = Math.min(0.95, baseMissChance * BALANCE.delinquencyMissMultiplier);

  // states[k] = probability of being alive with k consecutive missed payments.
  // The chain is `threshold` wide: the miss that takes k to `threshold` is the
  // one that takes the car back, so there is no live state at that index.
  let states = new Array<number>(threshold).fill(0);
  states[0] = 1;
  let dead = 0;
  let expectedPayments = 0;

  for (let week = 0; week < weeks; week++) {
    const next = new Array<number>(threshold).fill(0);
    for (let k = 0; k < threshold; k++) {
      const mass = states[k];
      if (mass === 0) continue;
      const p = k === 0 ? pFresh : pBehind;
      // Paid: collect and reset to zero consecutive misses.
      next[0] += mass * (1 - p);
      expectedPayments += mass * (1 - p);
      // Missed: advance, or die at the repo threshold.
      if (k + 1 >= threshold) dead += mass * p;
      else next[k + 1] += mass * p;
    }
    states = next;
  }

  return {
    expectedCollected: Math.round(expectedPayments * paymentAmount),
    defaultProbability: dead,
  };
}
