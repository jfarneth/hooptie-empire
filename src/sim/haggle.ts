import { BALANCE } from './balance';
import { clamp } from './economy';
import { chance, normalish, range, type RngState } from './rng';
import type { Negotiation } from './types';

/**
 * Deal negotiation.
 *
 * A walk-up used to be one number and a yes/no. Now they open below your ask and
 * you either take it or push back.
 *
 * The whole thing hangs on a **hidden reservation price** — the most this buyer
 * would actually pay, drawn somewhere between their opening offer and your ask.
 * Acceptance odds fall as your counter climbs toward it and fall off a cliff past
 * it. A plain distance-from-their-offer formula would produce a similar curve,
 * but every buyer would behave identically; a reservation price means some people
 * genuinely have room and some genuinely do not, which is what makes this read as
 * a person rather than a dice roll.
 *
 * NOTE: nothing here knows about cars, asking prices or the game state. It works
 * in abstract (anchor, offer) money so the same model can drive down-payment
 * haggling later without a rewrite.
 */

const CFG = BALANCE.negotiation;

/**
 * How good the person doing the talking is.
 *
 * Plain numbers rather than a GameState, for the same reason everything else
 * here works in abstract money: this module must stay reusable for the
 * down-payment haggle later. `skills.ts` resolves these from the Closing level.
 *
 * Note when each one bites. `roomMean` and `tellJitter` are consumed at open and
 * baked into the buyer, because a reservation price and a tell are things about
 * *them* that were true before you started talking. `walkChanceMult` and
 * `maxCounters` are read live, because those are about how you are handling the
 * conversation right now.
 */
export interface HaggleSkill {
  /** Where the hidden reservation sits between their offer and your ask. */
  roomMean: number;
  /** Odds a tell reads one band off the truth. Lower is a read you can trust. */
  tellJitter: number;
  /** Multiplier on the odds a rejected counter loses them. */
  walkChanceMult: number;
  /** Counters available before they stop talking. */
  maxCounters: number;
  /** Where the sales desk pitches its one standing counter, offer→ask. */
  deskCounterFraction: number;
}

/** The level-1 negotiator: exactly the constants this module used to hard-code. */
export const BASE_HAGGLE_SKILL: HaggleSkill = {
  roomMean: CFG.roomMean,
  tellJitter: 0.3,
  walkChanceMult: 1,
  maxCounters: CFG.maxPlayerCounters,
  deskCounterFraction: CFG.deskCounterFraction,
};

/** Money lands on human numbers, and the increment grows with the price. */
export function roundingIncrement(price: number): number {
  if (price < 10_000) return 100;
  if (price < 30_000) return 500;
  return 1_000;
}

/**
 * Snap a raw price to something a person would actually say out loud.
 * Floored rather than rounded to nearest — people lowball *to* a round number,
 * they do not round up to one.
 */
export function humanizePrice(rng: RngState, price: number, increment: number): number {
  // Both branches floor. Rounding to nearest on the odd path would let an offer
  // land *above* the price it was derived from, which quietly breaks the
  // guarantee that a buyer never bids more than they meant to.
  if (chance(rng, CFG.oddNumberChance)) {
    return Math.max(0, Math.floor(price / 25) * 25);
  }
  return Math.max(0, Math.floor(price / increment) * increment);
}

/**
 * Open a negotiation against `anchor` (your asking price).
 *
 * `overpricing` is ask ÷ market value. Asking well over market invites a harder
 * lowball, which reinforces the same pricing pressure that `prospectRate`
 * already applies to how much traffic an overpriced car gets.
 */
export function openNegotiation(
  rng: RngState,
  anchor: number,
  overpricing: number,
  skill: HaggleSkill,
): Negotiation {
  // Some shoppers simply pay the asking price. This is an explicit roll rather
  // than a tail of the discount curve: left to the curve, reaching full price
  // required an aggression draw so extreme it never actually happened, and the
  // brief is that offers range *from list* down.
  const paysFullPrice = chance(rng, CFG.fullPriceChance);

  // Independent draws, deliberately. If aggression predicted room, the opening
  // offer would leak the answer and countering would become mechanical.
  const aggression = normalish(rng, 0.5, 0.45, 0, 1);
  const room = normalish(rng, skill.roomMean, CFG.roomSpread, 0, 1);

  const push = clamp((overpricing - 1) * CFG.overpricingLowballFactor, 0, CFG.maxOverpricingPush);
  const discount = CFG.maxOpeningDiscount * aggression * (1 + push);

  const increment = roundingIncrement(anchor);
  const raw = anchor * (1 - discount);

  // A buyer whose haggle instinct is smaller than one increment just pays the
  // asking price rather than quibbling over pocket change.
  const offer =
    paysFullPrice || anchor - raw < increment / 2
      ? anchor
      : Math.min(anchor, humanizePrice(rng, raw, increment));

  const reservation = offer + (anchor - offer) * room;

  // Tells correlate with room but are not a readout: adjacent bands overlap, so
  // reading a customer is a skill with a real error rate rather than arithmetic.
  let tellIndex = Math.round(room * (TELLS.length - 1));
  if (chance(rng, skill.tellJitter)) tellIndex += chance(rng, 0.5) ? 1 : -1;
  tellIndex = clamp(tellIndex, 0, TELLS.length - 1);

  return {
    anchor,
    openingOffer: offer,
    currentOffer: offer,
    reservation,
    room,
    aggression,
    countersMade: 0,
    lastCounter: null,
    status: 'open',
    tellIndex,
  };
}

/**
 * Odds this buyer accepts a counter at `counter`.
 *
 * Monotonically non-increasing in `counter` — asking for more can never make
 * them likelier to say yes. There is a test for that.
 */
export function acceptanceChance(neg: Negotiation, counter: number): number {
  if (counter <= neg.currentOffer) return 1;

  const toReservation = neg.reservation - neg.currentOffer;

  if (toReservation > 0 && counter <= neg.reservation) {
    // Inside their room: decays linearly from certain to `acceptanceAtReservation`.
    const x = (counter - neg.currentOffer) / toReservation;
    return 1 - (1 - CFG.acceptanceAtReservation) * x;
  }

  // Past what they meant to spend. People do stretch, but not far.
  const scale = Math.max(1, neg.anchor - neg.currentOffer);
  const over = (counter - neg.reservation) / scale;
  return CFG.acceptanceAtReservation * Math.exp(-CFG.stretchDecay * over);
}

export type CounterOutcome =
  | { kind: 'accepted'; price: number }
  | { kind: 'countered'; offer: number }
  | { kind: 'walked' };

/**
 * Resolve a player counter. Mutates `neg` — callers own a cloned state, the same
 * contract the rest of the engine runs on.
 */
export function resolveCounter(
  rng: RngState,
  neg: Negotiation,
  counter: number,
  skill: HaggleSkill,
): CounterOutcome {
  neg.countersMade += 1;
  neg.lastCounter = counter;

  if (chance(rng, acceptanceChance(neg, counter))) {
    neg.status = 'accepted';
    neg.currentOffer = counter;
    return { kind: 'accepted', price: counter };
  }

  // Out of rounds: they are done talking.
  if (neg.countersMade >= skill.maxCounters) {
    neg.status = 'walked';
    return { kind: 'walked' };
  }

  const scale = Math.max(1, neg.anchor - neg.currentOffer);
  const overreach = Math.max(0, (counter - neg.reservation) / scale);
  const walkChance = clamp(
    (CFG.baseWalkChance + overreach * CFG.walkPerExcess + (neg.countersMade - 1) * CFG.walkPerRound) *
      skill.walkChanceMult,
    0,
    1,
  );

  if (chance(rng, walkChance)) {
    neg.status = 'walked';
    return { kind: 'walked' };
  }

  // They come back up — toward you, but never past what they'd actually pay,
  // and never below what they already offered.
  const ceiling = Math.max(neg.currentOffer, Math.min(counter, neg.reservation));
  const increment = roundingIncrement(neg.anchor);
  const raw = range(rng, neg.currentOffer, ceiling);
  const improved = Math.max(neg.currentOffer, Math.min(ceiling, humanizePrice(rng, raw, increment)));

  neg.currentOffer = improved;
  return { kind: 'countered', offer: improved };
}

/** Counters left before they stop talking. */
export function countersRemaining(neg: Negotiation, skill: HaggleSkill): number {
  return Math.max(0, skill.maxCounters - neg.countersMade);
}

/** Where the sales desk pitches its one standing counter. */
export function deskCounter(neg: Negotiation, skill: HaggleSkill): number {
  const increment = roundingIncrement(neg.anchor);
  const target = neg.currentOffer + (neg.anchor - neg.currentOffer) * skill.deskCounterFraction;
  return Math.max(neg.currentOffer, Math.floor(target / increment) * increment);
}

/**
 * What the buyer is giving away. Correlated with how much room they have, but
 * deliberately noisy — see openNegotiation.
 */
const TELLS: readonly string[] = [
  'Arms folded. Says the number is the number.',
  'Keeps glancing at the lot across the street.',
  'Walked around it twice before saying anything.',
  'Already asked how soon they could drive it home.',
  'Mentioned their kid needs something by Friday.',
];

export function tellFor(neg: Negotiation): string {
  return TELLS[clamp(neg.tellIndex, 0, TELLS.length - 1)];
}

/**
 * A read on the counter, not a number.
 *
 * The deal sheet shows exact expected value and exact default odds for financing,
 * because those are long-run properties a dealer genuinely learns. One buyer's
 * private walk-away price is not something anyone on that lot could know, so it
 * stays a judgement call.
 */
export function readCounter(neg: Negotiation, counter: number): string {
  const p = acceptanceChance(neg, counter);
  if (p >= 0.999) return 'They will take that.';
  if (p >= 0.8) return 'Comfortable. They will probably say yes.';
  if (p >= 0.55) return 'Fair ask. Could go either way.';
  if (p >= 0.3) return 'That is a stretch for them.';
  // Deliberately blunter than it was. These bands describe acceptance odds, but
  // what the player feels is the *consequence*, and a refused counter now loses
  // the buyer roughly nine times in ten. "You may lose them" was written when a
  // refusal usually just meant another round, and it undersold the risk by a
  // long way once `baseWalkChance` went to 0.9.
  if (p >= 0.12) return 'Pushing it. Turn that down and they are probably gone.';
  return 'They are going to walk.';
}
